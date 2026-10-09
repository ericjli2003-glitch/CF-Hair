import type { LanguageCode } from "../languages.js";
import type { OpenAiAuth } from "../s2s/openai-auth.js";

/**
 * Which language a caller is speaking, from the sound of one sentence: an OpenAI audio model hears
 * it and answers with one of the salon's four languages. Speech recognition writes Cantonese and
 * Mandarin alike, and open-ended detectors (Scribe) guess languages like Dutch on phone audio; a
 * model told to choose among English, Mandarin, Cantonese and Korean can hear the difference.
 *
 * API: POST {apiBase}/v1/chat/completions with a user message holding input_audio {data (base64
 * WAV), format: "wav"} and text output only (OpenAI audio input, gpt-audio models).
 */

export interface AudioLanguageIdOptions {
  auth: OpenAiAuth;
  apiBase: string;
  /** Tried in order; a model OpenAI does not offer is skipped from then on. */
  models: string[];
  timeoutMs?: number;
}

const PROMPT = `You hear one short sentence from a phone call to a hair salon in Vancouver. Which language is the caller speaking?
Answer with exactly one word: english, mandarin, cantonese, korean, or unclear.
Cantonese and Mandarin are different languages: judge by the sounds and tones you hear (Cantonese has six tones, final consonants like -p -t -k, and words like hai, m, mou, ge, dim; Mandarin has four tones and words like shi, bu, meiyou, de, zenme).
A Chinese or Korean speaker using a few English words ("book", "OK", "haircut") is still speaking Chinese or Korean.
If there is no clear speech, or only a word or two like "OK" or "hello", answer unclear.`;

const ANSWERS: Record<string, LanguageCode> = { english: "en-US", mandarin: "zh-CN", cantonese: "zh-HK", korean: "ko-KR" };

export class AudioLanguageId {
  private models: string[];
  private off = false;

  constructor(private readonly opts: AudioLanguageIdOptions) {
    this.models = [...opts.models];
  }

  /** The caller's language for one sentence of mu-law 8 kHz audio, or null when unclear or unavailable. */
  async identify(mulaw: Buffer): Promise<{ language: LanguageCode | null; answer: string }> {
    if (this.off || !this.models.length) return { language: null, answer: "off" };
    const wav = mulawToWav(mulaw).toString("base64");
    const bearer = await this.opts.auth.bearer();
    while (this.models.length) {
      const model = this.models[0];
      const r = await fetch(`${this.opts.apiBase}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          modalities: ["text"],
          messages: [
            { role: "system", content: PROMPT },
            { role: "user", content: [{ type: "input_audio", input_audio: { data: wav, format: "wav" } }] },
          ],
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 4000),
      });
      if (r.ok) {
        const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
        const answer = String(data.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
        const word = Object.keys(ANSWERS).find((k) => answer.includes(k));
        return { language: word ? ANSWERS[word] : null, answer: answer.slice(0, 40) };
      }
      const body = (await r.text().catch(() => "")).slice(0, 300);
      if ((r.status === 400 || r.status === 404) && /model/i.test(body)) {
        console.warn(`[langid] ${model} is not available (${r.status}); trying the next model`);
        this.models.shift();
        continue;
      }
      if (r.status === 401 || r.status === 403) {
        this.off = true; // a permission problem does not fix itself mid-call; say it once
        console.warn(`[langid] OpenAI refused the audio language check (${r.status}: ${body}). Give the key or service account access to chat completions, or set LANGUAGE_ID_MODEL=off.`);
        return { language: null, answer: "refused" };
      }
      throw new Error(`OpenAI ${r.status} ${body}`);
    }
    return { language: null, answer: "no model" };
  }
}

/** G.711 mu-law 8 kHz to a 16-bit PCM WAV file. */
export function mulawToWav(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) pcm.writeInt16LE(mulawToLinear(mulaw[i]), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function mulawToLinear(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -sample : sample;
}
