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

export class MiniMaxSpeech {
  constructor(readonly opts: MiniMaxOptions) {}

  voiceFor(lang: LanguageCode): string {
    return this.opts.voices[lang];
  }

  /** Streams one sentence as mu-law 8 kHz audio chunks. Throws on an API error. */
  async *mulaw(text: string, lang: LanguageCode, signal: AbortSignal): AsyncGenerator<Buffer> {
    const q = this.opts.groupId ? `?GroupId=${encodeURIComponent(this.opts.groupId)}` : "";
    const r = await fetch(`${this.opts.baseUrl}/v1/t2a_v2${q}`, {
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
    for await (const part of r.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(part, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = JSON.parse(line.slice(5).trim()) as { data?: { audio?: string }; base_resp?: { status_code?: number; status_msg?: string } };
        const code = data.base_resp?.status_code ?? 0;
        if (code !== 0) throw new Error(`MiniMax error ${code}: ${data.base_resp?.status_msg ?? ""}`);
        const hex = data.data?.audio;
        if (!hex) continue;
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
