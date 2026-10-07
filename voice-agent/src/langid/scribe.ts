import WebSocket from "ws";

/**
 * Spoken-language identification for a caller's first sentence, using ElevenLabs Scribe v2
 * Realtime (speech to text with automatic language detection, Mandarin and Cantonese included).
 *
 * Why: Twilio ConversationRelay transcribes in one language at a time and its only automatic
 * detection (Deepgram "multi") does not cover Chinese or Korean, so a new caller who answers the
 * English greeting in Mandarin or Cantonese is heard as silence. A copy of the call audio is sent
 * here instead; the first finished sentence comes back with its language, and the call switches.
 *
 * Protocol (from the official @elevenlabs/elevenlabs-js SDK, realtime/connection):
 *   wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=ulaw_8000
 *     &commit_strategy=vad&include_language_detection=true   (header xi-api-key)
 *   send {message_type:"input_audio_chunk", audio_base_64, commit:false, sample_rate:8000}
 *   receive committed_transcript {text}, and with language detection a later
 *   committed_transcript_with_timestamps / final_transcript_with_timestamps {text, language_code}.
 */

export interface Detection {
  /** ISO 639-1 or 639-3 code from Scribe ("en", "zh", "yue", "ko"), or null when it gave none. */
  languageCode: string | null;
  text: string;
}

export interface ScribeOptions {
  url: string;
  apiKey: string;
  /** Silence that ends a sentence. Shorter answers sooner; 0.3 to 3.0 seconds. */
  vadSilenceSecs?: number;
  /** If the language message does not follow a committed sentence within this time, report the text alone. */
  languageWaitMs?: number;
}

const ERROR_TYPES = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "commit_throttled",
  "transcriber_error",
  "unaccepted_terms",
  "rate_limited",
  "input_error",
  "invalid_request",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
]);

export class ScribeLanguageId {
  private readonly ws: WebSocket;
  private open = false;
  private finished = false;
  private queue: string[] = [];
  private pendingText = "";
  private textTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly opts: ScribeOptions,
    private readonly onDetect: (d: Detection) => void,
    private readonly onError: (reason: string) => void,
  ) {
    const q = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: "ulaw_8000",
      commit_strategy: "vad",
      vad_silence_threshold_secs: String(opts.vadSilenceSecs ?? 0.6),
      include_language_detection: "true",
    });
    this.ws = new WebSocket(`${opts.url}?${q}`, { headers: { "xi-api-key": opts.apiKey } });
    this.ws.on("open", () => {
      this.open = true;
      for (const chunk of this.queue) this.sendNow(chunk);
      this.queue = [];
    });
    this.ws.on("message", (raw) => this.onMessage(raw.toString()));
    this.ws.on("error", (err) => this.fail(`socket error: ${err.message}`));
    this.ws.on("close", (code) => {
      if (!this.finished) this.fail(`closed before a sentence was heard (code ${code})`);
    });
  }

  /** One Twilio media payload: base64 mu-law, 8 kHz. */
  sendAudio(base64: string) {
    if (this.finished) return;
    if (this.open) this.sendNow(base64);
    else if (this.queue.length < 250) this.queue.push(base64); // about 5 s of audio while connecting
  }

  close() {
    this.finished = true;
    if (this.textTimer) clearTimeout(this.textTimer);
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }

  private sendNow(base64: string) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: base64, commit: false, sample_rate: 8000 }));
  }

  private onMessage(raw: string) {
    if (this.finished) return;
    let m: { message_type?: string; text?: string; language_code?: string | null; error?: string };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const type = m.message_type ?? "";
    if (ERROR_TYPES.has(type)) return this.fail(`${type}${m.error ? `: ${m.error}` : ""}`);
    const text = (m.text ?? "").trim();
    if (type === "committed_transcript") {
      if (!text) return;
      this.pendingText = text;
      // The language arrives in a follow-up message; if it does not, report the text alone.
      this.textTimer ??= setTimeout(() => this.finish({ languageCode: null, text: this.pendingText }), this.opts.languageWaitMs ?? 1500);
      return;
    }
    if ((type === "committed_transcript_with_timestamps" || type === "final_transcript_with_timestamps") && m.language_code) {
      const said = text || this.pendingText;
      if (said) this.finish({ languageCode: m.language_code, text: said });
    }
  }

  private finish(d: Detection) {
    if (this.finished) return;
    this.close();
    this.onDetect(d);
  }

  private fail(reason: string) {
    if (this.finished) return;
    this.close();
    this.onError(reason);
  }
}
