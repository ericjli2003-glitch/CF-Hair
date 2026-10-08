import type { LanguageCode } from "../languages.js";

/**
 * MiniMax text to speech, streamed for phone calls. MiniMax (a Chinese AI lab) has some of the most
 * natural Mandarin and Cantonese voices; the speech-to-speech bridge uses it for the languages in
 * MINIMAX_LANGUAGES, with the realtime model writing text instead of speaking.
 *
 * API (from LiveKit's open-source MiniMax plugin): POST {base}/v1/t2a_v2, Authorization: Bearer,
 * JSON {model, text, stream: true, voice_setting {voice_id, speed, vol, pitch}, audio_setting
 * {sample_rate, format: "pcm", channel: 1}, language_boost}. The reply is server-sent events, one
 * "data: {...}" line each, with data.audio as hex and base_resp.status_code (0 = fine). PCM is
 * 16-bit little-endian; at 8 kHz it converts straight to the phone's G.711 mu-law.
 */

export interface MiniMaxOptions {
  apiKey: string;
  baseUrl: string;
  /** Older accounts (minimax.chat) need ?GroupId=. */
  groupId: string;
  model: string;
  voices: Record<LanguageCode, string>;
  speed: number;
}

/** MiniMax language_boost per call language. */
const BOOST: Record<LanguageCode, string> = { "en-US": "English", "zh-CN": "Chinese", "zh-HK": "Chinese,Yue", "ko-KR": "Korean" };

/** How MiniMax names its system voices per language, to find one when the configured voice is missing. */
const VOICE_NAMES: Record<LanguageCode, RegExp> = {
  "en-US": /^English_/,
  "zh-CN": /^(Chinese \(Mandarin\)_|female-|male-)/,
  "zh-HK": /^Cantonese_/,
  "ko-KR": /^Korean_/,
};
const FEMALE = /lady|woman|girl|female|\(F\)|（F）/i;

interface VoiceList {
  system_voice?: { voice_id: string }[] | null;
  voice_cloning?: { voice_id: string }[] | null;
  voice_generation?: { voice_id: string }[] | null;
}

export class MiniMaxSpeech {
  private readonly voices: Record<LanguageCode, string>;

  constructor(readonly opts: MiniMaxOptions) {
    this.voices = { ...opts.voices };
  }

  voiceFor(lang: LanguageCode): string {
    return this.voices[lang];
  }

  private url(path: string): string {
    const q = this.opts.groupId ? `?GroupId=${encodeURIComponent(this.opts.groupId)}` : "";
    return `${this.opts.baseUrl}${path}${q}`;
  }

  /**
   * Checks the voices for `langs` against the account's voice list (POST /v1/get_voice) and, for one
   * that is not there, uses a system voice for that language instead (a female one when there is
   * one), so a wrong voice id does not cost the call its MiniMax voice. Keeps the configured voices
   * if the list cannot be read.
   */
  async checkVoices(langs: LanguageCode[]): Promise<void> {
    const r = await fetch(this.url("/v1/get_voice"), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ voice_type: "all" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`MiniMax voice list ${r.status}`);
    const list = (await r.json()) as VoiceList;
    const system = (list.system_voice ?? []).map((v) => v.voice_id);
    const all = new Set([...system, ...(list.voice_cloning ?? []).map((v) => v.voice_id), ...(list.voice_generation ?? []).map((v) => v.voice_id)]);
    if (!all.size) throw new Error("MiniMax voice list is empty");
    for (const lang of langs) {
      if (all.has(this.voices[lang])) continue;
      const fits = system.filter((id) => VOICE_NAMES[lang].test(id));
      const pick = fits.find((id) => FEMALE.test(id)) ?? fits[0];
      if (!pick) {
        console.warn(`MiniMax: voice ${this.voices[lang]} for ${lang} is not in this account, and no ${lang} system voice was found`);
        continue;
      }
      console.warn(`MiniMax: voice ${this.voices[lang]} for ${lang} is not in this account; using ${pick}`);
      this.voices[lang] = pick;
    }
    console.log(`MiniMax voices: ${langs.map((l) => `${l} ${this.voices[l]}`).join(", ")}`);
  }

  /** Streams one sentence as mu-law 8 kHz audio chunks. Throws on an API error. */
  async *mulaw(text: string, lang: LanguageCode, signal: AbortSignal): AsyncGenerator<Buffer> {
    const r = await fetch(this.url("/v1/t2a_v2"), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.opts.model,
        text,
        stream: true,
        stream_options: { exclude_aggregated_audio: true },
        voice_setting: { voice_id: this.voiceFor(lang), speed: this.opts.speed, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 8000, format: "pcm", channel: 1 },
        language_boost: BOOST[lang],
      }),
      signal,
    });
    if (!r.ok || !r.body) throw new Error(`MiniMax ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}`);
    const decoder = new TextDecoder();
    let buf = "";
    let odd: Buffer | null = null; // a PCM byte left over between chunks
    let streamed = false;
    for await (const part of r.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(part, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = JSON.parse(line.slice(5).trim()) as { data?: { audio?: string; status?: number }; base_resp?: { status_code?: number; status_msg?: string } };
        const code = data.base_resp?.status_code ?? 0;
        if (code !== 0) throw new Error(`MiniMax error ${code}: ${data.base_resp?.status_msg ?? ""}`);
        const hex = data.data?.audio;
        if (!hex) continue;
        // The last event (status 2) can repeat the whole sentence's audio; never play it twice.
        if (data.data?.status === 2 && streamed) continue;
        streamed = true;
        let pcm: Buffer = Buffer.from(hex, "hex");
        if (odd) {
          pcm = Buffer.concat([odd, pcm]);
          odd = null;
        }
        if (pcm.length % 2) {
          odd = pcm.subarray(pcm.length - 1);
          pcm = pcm.subarray(0, pcm.length - 1);
        }
        if (pcm.length) yield pcmToMulaw(pcm);
      }
    }
  }
}

/** 16-bit little-endian PCM to G.711 mu-law. */
export function pcmToMulaw(pcm: Buffer): Buffer {
  const out = Buffer.alloc(pcm.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = linearToMulaw(pcm.readInt16LE(i * 2));
  return out;
}

function linearToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const sign = sample < 0 ? 0x80 : 0;
  const s = Math.min(Math.abs(sample), CLIP) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
