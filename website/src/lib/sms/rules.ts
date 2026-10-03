// Pure scheduling and eligibility rules for promotional texts. No database access,
// so they are unit tested directly (tests/sms-rules.test.ts).
import { addDays, dateKeyOf, minutesOfDay, zonedTime } from "../time";

// ---------------------------------------------------------------- quiet hours

export const QUIET_START_MIN = 9 * 60; // first allowed minute: 09:00
export const QUIET_END_MIN = 20 * 60; // sends must start before 20:00

export function inSendWindow(at: Date, tz: string, start = QUIET_START_MIN, end = QUIET_END_MIN): boolean {
  const m = minutesOfDay(at, tz);
  return m >= start && m < end;
}

/**
 * The earliest time at or after `at` when a promotional text may go out:
 * unchanged inside 09:00 to 20:00 local time, 09:00 the same day if earlier,
 * 09:00 the next day if 20:00 or later. DST-safe (uses wall-clock times).
 */
export function nextAllowedSendTime(at: Date, tz: string, start = QUIET_START_MIN, end = QUIET_END_MIN): Date {
  const m = minutesOfDay(at, tz);
  const day = dateKeyOf(at, tz);
  if (m < start) return zonedTime(day, start, tz);
  if (m >= end) return zonedTime(addDays(day, 1), start, tz);
  return at;
}

// ---------------------------------------------------------------- consent

export type ConsentStatus = "none" | "express" | "implied" | "withdrawn";
export const CONSENT_STATUSES: ConsentStatus[] = ["none", "express", "implied", "withdrawn"];
export const IMPLIED_YEARS = 2;

/** Implied consent from an existing business relationship lasts two years from the purchase (CASL s. 10(10)). */
export function impliedExpiry(paidVisitAt: Date): Date {
  const d = new Date(paidVisitAt);
  d.setUTCFullYear(d.getUTCFullYear() + IMPLIED_YEARS);
  return d;
}

export interface StoredConsent {
  status: string;
  impliedExpiresAt?: Date | null;
  withdrawnAt?: Date | null;
}

export interface EffectiveConsent {
  status: ConsentStatus;
  /** For implied consent: when it lapses. */
  expiresAt: Date | null;
  /** Paid visit the implied consent is based on. */
  basisVisitAt: Date | null;
}

/**
 * What the sender may rely on right now.
 * - express: until withdrawn.
 * - withdrawn: never overridden by a later visit; only a new express opt-in (START,
 *   front desk, web, phone) restores it.
 * - otherwise implied when the latest paid visit is under two years old, else none.
 */
export function effectiveConsent(stored: StoredConsent | null | undefined, lastPaidVisit: Date | null, now: Date): EffectiveConsent {
  const status = stored?.status;
  if (status === "express") return { status: "express", expiresAt: null, basisVisitAt: null };
  if (status === "withdrawn") return { status: "withdrawn", expiresAt: null, basisVisitAt: null };
  if (lastPaidVisit) {
    const exp = impliedExpiry(lastPaidVisit);
    if (exp > now) return { status: "implied", expiresAt: exp, basisVisitAt: lastPaidVisit };
  }
  return { status: "none", expiresAt: null, basisVisitAt: null };
}

export type SkipReason =
  | "no_consent"
  | "withdrawn"
  | "implied_excluded"
  | "implied_expired"
  | "frequency_cap"
  | "invalid_phone"
  | "duplicate";

export const SKIP_LABEL: Record<SkipReason | "quiet_hours", string> = {
  no_consent: "No consent",
  withdrawn: "Opted out",
  implied_excluded: "Implied only (not included)",
  implied_expired: "Implied consent expired",
  frequency_cap: "Frequency cap reached",
  invalid_phone: "Invalid number",
  duplicate: "Duplicate number",
  quiet_hours: "Quiet hours",
};

/**
 * Decides whether a promotional text may go to someone. Express consent always
 * qualifies; implied only when the owner ticked "include implied consent".
 */
export function consentDecision(
  eff: EffectiveConsent,
  includeImplied: boolean,
  hadImpliedBefore = false,
): { ok: true; basis: "express" | "implied" } | { ok: false; reason: SkipReason } {
  if (eff.status === "express") return { ok: true, basis: "express" };
  if (eff.status === "withdrawn") return { ok: false, reason: "withdrawn" };
  if (eff.status === "implied") return includeImplied ? { ok: true, basis: "implied" } : { ok: false, reason: "implied_excluded" };
  return { ok: false, reason: hadImpliedBefore ? "implied_expired" : "no_consent" };
}

// ---------------------------------------------------------------- frequency cap

export interface FrequencyCap {
  max: number;
  days: number;
}
export const DEFAULT_FREQUENCY_CAP: FrequencyCap = { max: 4, days: 30 };

/** True when one more promotional text would stay within the cap (max texts per rolling window). */
export function underFrequencyCap(sentAt: Date[], now: Date, cap: FrequencyCap = DEFAULT_FREQUENCY_CAP): boolean {
  const since = now.getTime() - cap.days * 86400000;
  const recent = sentAt.filter((d) => d.getTime() > since && d.getTime() <= now.getTime()).length;
  return recent < cap.max;
}
