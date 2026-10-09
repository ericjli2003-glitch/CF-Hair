import type { LanguageCode } from "../languages.js";
import type { OutsideVoice } from "./outside.js";

/**
 * ElevenLabs text to speech, streamed for phone calls, so Mandarin and Cantonese on the Azure line
 * can use the same ElevenLabs voice as English on the ElevenLabs agent.
 *
 * API (official @elevenlabs/elevenlabs-js SDK, as in tts/direct.ts): POST
 * /v1/text-to-speech/{voice_id}/stream?output_format=ulaw_8000, header xi-api-key, body {text,
 * model_id, language_code}. ulaw_8000 is the phone's own format, so the bytes go straight to Twilio.
 */

export interface ElevenSpeechOptions {
  apiKey: string;
  apiBase: string;
  /** ElevenLabs voice id per language. */
  voices: Partial<Record<LanguageCode, string>>;
  /** Model per language, as the ElevenLabs agent uses them (Flash v2.5 for Mandarin, v4 Turbo for Cantonese). */
  models: Partial<Record<LanguageCode, string>>;
  /** Streaming latency optimization, 0 (best sound) to 4 (fastest). */
  latency: number;
}

/** ElevenLabs language_code per call language (ISO 639-1, or 639-3 for Cantonese). */
const LANGUAGE_CODES: Record<LanguageCode, string> = { "en-US": "en", "zh-CN": "zh", "zh-HK": "yue", "ko-KR": "ko" };

export class ElevenSpeech implements OutsideVoice {
  readonly label = "ElevenLabs";
  /** Language codes the model refused once: later sentences go without them. */
  private readonly noCode = new Set<LanguageCode>();

  constructor(readonly opts: ElevenSpeechOptions) {}

  voiceFor(lang: LanguageCode): string {
    return this.opts.voices[lang] ?? "";
  }

  async *mulaw(text: string, lang: LanguageCode, signal: AbortSignal): AsyncGenerator<Buffer> {
    let r = await this.request(text, lang, !this.noCode.has(lang), signal);
    // If the model refuses the language code, let it infer the language from the text instead.
    if (!this.noCode.has(lang) && (r.status === 400 || r.status === 422)) {
      console.warn(`[tts] ElevenLabs refused language_code ${LANGUAGE_CODES[lang]} (${r.status}); going without it`);
      this.noCode.add(lang);
      r = await this.request(text, lang, false, signal);
    }
    if (!r.ok || !r.body) throw new Error(`ElevenLabs ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}`);
    for await (const part of r.body as unknown as AsyncIterable<Uint8Array>) {
      if (part.length) yield Buffer.from(part);
    }
  }

  private request(text: string, lang: LanguageCode, withCode: boolean, signal: AbortSignal): Promise<Response> {
    const voice = encodeURIComponent(this.voiceFor(lang));
    return fetch(`${this.opts.apiBase}/v1/text-to-speech/${voice}/stream?output_format=ulaw_8000&optimize_streaming_latency=${this.opts.latency}`, {
      method: "POST",
      headers: { "xi-api-key": this.opts.apiKey, "content-type": "application/json", accept: "audio/basic" },
      body: JSON.stringify({ text, model_id: this.opts.models[lang] ?? "eleven_flash_v2_5", ...(withCode ? { language_code: LANGUAGE_CODES[lang] } : {}) }),
      signal,
    });
  }
}
