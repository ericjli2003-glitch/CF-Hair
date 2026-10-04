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
  /** This language's part of the four-language "which language?" question. */
  questionPart: string;
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
    questionPart: "Sorry, which language would you like? For English, press 1.",
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
    questionPart: "普通话请按2。",
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
    questionPart: "廣東話請按3。",
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
    questionPart: "한국어는 4번을 눌러 주세요.",
    msPerChar: 200,
  },
};

function envKey(code: LanguageCode, field: string): string {
  return `CR_${code.replace("-", "_").toUpperCase()}_${field}`;
}

/** ElevenLabs models usable inside ConversationRelay and the languages relevant to this salon. */
export const ELEVENLABS_RELAY_LANGUAGES: Record<string, LanguageCode[]> = {
  // Flash v2.5 and Turbo v2.5 cover English, Mandarin and Korean, but not Cantonese (checked 2026-10-04).
  flash_v2_5: ["en-US", "zh-CN", "ko-KR"],
  turbo_v2_5: ["en-US", "zh-CN", "ko-KR"],
  flash_v2: ["en-US"],
  turbo_v2: ["en-US"],
};

/**
 * Per-language ConversationRelay settings, with environment overrides.
 *
 * Per language: CR_<LANG>_TTS_PROVIDER, CR_<LANG>_VOICE, CR_<LANG>_TRANSCRIPTION_PROVIDER,
 * CR_<LANG>_SPEECH_MODEL (LANG is EN_US, ZH_CN, ZH_HK or KO_KR).
 * ElevenLabs shortcut: CR_TTS_PROVIDER=ElevenLabs plus CR_ELEVENLABS_VOICE (a voice ID) and
 * optionally CR_ELEVENLABS_MODEL (flash_v2_5 default) switch every language that the model supports.
 * Cantonese stays on its own provider unless CR_ZH_HK_TTS_PROVIDER says otherwise.
 */
export function relayLanguages(env: NodeJS.ProcessEnv = process.env): Record<LanguageCode, RelayLanguage> {
  const out = {} as Record<LanguageCode, RelayLanguage>;
  const global = (env.CR_TTS_PROVIDER ?? "").trim();
  const elModel = (env.CR_ELEVENLABS_MODEL ?? "flash_v2_5").trim();
  const elVoice = (env.CR_ELEVENLABS_VOICE ?? "").trim();
  for (const code of LANGUAGE_CODES) {
    const d = DEFAULTS[code];
    let ttsProvider = d.ttsProvider;
    let voice = d.voice;
    if (/^elevenlabs$/i.test(global) && elVoice && (ELEVENLABS_RELAY_LANGUAGES[elModel] ?? []).includes(code)) {
      ttsProvider = "ElevenLabs";
      voice = elModel === "flash_v2_5" || elVoice.includes("-") ? elVoice : `${elVoice}-${elModel}`;
    }
    out[code] = {
      ...d,
      ttsProvider: env[envKey(code, "TTS_PROVIDER")] || ttsProvider,
      voice: env[envKey(code, "VOICE")] || voice,
      transcriptionProvider: env[envKey(code, "TRANSCRIPTION_PROVIDER")] || d.transcriptionProvider,
      speechModel: env[envKey(code, "SPEECH_MODEL")] || d.speechModel,
    };
  }
  return out;
}

/** Configuration problems worth printing at startup. */
export function languageWarnings(langs: Record<LanguageCode, RelayLanguage>, env: NodeJS.ProcessEnv = process.env): string[] {
  const w: string[] = [];
  if (/^elevenlabs$/i.test(env.CR_TTS_PROVIDER ?? "") && !env.CR_ELEVENLABS_VOICE) {
    w.push("CR_TTS_PROVIDER=ElevenLabs needs CR_ELEVENLABS_VOICE (an ElevenLabs voice ID); keeping the default voices.");
  }
  for (const code of LANGUAGE_CODES) {
    const l = langs[code];
    if (/^elevenlabs$/i.test(l.ttsProvider)) {
      // Twilio format: <voiceId>[-<model>[-<speed>_<stability>_<similarity>]]
      const model = l.voice.split("-")[1] || "flash_v2_5";
      const covered = ELEVENLABS_RELAY_LANGUAGES[model];
      if (covered && !covered.includes(code)) {
        w.push(`${code} uses ElevenLabs ${model}, which does not list ${l.englishName}. Expect a wrong accent or errors; use Google for ${code}.`);
      }
    }
  }
  return w;
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
