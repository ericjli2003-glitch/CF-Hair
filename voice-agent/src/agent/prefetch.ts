import { DateTime } from "luxon";
import type { BookingApi, Slot } from "../api/types.js";
import { hoursOn, type SalonData } from "../salon.js";

/**
 * Openings fetched while the greeting plays, so the most common question ("do you have a men's
 * cut tomorrow at three?") is answered straight from the call context: no check_availability
 * round trip, which costs a tool call plus a second model request before the caller hears a time.
 */
export interface PrefetchOptions {
  serviceIds: string[];
  /** Open days to cover, starting today. */
  days: number;
  /** Slots listed per service per day, spread across the day. */
  perDay: number;
  timeoutMs: number;
}

export const DEFAULT_PREFETCH: PrefetchOptions = {
  serviceIds: ["mens-cut", "womens-cut", "kids-cut"],
  days: 2,
  perDay: 8,
  timeoutMs: 2500,
};

/** Up to `n` slots spread evenly across the list, so mornings and afternoons are both shown. */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  return out;
}

/** The next `count` days the salon is open, starting today. */
export function openDays(salon: SalonData, now: DateTime, count: number): DateTime[] {
  const out: DateTime[] = [];
  const today = now.setZone(salon.timezone).startOf("day");
  for (let i = 0; i < 14 && out.length < count; i++) {
    const d = today.plus({ days: i });
    const h = hoursOn(salon, d);
    if (h && (i > 0 || now < h.close)) out.push(d);
  }
  return out;
}

/**
 * Fetches openings and returns the call-context section, or null when nothing came back in time.
 * Never throws: on a slow or failing API the agent simply uses check_availability as before.
 */
export async function prefetchOpenings(
  api: BookingApi,
  salon: SalonData,
  now: DateTime,
  opts: PrefetchOptions = DEFAULT_PREFETCH,
): Promise<string | null> {
  const services = opts.serviceIds
    .map((id) => salon.services.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const days = openDays(salon, now, opts.days);
  if (!services.length || !days.length) return null;

  const jobs = days.flatMap((day) =>
    services.map(async (svc) => {
      const r = await api.getAvailability({ serviceId: svc.id, date: day.toISODate()! });
      return { day, svc, slots: r.slots };
    }),
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), opts.timeoutMs)));
  const settled = await Promise.race([Promise.allSettled(jobs), timeout]);
  clearTimeout(timer);
  if (!settled) return null;

  const tz = salon.timezone;
  const soonest = now.plus({ minutes: 15 });
  const lines: string[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const { day, svc, slots } = r.value;
    // One entry per start time (the first free stylist); a stylist-specific request uses check_availability.
    const seen = new Set<number>();
    const future = slots.filter((s: Slot) => {
      const t = DateTime.fromISO(s.start, { setZone: true });
      if (t < soonest || seen.has(+t)) return false;
      seen.add(+t);
      return true;
    });
    const offset = Math.round(day.diff(now.setZone(tz).startOf("day"), "days").days);
    const relative = offset === 0 ? " (today)" : offset === 1 ? " (tomorrow)" : "";
    const label = `${svc.name} (${svc.id}), ${day.toFormat("cccc, LLLL d")}${relative}`;
    if (!future.length) {
      lines.push(`${label}: no openings.`);
      continue;
    }
    const shown = spread(future, opts.perDay).map((s) => {
      const t = DateTime.fromISO(s.start, { setZone: true }).setZone(tz).toFormat("h:mm a");
      return `${t} ${s.staffName} [start=${s.start} staff_id=${s.staffId}]`;
    });
    const more = future.length > shown.length ? ` (${future.length - shown.length} more times between these)` : "";
    lines.push(`${label}: ${shown.join("; ")}${more}`);
  }
  if (!lines.length) return null;

  return [
    `# Openings already checked at ${now.setZone(tz).toFormat("h:mm a")}`,
    "Use these to answer availability questions for these services and days without calling check_availability. " +
      "To book one, pass its start and staff_id to book_appointment exactly as written in the brackets. " +
      "Call check_availability for other services, other days, a specific stylist's full day, or times between the ones listed. " +
      "Times can be taken during the call; if a booking fails because the slot is gone, apologise briefly and offer the next one.",
    ...lines,
  ].join("\n");
}
