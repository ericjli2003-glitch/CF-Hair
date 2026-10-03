// Pure slot computation. No database access here so it is easy to test.
import type { Hours } from "./salon";
import { hhmmToMin, weekdayOf, zonedTime } from "./time";

export const STEP_MIN = 15;

export interface StaffLite {
  id: string;
  name: string;
  serviceIds: string[];
}

export interface BusyBlock {
  id?: string;
  staffId: string;
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
  staffId: string;
  staffName: string;
}

export interface AvailabilityInput {
  date: string; // YYYY-MM-DD in salon timezone
  serviceId: string;
  durationMin: number;
  staff: StaffLite[];
  bookings: BusyBlock[]; // active (non-cancelled) bookings that touch this day
  hours: Hours;
  tz: string;
  now: Date;
  staffId?: string; // omit for "No preference"
  excludeBookingId?: string; // when rescheduling, ignore the booking being moved
  stepMin?: number;
}

/** Opening window for a date, or null if the salon is closed that day. */
export function dayWindow(date: string, hours: Hours, tz: string): { open: Date; close: Date } | null {
  const h = hours[weekdayOf(date)];
  if (!h || !h.open || !h.close) return null;
  const openMin = hhmmToMin(h.open);
  const closeMin = hhmmToMin(h.close);
  if (closeMin <= openMin) return null;
  return { open: zonedTime(date, openMin, tz), close: zonedTime(date, closeMin, tz) };
}

export function qualifiedStaff(staff: StaffLite[], serviceId: string): StaffLite[] {
  return staff.filter((s) => s.serviceIds.includes(serviceId));
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function isStaffFree(
  staffId: string,
  start: Date,
  end: Date,
  bookings: BusyBlock[],
  excludeBookingId?: string,
): boolean {
  return !bookings.some(
    (b) =>
      b.staffId === staffId &&
      (excludeBookingId === undefined || b.id !== excludeBookingId) &&
      overlaps(start, end, b.start, b.end),
  );
}

/** Booked minutes per stylist, used to spread "No preference" bookings evenly. */
export function loadByStaff(bookings: BusyBlock[], excludeBookingId?: string): Map<string, number> {
  const load = new Map<string, number>();
  for (const b of bookings) {
    if (b.id && b.id === excludeBookingId) continue;
    load.set(b.staffId, (load.get(b.staffId) ?? 0) + (b.end.getTime() - b.start.getTime()) / 60000);
  }
  return load;
}

/** Orders candidate stylists: least booked first, then by the order given. */
export function rankStaff(candidates: StaffLite[], bookings: BusyBlock[], excludeBookingId?: string): StaffLite[] {
  const load = loadByStaff(bookings, excludeBookingId);
  return candidates
    .map((s, i) => ({ s, i, l: load.get(s.id) ?? 0 }))
    .sort((a, b) => a.l - b.l || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Every bookable start on `date`, at 15-minute granularity, such that the service
 * finishes by closing time, starts after `now`, and does not overlap any active
 * booking for the assigned stylist. With no staffId, one slot per start time is
 * returned, assigned to the least-busy free stylist.
 */
export function computeSlots(input: AvailabilityInput): Slot[] {
  const step = input.stepMin ?? STEP_MIN;
  const win = dayWindow(input.date, input.hours, input.tz);
  if (!win || input.durationMin <= 0) return [];

  let candidates = qualifiedStaff(input.staff, input.serviceId);
  if (input.staffId) candidates = candidates.filter((s) => s.id === input.staffId);
  if (candidates.length === 0) return [];
  const ranked = rankStaff(candidates, input.bookings, input.excludeBookingId);

  const slots: Slot[] = [];
  const durMs = input.durationMin * 60000;
  const stepMs = step * 60000;
  for (let t = win.open.getTime(); t + durMs <= win.close.getTime(); t += stepMs) {
    if (t <= input.now.getTime()) continue;
    const start = new Date(t);
    const end = new Date(t + durMs);
    const free = ranked.find((s) => isStaffFree(s.id, start, end, input.bookings, input.excludeBookingId));
    if (free) slots.push({ start, end, staffId: free.id, staffName: free.name });
  }
  return slots;
}

/** 15-minute blocks covered by [start, end), used for SlotLock rows. */
export function blocksFor(start: Date, end: Date, stepMin = STEP_MIN): Date[] {
  const out: Date[] = [];
  const step = stepMin * 60000;
  const first = Math.floor(start.getTime() / step) * step;
  for (let t = first; t < end.getTime(); t += step) out.push(new Date(t));
  return out;
}

export function isAligned(d: Date, stepMin = STEP_MIN): boolean {
  return d.getTime() % (stepMin * 60000) === 0;
}
