import { describe, expect, it } from "vitest";
import { blocksFor, computeSlots, type BusyBlock, type StaffLite } from "@/lib/availability";
import type { Hours } from "@/lib/salon";
import { toZonedISO, zonedTime } from "@/lib/time";

const TZ = "America/Vancouver";
const hours: Hours = {
  mon: { open: "10:00", close: "18:00" },
  tue: { open: "10:00", close: "18:00" },
  wed: null,
  thu: { open: "10:00", close: "18:00" },
  fri: { open: "10:00", close: "18:00" },
  sat: { open: "10:00", close: "18:00" },
  sun: { open: "12:00", close: "18:00" },
};
const staff: StaffLite[] = [
  { id: "a", name: "A", serviceIds: ["cut", "colour"] },
  { id: "b", name: "B", serviceIds: ["cut"] },
];
const MONDAY = "2030-01-07"; // a Monday in PST (UTC-8)
const longAgo = new Date("2029-01-01T00:00:00Z");
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTime(date, h * 60 + m, TZ);
};
const local = (d: Date) => toZonedISO(d, TZ).slice(11, 16);
const base = { serviceId: "cut", durationMin: 30, staff, bookings: [] as BusyBlock[], hours, tz: TZ, now: longAgo };

describe("computeSlots", () => {
  it("returns 15-minute slots from opening until the service would run past closing", () => {
    const slots = computeSlots({ ...base, date: MONDAY });
    expect(slots.length).toBe(31); // 10:00 .. 17:30 inclusive
    expect(local(slots[0].start)).toBe("10:00");
    expect(local(slots[1].start)).toBe("10:15");
    expect(local(slots.at(-1)!.start)).toBe("17:30");
    expect(local(slots.at(-1)!.end)).toBe("18:00");
    expect(toZonedISO(slots[0].start, TZ)).toBe("2030-01-07T10:00:00-08:00");
  });

  it("respects closing time for long services", () => {
    const slots = computeSlots({ ...base, serviceId: "colour", durationMin: 120, date: MONDAY });
    expect(local(slots.at(-1)!.start)).toBe("16:00");
    expect(slots.every((s) => s.staffId === "a")).toBe(true); // only A does colour
  });

  it("uses per-day hours and returns nothing on closed days", () => {
    expect(local(computeSlots({ ...base, date: "2030-01-06" })[0].start)).toBe("12:00"); // Sunday
    expect(computeSlots({ ...base, date: "2030-01-09" })).toEqual([]); // Wednesday closed
  });

  it("never offers slots in the past", () => {
    const now = at(MONDAY, "13:07");
    const slots = computeSlots({ ...base, date: MONDAY, now });
    expect(local(slots[0].start)).toBe("13:15");
    expect(slots.every((s) => s.start > now)).toBe(true);
  });

  it("excludes times that overlap an existing booking for the chosen stylist", () => {
    const bookings: BusyBlock[] = [{ id: "x", staffId: "b", start: at(MONDAY, "11:00"), end: at(MONDAY, "12:00") }];
    const slots = computeSlots({ ...base, date: MONDAY, staffId: "b", bookings }).map((s) => local(s.start));
    expect(slots).toContain("10:30"); // ends exactly at 11:00
    expect(slots).not.toContain("10:45"); // would overlap 11:00
    expect(slots).not.toContain("11:30");
    expect(slots).toContain("12:00");
  });

  it("with no preference, falls back to another free stylist", () => {
    const bookings: BusyBlock[] = [{ staffId: "b", start: at(MONDAY, "10:00"), end: at(MONDAY, "18:00") }];
    const slots = computeSlots({ ...base, date: MONDAY, bookings });
    expect(slots.length).toBe(31);
    expect(slots.every((s) => s.staffId === "a")).toBe(true);
  });

  it("returns nothing when every qualified stylist is busy", () => {
    const bookings: BusyBlock[] = [
      { staffId: "a", start: at(MONDAY, "10:00"), end: at(MONDAY, "18:00") },
      { staffId: "b", start: at(MONDAY, "10:00"), end: at(MONDAY, "18:00") },
    ];
    expect(computeSlots({ ...base, date: MONDAY, bookings })).toEqual([]);
  });

  it("ignores the booking being rescheduled", () => {
    const bookings: BusyBlock[] = [{ id: "self", staffId: "a", start: at(MONDAY, "10:00"), end: at(MONDAY, "18:00") }];
    const slots = computeSlots({ ...base, date: MONDAY, staffId: "a", bookings, excludeBookingId: "self" });
    expect(slots.length).toBe(31);
  });

  it("returns nothing for a stylist who does not offer the service", () => {
    expect(computeSlots({ ...base, serviceId: "colour", date: MONDAY, staffId: "b" })).toEqual([]);
  });

  it("handles the daylight saving change (Vancouver springs forward 2030-03-10)", () => {
    const slots = computeSlots({ ...base, date: "2030-03-10" }); // Sunday, PDT
    expect(toZonedISO(slots[0].start, TZ)).toBe("2030-03-10T12:00:00-07:00");
  });
});

describe("blocksFor", () => {
  it("covers every 15-minute block of a booking", () => {
    const blocks = blocksFor(at(MONDAY, "10:00"), at(MONDAY, "10:45"));
    expect(blocks.map(local)).toEqual(["10:00", "10:15", "10:30"]);
  });
});
