import type { LanguageCode } from "../languages.js";

/**
 * A voice outside the realtime service, for languages its own voices do poorly: the model writes
 * text and the bridge (s2s/realtime.ts) streams each sentence through one of these.
 */
export interface OutsideVoice {
  /** For logs, for example "ElevenLabs" or "MiniMax". */
  readonly label: string;
  voiceFor(lang: LanguageCode): string;
  /** Streams one sentence as mu-law 8 kHz audio chunks. Throws on an API error. */
  mulaw(text: string, lang: LanguageCode, signal: AbortSignal): AsyncGenerator<Buffer>;
}

/**
 * One voice with a backup: a sentence the first cannot speak (before any of its audio) goes to the
 * second. An account problem (401, 402, 403, for example a free ElevenLabs plan that may not use
 * library voices through the API) switches to the backup for good, so later calls skip the failure.
 */
export class VoiceWithBackup implements OutsideVoice {
  private primaryOff = false;

  constructor(
    private readonly primary: OutsideVoice,
    private readonly backup: OutsideVoice,
  ) {}

  get label(): string {
    return this.primaryOff ? this.backup.label : this.primary.label;
  }

  voiceFor(lang: LanguageCode): string {
    return this.primaryOff ? this.backup.voiceFor(lang) : this.primary.voiceFor(lang);
  }

  async *mulaw(text: string, lang: LanguageCode, signal: AbortSignal): AsyncGenerator<Buffer> {
    if (!this.primaryOff) {
      let started = false;
      try {
        for await (const chunk of this.primary.mulaw(text, lang, signal)) {
          started = true;
          yield chunk;
        }
        return;
      } catch (err) {
        if (started || signal.aborted) throw err;
        const message = (err as Error).message;
        if (/\b40[123]\b/.test(message)) {
          this.primaryOff = true;
          console.warn(`[tts] ${this.primary.label} voice refused (${message.slice(0, 200)}); using ${this.backup.label} from now on`);
        } else {
          console.warn(`[tts] ${this.primary.label} voice failed (${message.slice(0, 200)}); ${this.backup.label} speaks this sentence`);
        }
      }
    }
    yield* this.backup.mulaw(text, lang, signal);
  }
}
