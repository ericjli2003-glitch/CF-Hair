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
