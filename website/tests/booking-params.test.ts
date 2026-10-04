// /book?service=<id>&staff=<id>: the price board's Book links and the team page's
// "Book with" links. Only real ids are accepted; anything else starts at step 1.
import { describe, expect, it } from "vitest";
import { bookingHref, parseBookingParams, stepForUrl } from "@/lib/booking-params";
import { openStatus } from "@/lib/hours";
import type { Hours } from "@/lib/salon";

const services = [{ id: "mens-cut" }, { id: "balayage" }, { id: "down-perm" }];
const staff = [
  { id: "stylist-a", serviceIds: ["mens-cut", "balayage"] },
  { id: "stylist-b", serviceIds: ["mens-cut", "down-perm"] },
];
const parse = (p: Record<string, string | string[] | undefined>) => parseBookingParams(p, services, staff);

describe("service preselect", () => {
  it("skips step 1 for a known service", () => {
    expect(parse({ service: "balayage" })).toEqual({ serviceId: "balayage", step: 1 });
  });

  it("goes straight to times when the stylist offers the service", () => {
    expect(parse({ service: "mens-cut", staff: "stylist-b" })).toEqual({
      serviceId: "mens-cut",
      staffId: "stylist-b",
      pendingStaffId: "stylist-b",
      step: 2,
    });
  });

  it("drops a stylist who does not offer the service", () => {
    expect(parse({ service: "balayage", staff: "stylist-b" })).toEqual({ serviceId: "balayage", step: 1 });
  });

  it("starts at step 1 for unknown, empty or malformed ids", () => {
    for (const service of ["nope", "", "  ", "../admin", "mens-cut<script>", "MENS CUT", "a".repeat(80)]) {
      expect(parse({ service })).toEqual({ step: 0, pendingStaffId: undefined });
    }
    expect(parse({})).toEqual({ step: 0, pendingStaffId: undefined });
  });

  it("keeps a stylist from the team page for when a service is chosen", () => {
    expect(parse({ staff: "stylist-a" })).toEqual({ step: 0, pendingStaffId: "stylist-a" });
    expect(parse({ staff: "stylist-z" })).toEqual({ step: 0, pendingStaffId: undefined });
  });

  it("uses the first value of a repeated parameter and trims it", () => {
    expect(parse({ service: ["down-perm", "balayage"] })).toEqual({ serviceId: "down-perm", step: 1 });
    expect(parse({ service: " mens-cut " })).toEqual({ serviceId: "mens-cut", step: 1 });
  });

  it("builds the matching link", () => {
    expect(bookingHref("mens-cut")).toBe("/book?service=mens-cut");
    expect(bookingHref("mens-cut", "stylist-a")).toBe("/book?service=mens-cut&staff=stylist-a");
    expect(bookingHref("mens-cut", "any")).toBe("/book?service=mens-cut&staff=any");
    expect(bookingHref(undefined, "any")).toBe("/book");
    expect(bookingHref("mens-cut", "stylist-a", true)).toBe("/book?service=mens-cut&staff=stylist-a&step=details");
    expect(bookingHref("mens-cut", undefined, true)).toBe("/book?service=mens-cut");
    expect(bookingHref(undefined, "stylist-a")).toBe("/book?staff=stylist-a");
    expect(bookingHref()).toBe("/book");
    const back = new URL(bookingHref("mens-cut", "stylist-b"), "http://x");
    expect(parse(Object.fromEntries(back.searchParams))).toMatchObject({ serviceId: "mens-cut", staffId: "stylist-b", step: 2 });
  });
});

describe("back and forward through the steps", () => {
  const at = (href: string, hasTime = false) => {
    const qs = new URL(href, "http://x").searchParams;
    const start = parse(Object.fromEntries(qs));
    return { ...start, step: stepForUrl(start, qs, hasTime) };
  };

  it("gives every step its own address", () => {
    expect(at(bookingHref()).step).toBe(0);
    expect(at(bookingHref("mens-cut")).step).toBe(1);
    expect(at(bookingHref("mens-cut", "stylist-a")).step).toBe(2);
    expect(at(bookingHref("mens-cut", "stylist-a", true), true).step).toBe(3);
  });

  it("keeps Any stylist in the address", () => {
    expect(at(bookingHref("mens-cut", "any"))).toEqual({ serviceId: "mens-cut", staffId: "any", step: 2 });
    expect(parse({ staff: "any" })).toEqual({ step: 0, pendingStaffId: undefined });
  });

  it("lands on the time step when the details address has no time chosen", () => {
    expect(at(bookingHref("mens-cut", "stylist-a", true), false).step).toBe(2);
    expect(at("/book?service=mens-cut&step=details", true).step).toBe(1);
  });
});

describe("open status", () => {
  const hours: Hours = {
    mon: { open: "10:00", close: "18:00" },
    tue: { open: "10:00", close: "18:00" },
    wed: null,
    thu: { open: "10:00", close: "18:00" },
    fri: { open: "10:00", close: "18:00" },
    sat: { open: "10:00", close: "18:00" },
    sun: { open: "12:00", close: "18:00" },
  };
  const tz = "America/Vancouver";
  // 2026-10-05 is a Monday; Vancouver is UTC-7 then.
  const at = (iso: string) => openStatus(hours, new Date(iso), tz);

  it("knows when the salon is open, about to open, or closed", () => {
    expect(at("2026-10-05T12:00:00-07:00")).toEqual({ kind: "open", until: "18:00" });
    expect(at("2026-10-05T09:00:00-07:00")).toEqual({ kind: "later-today", at: "10:00" });
    expect(at("2026-10-05T18:00:00-07:00")).toEqual({ kind: "tomorrow", at: "10:00" });
    expect(at("2026-10-06T19:00:00-07:00")).toEqual({ kind: "on", day: "thu", at: "10:00" });
    expect(at("2026-10-07T11:00:00-07:00")).toEqual({ kind: "tomorrow", at: "10:00" });
  });
});
