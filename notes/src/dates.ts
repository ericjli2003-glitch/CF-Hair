import type { IsoDate } from "./types.js";

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date in the salon's timezone (America/Vancouver), unless overridden. */
export function salonToday(override?: string): IsoDate {
  const forced = override ?? process.env.NOTES_TODAY;
  if (forced) {
    assertIsoDate(forced);
    return forced;
  }
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function assertIsoDate(d: string): void {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`Expected a date like 2026-10-09, got "${d}"`);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(t).toISOString().slice(0, 10) !== d) throw new Error(`Invalid calendar date "${d}"`);
}

/** Accepts YYYY-MM-DD or a full ISO timestamp; returns the date part. */
export function toIsoDate(value: string | undefined | null): IsoDate | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (ISO_RE.test(v)) return v;
  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function utc(d: IsoDate): number {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`Bad date "${d}"`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Parse "MM-DD" or "YYYY-MM-DD" into month/day. */
export function parseBirthday(b: string | undefined): { month: number; day: number } | undefined {
  if (!b) return undefined;
  const m = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(b.trim());
  if (!m) return undefined;
  const month = +m[1];
  const day = +m[2];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return { month, day };
}

/**
 * Next occurrence of a birthday on or after `today`. Feb 29 birthdays are
 * celebrated on Feb 28 in non-leap years.
 */
export function nextBirthday(birthday: string, today: IsoDate): IsoDate | undefined {
  const b = parseBirthday(birthday);
  if (!b) return undefined;
  const year = +today.slice(0, 4);
  for (const y of [year, year + 1]) {
    let day = b.day;
    if (b.month === 2 && b.day === 29 && !isLeap(y)) day = 28;
    const candidate = `${y}-${String(b.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (daysBetween(today, candidate) >= 0) return candidate;
  }
  return undefined;
}

/** "October 14" style, for prompts. Never includes a year. */
export function monthDay(d: IsoDate): string {
  return new Date(utc(d)).toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** Fuzzy relative description used in prompts, so notes never quote exact day counts. */
export function roughlyAgo(days: number): string {
  if (days <= 1) return "in the last day or two";
  if (days <= 10) return "earlier this week or last week";
  if (days <= 45) return "a few weeks ago";
  if (days <= 75) return "about two months ago";
  if (days <= 105) return "about three months ago";
  if (days <= 150) return "about four months ago";
  if (days <= 300) return "several months ago";
  if (days <= 540) return "about a year ago";
  return "a couple of years ago or more";
}
