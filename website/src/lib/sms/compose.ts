// Builds the final promotional text. CASL requires every commercial message to
// identify the sender and offer a free, easy way to unsubscribe, so this is the
// only place a promotional body becomes a sendable message: the sender prefix and
// the localised "Reply STOP" footer are always added here and always counted in
// the segment length.
import { LANGUAGE_CODES, type LanguageCode } from "../languages";
import { salon } from "../salon";
import { countSegments, type SegmentInfo } from "./segments";

export const CAMPAIGN_LANGS = LANGUAGE_CODES;
export type CampaignBodies = Partial<Record<LanguageCode, string>> & { "en-US": string };

export const SENDER_NAME = salon.name; // "CF Hair Salon"

/** Localised opt-out line. Kept short so English promos fit one segment. */
export const OPT_OUT_FOOTER: Record<LanguageCode, string> = {
  "en-US": "Reply STOP to opt out.",
  "zh-CN": "回复STOP或退订即可退订。",
  "zh-HK": "回覆STOP或退訂即可取消。",
  "ko-KR": "수신거부: STOP 회신",
};

const SEP: Record<LanguageCode, string> = { "en-US": ": ", "zh-CN": "：", "zh-HK": "：", "ko-KR": ": " };

/** Optional short link to the identification page (mailing address, contact), e.g. "cfhair.ca/sms". */
function infoLine(lang: LanguageCode): string {
  const url = (process.env.SMS_INFO_URL ?? "").trim();
  if (!url) return "";
  return lang === "en-US" ? ` Info ${url}` : ` ${url}`;
}

export function hasSenderId(text: string): boolean {
  return text.toLowerCase().includes(SENDER_NAME.toLowerCase());
}

/**
 * Final text for one language: "CF Hair Salon: <body> Reply STOP to opt out."
 * The sender prefix is skipped only when the body already starts with the salon name.
 */
export function composePromo(body: string, lang: LanguageCode): string {
  const clean = body.replace(/\s+$/g, "").replace(/^\s+/g, "");
  const startsWithName = clean.toLowerCase().startsWith(SENDER_NAME.toLowerCase());
  const head = startsWithName ? clean : `${SENDER_NAME}${SEP[lang]}${clean}`;
  const cjk = lang === "zh-CN" || lang === "zh-HK";
  const glue = /[。！？]$/.test(head) ? "" : /[.!?]$/.test(head) ? " " : cjk ? "。" : ". ";
  return `${head}${glue}${OPT_OUT_FOOTER[lang]}${infoLine(lang)}`.replace(/\s+$/, "");
}

/** Guard used right before sending: refuses a message that lost its sender ID or opt-out line. */
export function assertCompliant(text: string, lang: LanguageCode): void {
  if (!hasSenderId(text)) throw new Error("Promotional SMS must identify the sender");
  if (!text.includes(OPT_OUT_FOOTER[lang])) throw new Error("Promotional SMS must include the opt-out instruction");
}

/**
 * Picks the version for a customer's preferredLanguage, falling back to English.
 * Cantonese (zh-HK) readers get English rather than Simplified Chinese unless a
 * Traditional Chinese version was written.
 */
export function pickLanguage(bodies: CampaignBodies, preferred: string): LanguageCode {
  const lang = (CAMPAIGN_LANGS as readonly string[]).includes(preferred) ? (preferred as LanguageCode) : "en-US";
  return bodies[lang]?.trim() ? lang : "en-US";
}

export interface PreviewItem {
  language: LanguageCode;
  text: string;
  info: SegmentInfo;
  custom: boolean;
}

export function previewAll(bodies: CampaignBodies): PreviewItem[] {
  return CAMPAIGN_LANGS.map((language) => {
    const custom = !!bodies[language]?.trim();
    const lang = custom ? language : "en-US";
    const text = composePromo(bodies[lang] ?? "", lang);
    return { language, text, info: countSegments(text), custom };
  });
}

export function parseBodies(raw: string | null | undefined): CampaignBodies {
  try {
    const v = JSON.parse(raw ?? "{}");
    const out: CampaignBodies = { "en-US": typeof v["en-US"] === "string" ? v["en-US"] : "" };
    for (const l of CAMPAIGN_LANGS) if (typeof v[l] === "string" && v[l].trim()) out[l] = v[l];
    return out;
  } catch {
    return { "en-US": "" };
  }
}
