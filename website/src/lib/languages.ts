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
