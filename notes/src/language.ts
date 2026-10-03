/**
 * Client languages and the second-language card version.
 *
 * Booking API codes: en-US, zh-CN (Mandarin), zh-HK (Cantonese), ko-KR (Korean).
 * - zh-CN gets Simplified Chinese.
 * - zh-HK gets Traditional Chinese in standard written Chinese with Hong Kong usage.
 *   Hong Kong readers learn and read Traditional characters, so Simplified would read as
 *   "mainland" and slightly off. We do not write colloquial Cantonese characters (嘅, 咗, 啲):
 *   they are common in texts and ads but a handwritten card from a business reads as more
 *   respectful in standard written Chinese, especially for the older Cantonese-speaking
 *   clients who make up much of a Henderson Place salon's Cantonese clientele.
 * - ko-KR gets Korean (Hangul, polite 해요체 with 님).
 * Pen robots and Hershey plotter fonts are Latin-only, so these lines are always added by
 * hand at the salon (shown that way on the proof, listed in hand-finish.txt for the plotter).
 */
import type { AltScript, LanguageCode } from "./types.js";

export const LANGUAGE_CODES: LanguageCode[] = ["en-US", "zh-CN", "zh-HK", "ko-KR"];

/** Map whatever the source says (code, name, tag) to a booking API language code. */
export function normaliseLanguage(v: string | undefined | null, tags: string[] = []): LanguageCode {
  const raw = (v ?? "").trim().toLowerCase();
  const exact = LANGUAGE_CODES.find((c) => c.toLowerCase() === raw);
  if (exact) return exact;
  const s = `${raw} ${tags.join(" ").toLowerCase()}`;
  if (/\b(zh-hk|zh-tw|zh-hant|yue|cantonese|lang:zh-hk|lang:yue)\b/.test(s) || /粤语|粵語|廣東話|繁體/.test(s)) return "zh-HK";
  if (/\b(zh|zh-cn|zh-hans|zh-sg|chinese|mandarin|lang:zh|lang:zh-cn)\b/.test(s) || /中文|普通话|简体/.test(s)) return "zh-CN";
  if (/\b(ko|ko-kr|kor|korean|lang:ko)\b/.test(s) || /한국어/.test(s)) return "ko-KR";
  return "en-US";
}

export function altScriptFor(lang: LanguageCode): AltScript | undefined {
  switch (lang) {
    case "zh-CN":
      return "zh-Hans";
    case "zh-HK":
      return "zh-Hant";
    case "ko-KR":
      return "ko";
    default:
      return undefined;
  }
}

export const ALT_LABEL: Record<AltScript, string> = {
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ko: "Korean",
};

/** Short tag shown on the proof sheet, in the language itself. */
export const ALT_TAG: Record<AltScript, string> = {
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ko: "한국어",
};

/** Instruction for the writer, per script. */
export const ALT_INSTRUCTION: Record<AltScript, string> = {
  "zh-Hans": "Simplified Chinese for a Mandarin-speaking reader (mainland conventions, simplified characters only)",
  "zh-Hant":
    "Traditional Chinese for a Cantonese-speaking Hong Kong reader: traditional characters only, standard written Chinese with Hong Kong word choices, no colloquial Cantonese characters",
  ko: "Korean (Hangul) in the polite 해요체 style, addressing the client with 님",
};

/** Character limit for the second version. Hangul needs word spaces, so it gets more room. */
export function altLimit(maxCharsAlt: number, script: AltScript | undefined): number {
  return script === "ko" ? Math.round(maxCharsAlt * 1.4) : maxCharsAlt;
}

// Common characters that exist in only one of the two Chinese scripts.
const SIMPLIFIED_ONLY = "们这时来为发么说个欢谢过对让给还见长间问门开关东车头经费体爱亲乐节岁剪烫护发约预约边样觉网区买卖热华丽惊喜";
const TRADITIONAL_ONLY = "們這時來為發麼說個歡謝過對讓給還見長間問門開關東車頭經費體愛親樂節歲剪燙護髮約預約邊樣覺網區買賣熱華麗驚喜";
const SIMP_SET = new Set([...SIMPLIFIED_ONLY].filter((c) => !TRADITIONAL_ONLY.includes(c)));
const TRAD_SET = new Set([...TRADITIONAL_ONLY].filter((c) => !SIMPLIFIED_ONLY.includes(c)));

/** Characters that betray the wrong script (e.g. 们 in a Traditional card), or a missing script. */
export function wrongScriptChars(text: string, script: AltScript): string[] {
  const chars = [...text];
  if (script === "zh-Hans") return [...new Set(chars.filter((c) => TRAD_SET.has(c)))];
  if (script === "zh-Hant") return [...new Set(chars.filter((c) => SIMP_SET.has(c)))];
  // Korean: must contain Hangul; Han characters would be unusual on a modern card.
  const hasHangul = /[가-힣]/.test(text);
  const han = chars.filter((c) => /[一-鿿]/.test(c));
  return hasHangul ? [...new Set(han)] : ["(no Hangul)"];
}
