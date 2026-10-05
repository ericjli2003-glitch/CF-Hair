import { normalizeLanguage, type LanguageCode } from "../languages.js";

/**
 * Spoken-language detection from what the transcriber returns.
 *
 * Why this exists: Twilio ConversationRelay's only built-in automatic language detection is
 * Deepgram `transcriptionLanguage="multi"`, and that model covers English, Spanish, French,
 * German, Hindi, Russian, Portuguese, Japanese, Italian and Dutch, not Mandarin, Cantonese or
 * Korean (checked 2026-10-04, see README). So a new caller's call starts in English (a returning
 * caller's starts in their saved language) and this module looks at
 * every final transcript for:
 *   1. an explicit request for a language, in that language or romanized ("廣東話", "hangugeo")
 *   2. the script: Hangul means Korean, Han characters mean Chinese
 *   3. Cantonese-only words and particles versus Mandarin usage, to pick zh-HK or zh-CN
 *   4. the provider's language tag (prompt `lang`, filled in when transcription runs in "multi")
 *   5. romanized greetings in an English transcript ("nei hou", "annyeong"): too weak to switch on,
 *      so the agent asks one short question in all four languages instead of guessing
 * It avoids flapping: short or ambiguous utterances never switch, one English word never takes a
 * caller out of their language, and Cantonese is never auto-switched to Mandarin.
 */

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/gu;
const HAN = /[㐀-䶿一-鿿豈-﫿]/gu;
const KANA = /[぀-ヿ]/gu;
const LATIN_WORD = /[a-z]+(?:'[a-z]+)?/giu;

/** Spoken-Cantonese words and particles that do not occur in Mandarin speech. */
const CANTONESE_MARKERS = [
  "唔該", "唔使", "唔好", "幾多", "點解", "邊度", "邊個", "而家", "聽日", "尋日", "琴日", "今日", "乜嘢", "咩嘢", "冇問題", "係咪", "得唔得",
  "嘅", "咗", "唔", "冇", "喺", "哋", "嗰", "乜", "嘢", "嚟", "啲", "佢", "咩", "噉", "㗎", "喎", "嘞", "囉", "啩", "睇", "諗", "攞", "畀", "搵", "揾", "嗎?",
];
/** Mandarin-only function words (written forms in simplified and traditional). */
const MANDARIN_MARKERS = [
  "什么", "什麼", "怎么", "怎麼", "明天", "昨天", "现在", "現在", "多少", "哪里", "哪裡", "没有", "沒有",
  "的", "了", "们", "們", "吗", "嗎", "呢", "这", "這", "谁", "誰", "给", "給", "没", "沒",
];
const SIMPLIFIED_ONLY = "们这说么发头时间约预钱个对话还给预东语国见过请问剪约吗没长门两车";
const TRADITIONAL_ONLY = "們這說麼髮頭時間約預錢個對話還給預東語國見過請問約嗎沒長門兩車";

interface Explicit {
  language: LanguageCode;
  pattern: RegExp;
}

/** Native and romanized names for each language. Spoken alone, these are a clear request. */
const EXPLICIT_NATIVE: Explicit[] = [
  { language: "zh-HK", pattern: /广东话|廣東話|粤语|粵語|广府话|廣府話|白話|gwong\s*dung\s*wa|kwong\s*tung\s*wah?|guang\s*dong\s*hua|jyut\s*jyu|yuet\s*yu/iu },
  { language: "zh-CN", pattern: /普通话|普通話|国语|國語|华语|華語|汉语|漢語|pu\s*tong\s*hua|guo\s*yu|kuo\s*yu/iu },
  { language: "ko-KR", pattern: /한국어|한국말|韩语|韓語|韩国话|韓國話|hangu?k?\s*(?:eo|mal)|hangugeo|hangungmal/iu },
  { language: "en-US", pattern: /英文|英语|英語|영어/u },
];
/** English names: only trusted when Claude decides the caller is asking for that language. */
const EXPLICIT_ENGLISH: Explicit[] = [
  { language: "zh-HK", pattern: /\bcantonese\b/i },
  { language: "zh-CN", pattern: /\bmandarin\b/i },
  { language: "ko-KR", pattern: /\bkorean\b/i },
  { language: "en-US", pattern: /\benglish\b/i },
];
/** "Chinese" or 中文 fits either Mandarin or Cantonese. */
const CHINESE_GENERIC = /\bchinese\b|中文/iu;

/** Romanized greetings that an English transcriber may produce. Weak evidence only. */
const ROMANIZED_HINTS: { language: LanguageCode; pattern: RegExp }[] = [
  { language: "zh-HK", pattern: /\b(?:nei|lei|nay|lay)\s*(?:hou|ho|hoh)\b|\b(?:m|mm|ng)\s*goi\b|\bdoh?\s*je(?:h)?\b/i },
  { language: "zh-CN", pattern: /\b(?:ni|nee|knee|nin)\s*(?:hao|how)\b|\b(?:xie|shie|shay)\s*(?:xie|shie|shay)\b/i },
  { language: "ko-KR", pattern: /\ban+\s*n?y[eo]o?ng\b|\bannyeong\w*|\bahn?\s*young\b|\byeo?bo\s*se?yo\b|\b[gk]amsa\s*hamnida\b|\b[gk]amsahamnida\b/i },
];

export interface UtteranceAnalysis {
  hangul: number;
  han: number;
  kana: number;
  latinWords: number;
  cantonese: number;
  mandarin: number;
  /** Request for a language by its own name, in its own script or romanized. */
  explicitNative: LanguageCode | "zh" | null;
  /** Request mentioning an English language name ("Cantonese please"). */
  explicitEnglish: LanguageCode | "zh" | null;
  romanizedHint: LanguageCode | null;
  traditionalLean: number;
}

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function countMarkers(text: string, markers: string[]): number {
  let n = 0;
  let rest = text;
  for (const m of markers) {
    // Multi-character markers first (the arrays are ordered that way); remove them once counted.
    const parts = rest.split(m);
    if (parts.length > 1) {
      n += parts.length - 1;
      rest = parts.join(" ");
    }
  }
  return n;
}

export function analyzeUtterance(text: string): UtteranceAnalysis {
  const t = text.normalize("NFC");
  let explicitNative: UtteranceAnalysis["explicitNative"] = null;
  for (const e of EXPLICIT_NATIVE) if (e.pattern.test(t)) explicitNative ??= e.language;
  if (!explicitNative && /中文/u.test(t)) explicitNative = "zh";
  let explicitEnglish: UtteranceAnalysis["explicitEnglish"] = null;
  for (const e of EXPLICIT_ENGLISH) if (e.pattern.test(t)) explicitEnglish ??= e.language;
  if (!explicitEnglish && CHINESE_GENERIC.test(t)) explicitEnglish = "zh";
  let romanizedHint: LanguageCode | null = null;
  for (const r of ROMANIZED_HINTS) if (r.pattern.test(t)) romanizedHint ??= r.language;
  let simp = 0;
  let trad = 0;
  for (const ch of t) {
    if (SIMPLIFIED_ONLY.includes(ch) && !TRADITIONAL_ONLY.includes(ch)) simp++;
    if (TRADITIONAL_ONLY.includes(ch) && !SIMPLIFIED_ONLY.includes(ch)) trad++;
  }
  return {
    hangul: count(t, HANGUL),
    han: count(t, HAN),
    kana: count(t, KANA),
    latinWords: count(t, LATIN_WORD),
    cantonese: countMarkers(t.replace(/關係|关系/gu, ""), CANTONESE_MARKERS),
    mandarin: countMarkers(t, MANDARIN_MARKERS),
    explicitNative,
    explicitEnglish,
    romanizedHint,
    traditionalLean: trad - simp,
  };
}

/** Mandarin or Cantonese, from text cues. Used when Chinese text first appears. */
export function chineseVariant(a: UtteranceAnalysis, providerLang?: string | null): "zh-CN" | "zh-HK" {
  if (a.cantonese >= 2) return "zh-HK";
  if (a.cantonese === 1 && a.mandarin <= 2) return "zh-HK";
  if (a.mandarin > 0) return "zh-CN";
  const tag = (providerLang ?? "").toLowerCase();
  if (tag.startsWith("yue") || tag === "zh-hk" || tag.includes("hant-hk")) return "zh-HK";
  return a.traditionalLean > 0 ? "zh-HK" : "zh-CN";
}

/**
 * Does the caller's last utterance justify switching to `target`? Used to vet Claude's
 * set_language calls, so the model cannot flip languages on "OK" or a name.
 */
export function languageEvidence(text: string, target: LanguageCode): { ok: boolean; reason: string } {
  const a = analyzeUtterance(text);
  const named = a.explicitNative ?? a.explicitEnglish;
  if (named === target || (named === "zh" && target.startsWith("zh"))) return { ok: true, reason: "caller named the language" };
  if (target === "ko-KR" && a.hangul >= 2) return { ok: true, reason: "Korean script in transcript" };
  if (target.startsWith("zh") && a.han >= 2 && a.kana === 0) return { ok: true, reason: "Chinese characters in transcript" };
  if (target === "en-US" && a.latinWords >= 3 && a.hangul + a.han + a.kana === 0) return { ok: true, reason: "full English sentence" };
  if (target === "en-US") {
    return { ok: false, reason: "The caller did not ask for English and said only a word or two in English." };
  }
  return { ok: false, reason: "The transcript does not show that language and the caller did not ask for it." };
}

export type DetectAction =
  | { action: "none"; reason?: string }
  | { action: "switch"; to: LanguageCode; reason: string }
  | { action: "ask"; reason: string };

export interface DetectorOptions {
  /** Ask the four-language question when the evidence is weak. */
  askEnabled: boolean;
  /** At most this many questions per call. */
  maxAsks: number;
}

export class LanguageDetector {
  private englishStreak = 0;
  private cantoneseStreak = 0;
  asked = 0;

  constructor(private readonly opts: DetectorOptions = { askEnabled: true, maxAsks: 2 }) {}

  /** Call after any language change so streaks start fresh. */
  reset() {
    this.englishStreak = 0;
    this.cantoneseStreak = 0;
  }

  canAsk(): boolean {
    return this.opts.askEnabled && this.asked < this.opts.maxAsks;
  }

  noteAsked() {
    this.asked++;
  }

  observe(text: string, current: LanguageCode, providerLang?: string | null): DetectAction {
    const a = analyzeUtterance(text);
    const cjk = a.hangul + a.han + a.kana;

    // 1. Asked for a language by its own name.
    if (a.explicitNative && a.explicitNative !== "zh") {
      return a.explicitNative === current ? { action: "none" } : { action: "switch", to: a.explicitNative, reason: "caller named the language" };
    }

    // 2. Korean script.
    if (a.hangul >= 2 && a.hangul >= a.han) {
      this.englishStreak = 0;
      return current === "ko-KR" ? { action: "none" } : { action: "switch", to: "ko-KR", reason: "Korean script in transcript" };
    }

    // 3. Chinese characters.
    if (a.han >= 2 && a.kana === 0) {
      this.englishStreak = 0;
      if (current === "zh-HK") {
        // Cantonese transcripts can look like written Mandarin; never auto-switch away from Cantonese.
        return { action: "none" };
      }
      if (current === "zh-CN") {
        if (a.cantonese >= 2) return { action: "switch", to: "zh-HK", reason: "Cantonese words in transcript" };
        if (a.cantonese === 1) {
          this.cantoneseStreak++;
          if (this.cantoneseStreak >= 2) return { action: "switch", to: "zh-HK", reason: "Cantonese words in two utterances" };
        } else {
          this.cantoneseStreak = 0;
        }
        return { action: "none" };
      }
      return { action: "switch", to: chineseVariant(a, providerLang), reason: "Chinese characters in transcript" };
    }

    // 4. Back to English: only after two full English sentences in a row (one word never counts).
    if (current !== "en-US") {
      if (a.latinWords >= 3 && cjk === 0) {
        this.englishStreak++;
        if (this.englishStreak >= 2) return { action: "switch", to: "en-US", reason: "two English sentences in a row" };
      } else if (cjk > 0) {
        this.englishStreak = 0;
      }
      return { action: "none" };
    }

    // 5. English call, weak signs of another language: ask rather than guess.
    const tag = normalizeLanguage(providerLang ?? "");
    const foreignTag = !!providerLang && !/^en/i.test(providerLang) && (tag === null || tag !== "en-US");
    const weak = a.romanizedHint
      ? `romanized ${a.romanizedHint} greeting`
      : a.kana > 0
        ? "Japanese-looking transcript"
        : foreignTag
          ? `transcriber tagged speech as ${providerLang}`
          : null;
    if (weak && this.canAsk()) return { action: "ask", reason: weak };
    return { action: "none" };
  }
}
