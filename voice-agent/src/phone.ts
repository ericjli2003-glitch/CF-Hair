/**
 * Twilio reports withheld caller IDs either as words ("anonymous", "restricted")
 * or as placeholder numbers that spell them on a keypad.
 */
const ANONYMOUS_PLACEHOLDERS = new Set([
  "+266696687", // ANONYMOUS
  "+7378742833", // RESTRICTED
  "+8656696", // UNKNOWN
  "+86282452253", // UNAVAILABLE
]);

/** Normalize a North American or E.164 number to E.164. Returns null if it is not a usable number. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** True when the caller ID is withheld, blocked or otherwise unusable for callbacks or memory. */
export function isAnonymousCaller(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const lower = raw.trim().toLowerCase();
  if (["", "anonymous", "restricted", "unknown", "private", "unavailable", "blocked", "client:anonymous"].includes(lower)) {
    return true;
  }
  if (lower.startsWith("client:") || lower.startsWith("sip:")) return true;
  const e164 = toE164(raw);
  if (!e164) return true;
  return ANONYMOUS_PLACEHOLDERS.has(e164);
}

/** "+16045551234" -> "604 555 1234" for reading back to a caller. */
export function phoneForSpeech(e164: string): string {
  const d = e164.replace(/[^\d]/g, "");
  const local = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (local.length === 10) return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  return local;
}
