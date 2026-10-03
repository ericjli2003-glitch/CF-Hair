// Timezone helpers built on Intl, so we do not need a date library.
import type { DayKey } from "./salon";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Offset of `tz` from UTC at the given instant, in minutes (Vancouver: -420 or -480). */
export function tzOffsetMin(date: Date, tz: string): number {
  const d = new Date(Math.floor(date.getTime() / 1000) * 1000);
  const p = zonedParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** The instant for local wall-clock `minutes` after midnight on `dateKey` in `tz`. */
export function zonedTime(dateKey: string, minutes: number, tz: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const off1 = tzOffsetMin(new Date(guess), tz);
  let t = guess - off1 * 60000;
  const off2 = tzOffsetMin(new Date(t), tz);
  if (off2 !== off1) t = guess - off2 * 60000;
  return new Date(t);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function dateKeyOf(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function minutesOfDay(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
}

/** ISO 8601 with the salon offset, e.g. 2026-10-05T10:00:00-07:00 */
export function toZonedISO(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  const off = tzOffsetMin(date, tz);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const WEEKDAYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as DayKey[];
export function weekdayOf(dateKey: string): DayKey {
  const [y, m, d] = dateKey.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isDateKey(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function minToHHMM(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/**
 * Parses a start time. Strings with an offset or Z are absolute; a bare local
 * time like 2026-10-05T10:00 is interpreted in the salon timezone.
 */
export function parseStart(input: unknown, tz: string): Date | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m || !isDateKey(m[1])) return null;
  return zonedTime(m[1], Number(m[2]) * 60 + Number(m[3]), tz);
}
