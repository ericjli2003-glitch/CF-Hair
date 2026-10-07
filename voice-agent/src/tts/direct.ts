import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Response as ExpressResponse } from "express";
import type { LanguageCode } from "../languages.js";

/**
 * Speech for languages Twilio's ElevenLabs voices cannot do well, made by calling ElevenLabs
 * directly. Built for Cantonese: ConversationRelay only accepts the flash/turbo v2 models, which do
 * not list Cantonese, while Eleven v4 Turbo is built for it (and Twilio rejects "-v4_turbo").
 *
 * Each reply sentence is sent to ElevenLabs as soon as the agent writes it; ConversationRelay gets a
 * `play` message pointing at /tts/<id>.mp3 on this server, and the audio streams through as
 * ElevenLabs produces it. Clips are single use and expire after two minutes.
 *
 * API (from the official @elevenlabs/elevenlabs-js SDK): POST /v1/text-to-speech/{voice_id}/stream
 * ?output_format=mp3_22050_32, header xi-api-key, body {text, model_id, language_code}.
 */

export interface DirectTtsOptions {
  apiKey: string;
  apiBase: string;
  model: string;
  /** ElevenLabs voice id per language that should use direct speech. */
  voices: Partial<Record<LanguageCode, string>>;
}

/** ElevenLabs language_code per call language (ISO 639-1, or 639-3 for Cantonese). */
const LANGUAGE_CODES: Record<LanguageCode, string> = { "en-US": "en", "zh-CN": "zh", "zh-HK": "yue", "ko-KR": "ko" };

interface Clip {
  audio: Promise<Response>;
  created: number;
  lang: LanguageCode;
}

export class DirectTts {
  private readonly clips = new Map<string, Clip>();

  constructor(private readonly opts: DirectTtsOptions) {}

  covers(lang: LanguageCode): boolean {
    return !!this.opts.apiKey && !!this.opts.voices[lang];
  }

  /** Starts making the audio now and returns the clip id for /tts/<id>.mp3. */
  prepare(text: string, lang: LanguageCode): string {
    this.sweep();
    const id = randomUUID();
    const audio = this.request(text, lang, true);
    audio.catch(() => {}); // surfaced when Twilio fetches the clip
    this.clips.set(id, { audio, created: Date.now(), lang });
    return id;
  }

  /** GET /tts/:id.mp3, fetched by Twilio. */
  async serve(id: string, res: ExpressResponse) {
    const clip = this.clips.get(id);
    if (!clip) return void res.status(404).end();
    this.clips.delete(id);
    try {
      const r = await clip.audio;
      if (!r.ok || !r.body) {
        console.error(`[tts] ElevenLabs ${clip.lang} speech failed: ${r.status} ${await r.text().catch(() => "")}`.slice(0, 400));
        return void res.status(502).end();
      }
      res.status(200).type("audio/mpeg");
      Readable.fromWeb(r.body as import("node:stream/web").ReadableStream).pipe(res);
    } catch (err) {
      console.error(`[tts] ElevenLabs ${clip.lang} speech failed: ${(err as Error).message}`);
      res.status(502).end();
    }
  }

  private async request(text: string, lang: LanguageCode, withLanguage: boolean): Promise<Response> {
    const url = `${this.opts.apiBase}/v1/text-to-speech/${encodeURIComponent(this.opts.voices[lang]!)}/stream?output_format=mp3_22050_32`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": this.opts.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: this.opts.model, ...(withLanguage ? { language_code: LANGUAGE_CODES[lang] } : {}) }),
    });
    // If the model refuses the language code, let it infer the language from the text instead.
    if (withLanguage && (r.status === 400 || r.status === 422)) {
      console.warn(`[tts] ElevenLabs refused language_code ${LANGUAGE_CODES[lang]} (${r.status}); retrying without it`);
      return this.request(text, lang, false);
    }
    return r;
  }

  private sweep() {
    const cutoff = Date.now() - 120_000;
    for (const [id, c] of this.clips) if (c.created < cutoff) this.clips.delete(id);
  }
}
