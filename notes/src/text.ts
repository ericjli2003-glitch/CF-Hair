/**
 * Text rules for cards that a pen robot or plotter will write:
 * character counting, sanitising, and validation against campaign and provider limits.
 */
import type { NoteIssue } from "./types.js";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Count user-perceived characters (graphemes), which is what fits on paper. */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{200D}/u;
// Em dash, en dash, figure dash, horizontal bar, minus sign, two/three-em dashes.
const LONG_DASH_RE = /[\u2012\u2013\u2014\u2015\u2212\u2E3A\u2E3B]/;

/**
 * Normalise text for a pen: straight quotes, no long dashes, tidy whitespace.
 * Long dashes become commas (" word, word ") since a plotter font and our style
 * rules both exclude them.
 */
export function sanitizeForPen(input: string): string {
  let s = input.normalize("NFC");
  s = s.replace(/[\u2018\u2019\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201F\u2033]/g, '"');
  s = s.replace(/\u2026/g, "...");
  s = s.replace(/(\d)\s*[\u2012\u2013\u2014\u2015]\s*(\d)/g, "$1 to $2");
  s = s.replace(/\s*[\u2012\u2013\u2014\u2015\u2212\u2E3A\u2E3B]+\s*/g, ", ");
  s = s.replace(/,\s*,/g, ",").replace(/,\s*([.!?])/g, "$1");
  s = s.replace(/[ \t\u00A0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Simplified Chinese clean-up: full-width punctuation stays, long dashes go. */
export function sanitizeZh(input: string): string {
  let s = input.normalize("NFC");
  s = s.replace(/\s*[\u2012\u2013\u2014\u2015\u2212\u2E3A\u2E3B]+\s*/g, "\uFF0C");
  s = s.replace(/\uFF0C\uFF0C/g, "\uFF0C").replace(/[ \t\u00A0]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Characters a Latin-only robot handwriting font or Hershey font can write. */
const PEN_SAFE_RE = /^[\x20-\x7E\n\u00C0-\u00FF]*$/;

export function unsupportedChars(s: string): string[] {
  if (PEN_SAFE_RE.test(s)) return [];
  const bad = new Set<string>();
  for (const { segment } of segmenter.segment(s)) {
    if (!PEN_SAFE_RE.test(segment)) bad.add(segment);
  }
  return [...bad];
}

export function hasEmoji(s: string): boolean {
  return EMOJI_RE.test(s);
}

export function hasLongDash(s: string): boolean {
  return LONG_DASH_RE.test(s);
}

const SALESY = [
  /\blimited[- ]time\b/i,
  /\bact (now|fast)\b/i,
  /\bdon'?t miss (out|this)\b/i,
  /\bhurry\b/i,
  /\bexclusive (deal|offer)\b/i,
  /\bbook (now|today)!/i,
  /\bbest prices?\b/i,
  /\bspecial promotion\b/i,
  /\bwhile supplies last\b/i,
  /!!/,
];

export interface ValidateOptions {
  firstName: string;
  maxChars: number;
  maxCharsZh: number;
  maxSignatureChars: number;
  signature: string;
  requireZh: boolean;
  offerCode?: string;
  /** Strings that must never appear in a note (street line, postal code, phone digits, birth year...). */
  forbidden?: string[];
}

export interface ValidationResult {
  issues: NoteIssue[];
  charCount: number;
  charCountZh?: number;
}

/** Validate a finished note. Callers sanitise first; this only reports. */
export function validateNote(message: string, messageZh: string | undefined, opts: ValidateOptions): ValidationResult {
  const issues: NoteIssue[] = [];
  const n = charCount(message);
  if (!message.trim()) issues.push({ code: "empty", message: "Message is empty." });
  if (n > opts.maxChars) {
    issues.push({ code: "too_long", message: `Message is ${n} characters; the limit is ${opts.maxChars}.` });
  }
  if (hasEmoji(message) || (messageZh && hasEmoji(messageZh))) {
    issues.push({ code: "emoji", message: "Contains an emoji; pen plotters cannot write emoji." });
  }
  if (hasLongDash(message) || (messageZh && hasLongDash(messageZh))) {
    issues.push({ code: "dash", message: "Contains an em or en dash." });
  }
  const bad = unsupportedChars(message);
  if (bad.length) {
    issues.push({ code: "unsupported_char", message: `Characters the pen font cannot write: ${bad.join(" ")}` });
  }
  if (opts.firstName && !message.toLowerCase().includes(opts.firstName.toLowerCase())) {
    issues.push({ code: "missing_name", message: `Does not greet ${opts.firstName} by name.` });
  }
  for (const f of opts.forbidden ?? []) {
    if (f && f.length >= 3 && message.toLowerCase().includes(f.toLowerCase())) {
      issues.push({ code: "sensitive_detail", message: `Mentions a private detail ("${f}").` });
    }
  }
  for (const re of SALESY) {
    if (re.test(message)) {
      issues.push({ code: "salesy", message: `Sounds salesy (${re.source}).` });
      break;
    }
  }
  if (opts.offerCode && !message.includes(opts.offerCode)) {
    issues.push({ code: "offer_missing", message: `Offer code ${opts.offerCode} is missing.` });
  }
  const sigLen = charCount(opts.signature);
  if (sigLen > opts.maxSignatureChars) {
    issues.push({ code: "signature_too_long", message: `Signature is ${sigLen} characters; limit ${opts.maxSignatureChars}.` });
  }
  let nZh: number | undefined;
  if (opts.requireZh) {
    if (!messageZh || !messageZh.trim()) {
      issues.push({ code: "zh_missing", message: "Chinese version requested but missing." });
    } else {
      nZh = charCount(messageZh);
      if (nZh > opts.maxCharsZh) {
        issues.push({ code: "too_long_zh", message: `Chinese version is ${nZh} characters; the limit is ${opts.maxCharsZh}.` });
      }
    }
  }
  return { issues, charCount: n, charCountZh: nZh };
}

/** Issues the writer should retry on (everything except problems with our own inputs). */
export function retryable(issues: NoteIssue[]): boolean {
  return issues.some((i) => i.code !== "signature_too_long" && i.code !== "refusal" && i.code !== "api_error");
}
