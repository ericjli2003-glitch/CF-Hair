import { isLang, type Lang } from "./i18n/dictionary";

export const LANGUAGE_CODES = ["en-US", "zh-CN", "zh-HK", "ko-KR"] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
export const DEFAULT_LANGUAGE: LanguageCode = "en-US";

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === "string" && (LANGUAGE_CODES as readonly string[]).includes(v);
}

export const LANGUAGE_LABELS: Record<LanguageCode, { label: string; native: string; short: string }> = {
  "en-US": { label: "English", native: "English", short: "EN" },
  "zh-CN": { label: "Mandarin", native: "普通话", short: "普" },
  "zh-HK": { label: "Cantonese", native: "粵語", short: "粵" },
  "ko-KR": { label: "Korean", native: "한국어", short: "한" },
};

/** The customer language that matches each website language. */
export const SITE_LANG_TO_LANGUAGE: Record<Lang, LanguageCode> = { en: "en-US", zh: "zh-CN", hk: "zh-HK", ko: "ko-KR" };

export function languageForSiteLang(v: unknown): LanguageCode | null {
  return isLang(v) ? SITE_LANG_TO_LANGUAGE[v] : null;
}

/**
 * The preference to keep after a website booking. The site language only fills in a
 * missing or default (en-US) preference; an explicit one, for example set by the
 * phone agent or the owner, is never replaced.
 */
export function preferredLanguageAfterWebBooking(current: unknown, site: LanguageCode | null | undefined): LanguageCode {
  const cur = isLanguageCode(current) ? current : DEFAULT_LANGUAGE;
  return cur === DEFAULT_LANGUAGE && site ? site : cur;
}
