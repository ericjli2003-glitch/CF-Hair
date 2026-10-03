/**
 * Supported caller languages and how each one is configured in ConversationRelay.
 *
 * The codes match the shared contract (docs/ARCHITECTURE.md, "Languages"):
 * en-US, zh-CN (Mandarin), zh-HK (Cantonese), ko-KR (Korean).
 *
 * Each code is declared as a <Language> element in the TwiML, and the same code is
 * sent in the WebSocket `language` message to switch both text-to-speech and
 * transcription. Twilio rejects a switch to a code that was not declared, so every
 * language we may switch to must be listed here.
 *
 * Provider, voice and speech model choices can be overridden per language with
 * environment variables, for example CR_ZH_HK_VOICE or CR_KO_KR_TRANSCRIPTION_PROVIDER.
 */

export const LANGUAGE_CODES = ["en-US", "zh-CN", "zh-HK", "ko-KR"] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
export const DEFAULT_LANGUAGE: LanguageCode = "en-US";

export interface RelayLanguage {
  code: LanguageCode;
  englishName: string;
  nativeName: string;
  ttsProvider: string;
  voice: string;
  transcriptionProvider: string;
  speechModel: string;
  /** Short sentence said right after the English greeting for a returning caller. */
  continueOffer: string;
  /** Said when the caller picks this language by keypad. */
  switchedConfirmation: string;
  /** Rough speaking rate used to wait for speech to finish before hanging up. */
  msPerChar: number;
}

const DEFAULTS: Record<LanguageCode, RelayLanguage> = {
  "en-US": {
    code: "en-US",
    englishName: "English",
    nativeName: "English",
    ttsProvider: "Google",
    voice: "en-US-Chirp3-HD-Aoede",
    transcriptionProvider: "Deepgram",
    speechModel: "nova-3-general",
    continueOffer: "We can continue in English. How can I help you today?",
    switchedConfirmation: "Sure, let's continue in English. How can I help you today?",
    msPerChar: 65,
  },
  "zh-CN": {
    code: "zh-CN",
    englishName: "Mandarin",
    nativeName: "普通话",
    ttsProvider: "Google",
    voice: "cmn-CN-Chirp3-HD-Aoede",
    transcriptionProvider: "Deepgram",
    speechModel: "nova-3-general",
    continueOffer: "您好，我们可以继续用普通话为您服务。请问有什么可以帮您？",
    switchedConfirmation: "好的，我们用普通话交流。请问有什么可以帮您？",
    msPerChar: 230,
  },
  "zh-HK": {
    code: "zh-HK",
    englishName: "Cantonese",
    nativeName: "廣東話",
    ttsProvider: "Google",
    voice: "yue-HK-Chirp3-HD-Aoede",
    transcriptionProvider: "Deepgram",
    speechModel: "nova-3-general",
    continueOffer: "你好，我哋可以繼續用廣東話同你傾。有咩可以幫到你？",
    switchedConfirmation: "好呀，我哋用廣東話傾。有咩可以幫到你？",
    msPerChar: 230,
  },
  "ko-KR": {
    code: "ko-KR",
    englishName: "Korean",
    nativeName: "한국어",
    ttsProvider: "Google",
    voice: "ko-KR-Chirp3-HD-Aoede",
    transcriptionProvider: "Google",
    speechModel: "telephony",
    continueOffer: "안녕하세요, 한국어로 계속 도와드릴게요. 무엇을 도와드릴까요?",
    switchedConfirmation: "네, 한국어로 도와드릴게요. 무엇을 도와드릴까요?",
    msPerChar: 200,
  },
};

function envKey(code: LanguageCode, field: string): string {
  return `CR_${code.replace("-", "_").toUpperCase()}_${field}`;
}

export function relayLanguages(env: NodeJS.ProcessEnv = process.env): Record<LanguageCode, RelayLanguage> {
  const out = {} as Record<LanguageCode, RelayLanguage>;
  for (const code of LANGUAGE_CODES) {
    const d = DEFAULTS[code];
    out[code] = {
      ...d,
      ttsProvider: env[envKey(code, "TTS_PROVIDER")] || d.ttsProvider,
      voice: env[envKey(code, "VOICE")] || d.voice,
      transcriptionProvider: env[envKey(code, "TRANSCRIPTION_PROVIDER")] || d.transcriptionProvider,
      speechModel: env[envKey(code, "SPEECH_MODEL")] || d.speechModel,
    };
  }
  return out;
}

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === "string" && (LANGUAGE_CODES as readonly string[]).includes(v);
}

/** Map loose inputs ("yue-HK", "zh-Hant-HK", "cmn-CN", "ko") onto a supported code. */
export function normalizeLanguage(v: string | null | undefined): LanguageCode | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s.startsWith("en")) return "en-US";
  if (s.startsWith("yue") || s === "zh-hk" || s.includes("hant-hk") || s === "cantonese") return "zh-HK";
  if (s.startsWith("cmn") || s.startsWith("zh") || s === "mandarin") return "zh-CN";
  if (s.startsWith("ko") || s === "korean") return "ko-KR";
  return null;
}

/** Keypad shortcuts: 1 English, 2 Mandarin, 3 Cantonese, 4 Korean. */
export const DTMF_LANGUAGES: Record<string, LanguageCode> = {
  "1": "en-US",
  "2": "zh-CN",
  "3": "zh-HK",
  "4": "ko-KR",
};
