// Text rules for handwritten cards, shared by the API (PATCH /api/cards/{id}) and
// the inline editor in the admin, so the live count and the server agree.
// They mirror notes/src/text.ts: characters are counted as graphemes (what fits on
// paper), the English message must be plain punctuation a pen font can write, and
// no line may contain an emoji or an em or en dash.

export interface TextIssue {
  field: "message" | "messageAlt";
  code: "empty" | "too_long" | "dash" | "emoji" | "unsupported_char";
  message: string;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;

/** User-perceived characters (graphemes). */
export function charCount(s: string): number {
  if (!segmenter) return [...s].length;
  return [...segmenter.segment(s)].length;
}

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{200D}/u;
// Figure dash, en dash, em dash, horizontal bar, minus sign, two- and three-em dashes.
const LONG_DASH_RE = /[\u2012\u2013\u2014\u2015\u2212\u2E3A\u2E3B]/;
// What a Latin robot handwriting font or a plotter's Hershey font can write.
const PEN_SAFE_CHAR = /^[\x20-\x7E\n\u00C0-\u00FF]$/;

export const hasEmoji = (s: string) => EMOJI_RE.test(s);
export const hasLongDash = (s: string) => LONG_DASH_RE.test(s);

export function unsupportedChars(s: string): string[] {
  const bad = new Set<string>();
  for (const ch of [...s.normalize("NFC")]) if (!PEN_SAFE_CHAR.test(ch)) bad.add(ch);
  return [...bad];
}

/**
 * Quietly fixes what phones and Macs insert while typing: curly quotes become
 * straight ones, the ellipsis character becomes three dots, Windows line breaks and
 * trailing spaces go. Dashes and emoji are not changed: they are reported.
 */
export function normalizeCardText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Problems with a card's text. `message` is the English line written by the pen
 * robot; `messageAlt` is the Chinese or Korean line written by hand at the salon,
 * so it may use full-width punctuation but still no emoji or long dashes. Both are
 * held to the card's maxChars.
 */
export function checkCardText(text: { message?: string; messageAlt?: string | null }, maxChars: number): TextIssue[] {
  const issues: TextIssue[] = [];
  if (text.message !== undefined) {
    const m = text.message;
    const n = charCount(m);
    if (!m.trim()) issues.push({ field: "message", code: "empty", message: "The message is empty." });
    if (n > maxChars) issues.push({ field: "message", code: "too_long", message: `The message is ${n} characters; this card fits ${maxChars}.` });
    if (hasLongDash(m)) issues.push({ field: "message", code: "dash", message: "Use a comma or a period instead of a long dash." });
    if (hasEmoji(m)) issues.push({ field: "message", code: "emoji", message: "Remove the emoji: the pen cannot write it." });
    const bad = unsupportedChars(m).filter((c) => !hasEmoji(c) && !hasLongDash(c));
    if (bad.length) issues.push({ field: "message", code: "unsupported_char", message: `The pen cannot write: ${bad.join(" ")}` });
  }
  if (text.messageAlt) {
    const a = text.messageAlt;
    const n = charCount(a);
    if (n > maxChars) issues.push({ field: "messageAlt", code: "too_long", message: `The second-language line is ${n} characters; this card fits ${maxChars}.` });
    if (hasLongDash(a)) issues.push({ field: "messageAlt", code: "dash", message: "Use a comma instead of a long dash in the second-language line." });
    if (hasEmoji(a)) issues.push({ field: "messageAlt", code: "emoji", message: "Remove the emoji from the second-language line." });
  }
  return issues;
}
