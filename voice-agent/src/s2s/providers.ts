import type { AppConfig } from "../config.js";
import type { LanguageCode } from "../languages.js";
import type { OpenAiAuth } from "./openai-auth.js";

/**
 * The speech-to-speech services the bridge in realtime.ts can talk to. Both speak the Realtime
 * event protocol; they differ in how to connect, how the session is configured, and (Azure) in
 * having a separate voice per language.
 *
 * OpenAI: GA Realtime API (official openai SDK types). wss://api.openai.com/v1/realtime?model=...,
 *   Authorization: Bearer; session {type: "realtime", audio: {input/output: {format: audio/pcmu}}}.
 * Azure Voice Live (official @azure/ai-voicelive SDK): wss://<resource>/voice-live/realtime
 *   ?api-version=...&model=..., header api-key; OpenAI-style session with input_audio_format
 *   "g711_ulaw", an Azure neural voice {type: "azure-standard", name}, Azure semantic turn
 *   detection, noise suppression and echo cancellation. Events use the older names
 *   (response.audio.delta, response.audio_transcript.*), which the bridge accepts too.
 */
export interface RealtimeProvider {
  /** Log tag and call-log model prefix. */
  tag: string;
  label: string;
  model: string;
  voiceFor(lang: LanguageCode): string;
  connect(): Promise<{ url: string; headers: Record<string, string> }>;
  /** The first session.update: everything. */
  session(p: { instructions: string; language: LanguageCode; tools: unknown[] }): Record<string, unknown>;
  /** A later session.update with new instructions only. */
  instructions(text: string): Record<string, unknown>;
  /** A session.update that changes the voice for a new language, or null when one voice speaks all. */
  languageVoice(lang: LanguageCode): Record<string, unknown> | null;
  /** Extra guidance for the model on this provider. */
  note: string;
  /**
   * The current model is not offered here (for example not in this Azure region): switch to the next
   * one to try and return it, or null when there is none. Remembered for later calls.
   */
  fallback?(): string | null;
}

/** An error that means the requested model is not available (wrong region, not offered). */
export function isModelUnavailable(err: { code?: string; message?: string } | undefined): boolean {
  if (!err) return false;
  return err.code === "invalid_model" || /not supported in this region|model[^.]*not (found|available|supported)/i.test(err.message ?? "");
}

export function openAiProvider(cfg: AppConfig, auth: OpenAiAuth): RealtimeProvider {
  return {
    tag: "s2s",
    label: "OpenAI",
    model: cfg.realtimeModel,
    voiceFor: () => cfg.realtimeVoice,
    async connect() {
      const bearer = await auth.bearer();
      return { url: `${cfg.realtimeUrl}?model=${encodeURIComponent(cfg.realtimeModel)}`, headers: { Authorization: `Bearer ${bearer}` } };
    },
    session({ instructions, tools }) {
      const reasoning = /^gpt-realtime-2/.test(cfg.realtimeModel) && cfg.realtimeReasoning !== "off";
      const transcribe = cfg.realtimeTranscribeModel !== "off";
      return {
        type: "session.update",
        session: {
          type: "realtime",
          model: cfg.realtimeModel,
          output_modalities: ["audio"],
          instructions,
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              turn_detection: { type: "server_vad", silence_duration_ms: cfg.realtimeSilenceMs, create_response: true, interrupt_response: true },
              ...(transcribe ? { transcription: { model: cfg.realtimeTranscribeModel } } : {}),
            },
            output: { format: { type: "audio/pcmu" }, voice: cfg.realtimeVoice, speed: cfg.realtimeSpeed },
          },
          tools,
          tool_choice: "auto",
          ...(reasoning ? { reasoning: { effort: cfg.realtimeReasoning } } : {}),
        },
      };
    },
    instructions: (text) => ({ type: "session.update", session: { type: "realtime", instructions: text } }),
    languageVoice: () => null,
    note: "",
  };
}

/** Transcription locales for Azure Speech: auto-detected among the salon's four languages. */
const AZURE_LOCALES = "en-US,zh-HK,zh-CN,ko-KR";

export function azureProvider(cfg: AppConfig): RealtimeProvider {
  // The chosen model first, then the fallbacks, used in turn when Azure says one is not offered.
  const models = [...new Set([cfg.azureVoiceLiveModel, ...cfg.azureVoiceLiveFallbacks])];
  let current = 0;
  const voiceFor = (lang: LanguageCode) => cfg.azureVoices[lang];
  const voice = (lang: LanguageCode) => ({ type: "azure-standard", name: voiceFor(lang), ...(cfg.azureVoiceRate !== "1" ? { rate: cfg.azureVoiceRate } : {}) });
  return {
    tag: "azure",
    label: "Azure",
    get model() {
      return models[current];
    },
    fallback() {
      if (current + 1 >= models.length) return null;
      current++;
      return models[current];
    },
    voiceFor,
    async connect() {
      const url = new URL(cfg.azureVoiceLiveEndpoint);
      url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
      url.pathname = "/voice-live/realtime";
      url.search = "";
      url.searchParams.set("api-version", cfg.azureVoiceLiveApiVersion);
      url.searchParams.set("model", models[current]);
      return { url: url.toString(), headers: { "api-key": cfg.azureVoiceLiveKey } };
    },
    session({ instructions, language, tools }) {
      return {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions,
          voice: voice(language),
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          turn_detection: {
            type: cfg.azureTurnDetection,
            silence_duration_ms: cfg.azureSilenceMs,
            create_response: true,
            interrupt_response: true,
          },
          input_audio_noise_reduction: { type: "azure_deep_noise_suppression" },
          input_audio_echo_cancellation: { type: "server_echo_cancellation" },
          input_audio_transcription: { model: "azure-speech", language: AZURE_LOCALES },
          tools,
          tool_choice: "auto",
        },
      };
    },
    instructions: (text) => ({ type: "session.update", session: { instructions: text } }),
    languageVoice: (lang) => ({ type: "session.update", session: { voice: voice(lang) } }),
    note: `- Each language has its own voice on this line, and the voice changes when the language does. When the caller speaks a different language from the current one, call set_language first, then reply in that language.`,
  };
}
