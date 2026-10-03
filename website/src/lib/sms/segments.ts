// SMS segment counting. A message that only uses the GSM-7 alphabet fits 160
// characters in one segment (153 per segment when split, because of the 6 byte
// concatenation header). Anything outside GSM-7 (Chinese, Korean, emoji, curly
// quotes) switches the whole message to UCS-2: 70 per segment, 67 when split.
// Twilio bills per segment, so this drives the cost estimate.

// GSM 03.38 basic character set.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
// Extension table: each costs two septets (escape + char).
const GSM_EXTENDED = "^{}\\[~]|€\f";

const BASIC = new Set(Array.from(GSM_BASIC));
const EXTENDED = new Set(Array.from(GSM_EXTENDED));

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** Length in the encoding's units: septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  /** Visible characters (code points). */
  characters: number;
  segments: number;
  /** Capacity of one segment at the current size (160/153 or 70/67). */
  perSegment: number;
  /** Units left before the next segment starts. */
  remaining: number;
  /** Characters that forced UCS-2, for the composer hint. */
  nonGsm: string[];
}

export function isGsm7(text: string): boolean {
  for (const ch of text) if (!BASIC.has(ch) && !EXTENDED.has(ch)) return false;
  return true;
}

export function countSegments(text: string): SegmentInfo {
  const chars = Array.from(text);
  const nonGsm = [...new Set(chars.filter((c) => !BASIC.has(c) && !EXTENDED.has(c)))];
  if (nonGsm.length === 0) {
    const units = chars.reduce((n, c) => n + (EXTENDED.has(c) ? 2 : 1), 0);
    const single = units <= 160;
    const per = single ? 160 : 153;
    const segments = units === 0 ? 0 : single ? 1 : Math.ceil(units / 153);
    return {
      encoding: "GSM-7",
      units,
      characters: chars.length,
      segments,
      perSegment: per,
      remaining: segments === 0 ? 160 : per * segments - units,
      nonGsm,
    };
  }
  // UCS-2: Twilio counts UTF-16 code units, so an emoji takes two.
  const units = text.length;
  const single = units <= 70;
  const per = single ? 70 : 67;
  const segments = single ? 1 : Math.ceil(units / 67);
  return {
    encoding: "UCS-2",
    units,
    characters: chars.length,
    segments,
    perSegment: per,
    remaining: per * segments - units,
    nonGsm,
  };
}

/** Twilio list price for Canada plus a typical carrier fee, USD per segment. See website/README.md. */
export function costPerSegmentUSD(): number {
  const v = Number(process.env.SMS_COST_PER_SEGMENT_USD);
  return Number.isFinite(v) && v > 0 ? v : 0.0163;
}
