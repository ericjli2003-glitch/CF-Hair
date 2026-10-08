import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Anthropic SDK lets ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN win over workload identity
// federation even when they are empty (for example a blank line copied from .env.example), so
// drop empty ones before any client is created.
for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
  if (process.env[name] !== undefined && process.env[name]!.trim() === "") delete process.env[name];
}

/**
 * A web address as it should be read aloud: "cf-hair-salon.vercel.app" becomes
 * "C F dash hair dash salon dot vercel dot app". Two-letter parts are spelled out.
 */
export function spokenWebAddress(url: string): string {
  const host = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  return host
    .split(".")
    .map((part) =>
      part
        .split("-")
        .map((w) => (w.length <= 2 ? w.toUpperCase().split("").join(" ") : w))
        .join(" dash "),
    )
    .join(" dot ");
}

/** How the Claude client will authenticate: an API key or token, workload identity federation, or nothing. */
export function claudeCredentialSource(e: NodeJS.ProcessEnv = process.env): "api-key" | "federation" | "none" {
  if (e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN) return "api-key";
  const federation =
    e.ANTHROPIC_FEDERATION_RULE_ID &&
    e.ANTHROPIC_ORGANIZATION_ID &&
    e.ANTHROPIC_SERVICE_ACCOUNT_ID &&
    e.ANTHROPIC_IDENTITY_TOKEN_FILE;
  return federation ? "federation" : "none";
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** voice-agent/ (works from src/ under tsx and from dist/ after build). */
export const PROJECT_ROOT = path.resolve(here, "..");

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  anthropicModel: string;
  anthropicEffort: Effort;
  /** "off" (default): no extended thinking where the model allows it, for faster replies. "adaptive": the model decides. */
  anthropicThinking: "off" | "adaptive";
  /** "auto" enables server-side refusal fallbacks on models that support them. */
  claudeFallbacks: "auto" | "on" | "off";
  maxTokens: number;
  bookingApiUrl: string;
  agentApiKey: string;
  apiTimeoutMs: number;
  callerLookupTimeoutMs: number;
  /** How long the incoming-call webhook waits for the caller's saved language before opening in English. */
  openingLookupTimeoutMs: number;
  twilioAuthToken: string;
  validateTwilioSignature: boolean;
  salonForwardNumber: string;
  /** The salon's public number that forwards unanswered calls here; defaults to salon.json phone. */
  salonMainNumber: string;
  salonJsonPath: string;
  logDir: string;
  dataDir: string;
  callbackOnAbandon: boolean;
  endCallGraceMs: number;
  /** After "bye bye", how long to listen for the caller's own goodbye before hanging up. */
  byeListenMs: number;
  /** The online booking site the agent can point callers to, and how to say it on the phone. */
  bookingWebsite: string;
  bookingWebsiteSpoken: string;
  /** ConversationRelay speechTimeout: silence (600 to 5000 ms) before a caller's words are sent; 0 leaves Twilio's default. */
  speechTimeoutMs: number;
  /** ConversationRelay eotThreshold for Deepgram Flux (0.5 sooner to 0.9 later); 0 leaves the default 0.8. */
  eotThreshold: number;
  /** If the caller says nothing the phone can understand this long after the greeting, ask which language (0 turns it off). */
  silenceNudgeMs: number;
  /** ElevenLabs API key for Scribe language identification of new callers (empty turns it off). */
  elevenLabsApiKey: string;
  scribeRealtimeUrl: string;
  /** Languages spoken with ElevenLabs directly instead of through Twilio (for example zh-HK). */
  directTtsLanguages: string[];
  /** ElevenLabs model for direct speech (Twilio does not accept v4 models). */
  directTtsModel: string;
  elevenLabsApiBase: string;
  /** Stop language identification after this long without a sentence. */
  languageIdMaxMs: number;
  /** Print what callers said and what the agent replied to the server log (testing only: it holds names). */
  logTranscripts: boolean;
  /** Ask the one promotional-text question after a phone booking. Off by default: it lengthens every call. */
  phoneSmsOptIn: boolean;
  /** Services whose openings are fetched at call start (empty turns the prefetch off). */
  prefetchServiceIds: string[];
  /** On SIGTERM (a redeploy), how long live calls may continue before the process exits. */
  drainTimeoutMs: number;
  welcomeGreeting: string;
  /** Speech-to-speech test line (src/s2s): OpenAI Realtime. Needs an API key or workload identity. */
  openAiApiKey: string;
  /** OpenAI workload identity federation (Render managed OIDC sets the token file). */
  openAiIdentityProviderId: string;
  openAiServiceAccountId: string;
  openAiIdentityTokenFile: string;
  openAiTokenUrl: string;
  realtimeUrl: string;
  realtimeModel: string;
  realtimeVoice: string;
  /** "hong-kong": English with a light Hong Kong accent and Cantonese mixed with English, like Hong Kong locals. "neutral": none. */
  realtimeAccent: "hong-kong" | "neutral";
  /** Speaking speed for the OpenAI voice, 0.25 to 1.5 (1 is natural). */
  realtimeSpeed: number;
  /** Reasoning effort for the gpt-realtime-2 family ("off" sends none). */
  realtimeReasoning: string;
  /** Silence that ends the caller's turn, in ms (OpenAI server VAD). */
  realtimeSilenceMs: number;
  /** Background transcription of the caller for the call log ("off" turns it off). */
  realtimeTranscribeModel: string;
  /** Azure Voice Live test line (src/s2s/providers.ts). On when the endpoint and key are set. */
  azureVoiceLiveEndpoint: string;
  azureVoiceLiveKey: string;
  azureVoiceLiveModel: string;
  /** Tried in turn if Azure does not offer azureVoiceLiveModel in the resource's region. */
  azureVoiceLiveFallbacks: string[];
  azureVoiceLiveApiVersion: string;
  /** Azure neural voice per call language. */
  azureVoices: { "en-US": string; "zh-CN": string; "zh-HK": string; "ko-KR": string };
  /** Speaking rate for Azure voices ("1" is normal, for example "1.1" is a little faster). */
  azureVoiceRate: string;
  azureTurnDetection: string;
  azureSilenceMs: number;
  /** MiniMax voices (src/tts/minimax.ts) for the languages in minimaxLanguages, on the Azure line. */
  minimaxApiKey: string;
  minimaxBaseUrl: string;
  minimaxGroupId: string;
  minimaxModel: string;
  minimaxVoices: { "en-US": string; "zh-CN": string; "zh-HK": string; "ko-KR": string };
  minimaxSpeed: number;
  minimaxLanguages: ("en-US" | "zh-CN" | "zh-HK" | "ko-KR")[];
  /** ElevenLabs phone agent test line (src/eleven). On when ELEVENLABS_API_KEY is set, unless ELEVENLABS_AGENT=off. */
  elevenAgentApiKey: string;
  elevenAgentLlm: string;
  /** ElevenLabs' code for Cantonese in agents. Empty (default): agents have no Cantonese language yet, so Cantonese
   *  callers run on the Mandarin ("zh") settings with the Cantonese voice and Eleven v4 Turbo. */
  elevenAgentCantoneseCode: string;
  /** Detect the caller's language from transcripts and switch automatically. */
  autoDetectLanguage: boolean;
  /** When the evidence is weak, ask one short question in all four languages. */
  askLanguageQuestion: boolean;
  /** Transcription at call start: "en-US" (default) or "multi" (Deepgram automatic detection). */
  startTranscriptionLanguage: "en-US" | "multi";
  /** Speech model at call start when startTranscriptionLanguage is "multi". */
  startSpeechModel: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: Omit<AppConfig, "autoDetectLanguage" | "askLanguageQuestion" | "startTranscriptionLanguage" | "startSpeechModel"> = {
    port: envInt("PORT", 8080),
    // Render sets RENDER_EXTERNAL_URL (https://<service>.onrender.com) on every web service.
    publicBaseUrl: env("PUBLIC_BASE_URL", env("RENDER_EXTERNAL_URL")).replace(/\/+$/, ""),
    anthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
    anthropicEffort: env("ANTHROPIC_EFFORT", "low") as Effort,
    anthropicThinking: env("ANTHROPIC_THINKING", "off") === "adaptive" ? "adaptive" : "off",
    claudeFallbacks: env("CLAUDE_FALLBACKS", "auto") as AppConfig["claudeFallbacks"],
    maxTokens: envInt("ANTHROPIC_MAX_TOKENS", 4096),
    bookingApiUrl: env("BOOKING_API_URL", "http://localhost:3000").replace(/\/+$/, ""),
    agentApiKey: env("AGENT_API_KEY"),
    apiTimeoutMs: envInt("BOOKING_API_TIMEOUT_MS", 5000),
    callerLookupTimeoutMs: envInt("CALLER_LOOKUP_TIMEOUT_MS", 1500),
    openingLookupTimeoutMs: envInt("OPENING_LOOKUP_TIMEOUT_MS", 1000),
    twilioAuthToken: env("TWILIO_AUTH_TOKEN"),
    validateTwilioSignature: envBool("TWILIO_VALIDATE_SIGNATURE", true),
    salonForwardNumber: env("SALON_FORWARD_NUMBER"),
    salonMainNumber: env("SALON_MAIN_NUMBER"),
    salonJsonPath: env("SALON_JSON_PATH", path.resolve(PROJECT_ROOT, "..", "shared", "salon.json")),
    logDir: env("LOG_DIR", path.resolve(PROJECT_ROOT, "logs")),
    dataDir: env("DATA_DIR", path.resolve(PROJECT_ROOT, "data")),
    callbackOnAbandon: envBool("CALLBACK_ON_ABANDON", true),
    endCallGraceMs: envInt("END_CALL_GRACE_MS", 1200),
    byeListenMs: envInt("BYE_LISTEN_MS", 2500),
    drainTimeoutMs: envInt("DRAIN_TIMEOUT_MS", 280_000),
    phoneSmsOptIn: envBool("PHONE_SMS_OPTIN", false),
    logTranscripts: envBool("LOG_TRANSCRIPTS", false),
    silenceNudgeMs: envInt("SILENCE_NUDGE_MS", 5000),
    speechTimeoutMs: envInt("CR_SPEECH_TIMEOUT_MS", 0),
    eotThreshold: Number.parseFloat(env("CR_EOT_THRESHOLD", "0")) || 0,
    elevenLabsApiKey: env("LANGUAGE_ID", "on") === "off" ? "" : env("ELEVENLABS_API_KEY"),
    scribeRealtimeUrl: env("SCRIBE_REALTIME_URL", "wss://api.elevenlabs.io/v1/speech-to-text/realtime"),
    directTtsLanguages: env("ELEVENLABS_DIRECT_LANGUAGES")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    directTtsModel: env("ELEVENLABS_DIRECT_MODEL", "eleven_v4_turbo"),
    elevenLabsApiBase: env("ELEVENLABS_API_BASE", "https://api.elevenlabs.io").replace(/\/+$/, ""),
    languageIdMaxMs: envInt("LANGUAGE_ID_MAX_MS", 20_000),
    bookingWebsite: env("BOOKING_WEBSITE", "cf-hair-salon.vercel.app"),
    bookingWebsiteSpoken: env("BOOKING_WEBSITE_SPOKEN", spokenWebAddress(env("BOOKING_WEBSITE", "cf-hair-salon.vercel.app"))),
    prefetchServiceIds: env("PREFETCH_SERVICES", "mens-cut,womens-cut,kids-cut")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "off"),
    openAiApiKey: env("OPENAI_API_KEY").trim(),
    openAiIdentityProviderId: env("OPENAI_IDENTITY_PROVIDER_ID").trim(),
    openAiServiceAccountId: env("OPENAI_SERVICE_ACCOUNT_ID").trim(),
    openAiIdentityTokenFile: env("OPENAI_IDENTITY_TOKEN_FILE").trim(),
    openAiTokenUrl: env("OPENAI_TOKEN_EXCHANGE_URL", "https://auth.openai.com/oauth/token"),
    realtimeUrl: env("OPENAI_REALTIME_URL", "wss://api.openai.com/v1/realtime"),
    realtimeModel: env("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1"),
    realtimeVoice: env("OPENAI_REALTIME_VOICE", "marin"),
    realtimeAccent: env("OPENAI_VOICE_ACCENT", "hong-kong") === "neutral" ? "neutral" : "hong-kong",
    realtimeSpeed: Math.min(1.5, Math.max(0.25, Number.parseFloat(env("OPENAI_REALTIME_SPEED", "1")) || 1)),
    realtimeReasoning: env("OPENAI_REASONING_EFFORT", "low"),
    realtimeSilenceMs: envInt("OPENAI_VAD_SILENCE_MS", 500),
    realtimeTranscribeModel: env("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe"),
    azureVoiceLiveEndpoint: env("AZURE_VOICELIVE_ENDPOINT").trim().replace(/\/+$/, ""),
    azureVoiceLiveKey: env("AZURE_VOICELIVE_API_KEY").trim(),
    azureVoiceLiveModel: env("AZURE_VOICELIVE_MODEL", "gpt-realtime"),
    azureVoiceLiveFallbacks: env("AZURE_VOICELIVE_FALLBACK_MODELS", "gpt-realtime-mini,gpt-4.1-mini,gpt-4o-mini")
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m && m !== "off"),
    azureVoiceLiveApiVersion: env("AZURE_VOICELIVE_API_VERSION", "2026-07-15"),
    azureVoices: {
      // English with a Hong Kong accent by default, matching the salon's clients; en-US voices work too.
      "en-US": env("AZURE_VOICE_EN_US", "en-HK-YanNeural"),
      "zh-CN": env("AZURE_VOICE_ZH_CN", "zh-CN-XiaoxiaoNeural"),
      "zh-HK": env("AZURE_VOICE_ZH_HK", "zh-HK-HiuMaanNeural"),
      "ko-KR": env("AZURE_VOICE_KO_KR", "ko-KR-SunHiNeural"),
    },
    azureVoiceRate: env("AZURE_VOICE_RATE", "1"),
    azureTurnDetection: env("AZURE_TURN_DETECTION", "azure_semantic_vad_multilingual"),
    azureSilenceMs: envInt("AZURE_VAD_SILENCE_MS", 500),
    minimaxApiKey: env("MINIMAX_API_KEY").trim(),
    minimaxBaseUrl: env("MINIMAX_BASE_URL", "https://api-uw.minimax.io").replace(/\/+$/, ""),
    minimaxGroupId: env("MINIMAX_GROUP_ID").trim(),
    minimaxModel: env("MINIMAX_MODEL", "speech-2.8-turbo"),
    minimaxVoices: {
      "en-US": env("MINIMAX_VOICE_EN_US", "English_radiant_girl"),
      "zh-CN": env("MINIMAX_VOICE_ZH_CN", "female-tianmei"),
      "zh-HK": env("MINIMAX_VOICE_ZH_HK", "Cantonese_GentleLady"),
      "ko-KR": env("MINIMAX_VOICE_KO_KR", "female-tianmei"),
    },
    minimaxSpeed: Math.min(2, Math.max(0.5, Number.parseFloat(env("MINIMAX_SPEED", "1")) || 1)),
    // Mandarin and Cantonese by default; set to zh-CN for Azure's own Cantonese voice instead.
    minimaxLanguages: env("MINIMAX_LANGUAGES", "zh-CN,zh-HK")
      .split(",")
      .map((x) => x.trim())
      .filter((x): x is "en-US" | "zh-CN" | "zh-HK" | "ko-KR" => ["en-US", "zh-CN", "zh-HK", "ko-KR"].includes(x)),
    elevenAgentApiKey: env("ELEVENLABS_AGENT", "on") === "off" ? "" : env("ELEVENLABS_API_KEY").trim(),
    elevenAgentLlm: env("ELEVENLABS_AGENT_LLM", "claude-haiku-4-5"),
    elevenAgentCantoneseCode: env("ELEVENLABS_AGENT_CANTONESE", ""),
    welcomeGreeting: env(
      "WELCOME_GREETING",
      "Hi, CF Hair Salon.",
    ),
  };
  const start = env("CR_START_TRANSCRIPTION_LANGUAGE", "en-US").toLowerCase() === "multi" ? "multi" : "en-US";
  const lang: Pick<AppConfig, "autoDetectLanguage" | "askLanguageQuestion" | "startTranscriptionLanguage" | "startSpeechModel"> = {
    autoDetectLanguage: envBool("LANG_AUTODETECT", true),
    askLanguageQuestion: envBool("LANG_ASK_QUESTION", true),
    startTranscriptionLanguage: start,
    startSpeechModel: env("CR_START_SPEECH_MODEL", "nova-3-general"),
  };
  return { ...base, ...lang, ...overrides };
}
