import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Normalises a phone number to E.164, defaulting to Canada (+1). Returns null if invalid. */
export function toE164(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  const p = parsePhoneNumberFromString(raw, "CA");
  if (!p || !p.isValid()) return null;
  return p.number;
}
