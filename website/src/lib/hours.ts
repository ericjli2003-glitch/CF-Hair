// "Open today until 6 pm" and friends, worked out in the salon's time zone.
import { DAY_KEYS, type DayKey, type Hours } from "./salon";
import { addDays, dateKeyOf, hhmmToMin, minutesOfDay, weekdayOf } from "./time";

export type OpenStatus =
  | { kind: "open"; until: string }
  | { kind: "later-today"; at: string }
  | { kind: "tomorrow"; at: string }
  | { kind: "on"; day: DayKey; at: string }
  | { kind: "none" };

export function openStatus(hours: Hours, now: Date, tz: string): OpenStatus {
  const today = dateKeyOf(now, tz);
  const mins = minutesOfDay(now, tz);
  const h = hours[weekdayOf(today)];
  if (h) {
    if (mins >= hhmmToMin(h.open) && mins < hhmmToMin(h.close)) return { kind: "open", until: h.close };
    if (mins < hhmmToMin(h.open)) return { kind: "later-today", at: h.open };
  }
  for (let i = 1; i <= DAY_KEYS.length; i++) {
    const day = weekdayOf(addDays(today, i));
    const next = hours[day];
    if (next) return i === 1 ? { kind: "tomorrow", at: next.open } : { kind: "on", day, at: next.open };
  }
  return { kind: "none" };
}
