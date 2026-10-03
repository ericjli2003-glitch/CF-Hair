import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpBookingApi } from "../src/api/http.js";
import { InMemoryBookingApi } from "../src/api/mock.js";
import { ApiError, ApiUnavailableError } from "../src/api/types.js";
import { createMockApiApp } from "../src/mock/server.js";
import { loadConfig } from "../src/config.js";
import { loadSalon } from "../src/salon.js";
import { ToolExecutor, type ToolHooks } from "../src/agent/tools.js";
import { FIXED_NOW } from "./helpers.js";

const salon = loadSalon(loadConfig().salonJsonPath);
let server: Server;
let mock: InMemoryBookingApi;
let api: HttpBookingApi;

beforeAll(async () => {
  mock = new InMemoryBookingApi(salon, { now: () => FIXED_NOW });
  server = createMockApiApp(mock, "agent-key").listen(0);
  await new Promise((r) => server.once("listening", r));
  api = new HttpBookingApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "agent-key", 2000);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("booking flow over HTTP against the mock API", () => {
  it("lists services and staff from salon.json", async () => {
    expect((await api.getServices()).length).toBe(salon.services.length);
    expect((await api.getStaff()).map((s) => s.id)).toContain("stylist-a");
  });

  it("books, refuses a double booking, looks up, reschedules and cancels", async () => {
    const avail = await api.getAvailability({ serviceId: "mens-cut", date: "2026-10-08", staffId: "stylist-b" });
    expect(avail.slots.length).toBeGreaterThan(0);
    const slot = avail.slots[0];
    expect(slot.start).toMatch(/^2026-10-08T10:00:00/);

    const booking = await api.createBooking({
      serviceId: "mens-cut",
      staffId: slot.staffId,
      start: slot.start,
      customer: { name: "Alex Chen", phone: "+16045550123" },
      source: "phone",
    });
    expect(booking.status).toBe("confirmed");
    expect(booking.staffName).toBe("Stylist B");

    await expect(
      api.createBooking({ serviceId: "mens-cut", staffId: slot.staffId, start: slot.start, customer: { name: "B", phone: "+16045550000" }, source: "phone" }),
    ).rejects.toMatchObject({ status: 409, code: "SLOT_TAKEN" });

    const after = await api.getAvailability({ serviceId: "mens-cut", date: "2026-10-08", staffId: "stylist-b" });
    expect(after.slots.find((s) => s.start === slot.start)).toBeUndefined();

    const mine = await api.lookupBookings("+16045550123");
    expect(mine.map((b) => b.id)).toContain(booking.id);

    const moved = await api.rescheduleBooking(booking.id, { start: "2026-10-09T15:00:00-07:00" });
    expect(moved.start).toMatch(/^2026-10-09T15:00:00/);

    const cancelled = await api.cancelBooking(booking.id);
    expect(cancelled.status).toBe("cancelled");
    expect(await api.lookupBookings("+16045550123")).toHaveLength(0);
  });

  it("returns no slots on a past time of day and respects opening hours", async () => {
    const today = await api.getAvailability({ serviceId: "mens-cut", date: "2026-10-07" });
    expect(today.slots.every((s) => s.start >= "2026-10-07T11:30")).toBe(true);
    const lastSlot = today.slots[today.slots.length - 1];
    expect(Date.parse(lastSlot.end)).toBeLessThanOrEqual(Date.parse("2026-10-07T18:00:00-07:00"));
    expect(Date.parse(lastSlot.end)).toBeGreaterThan(Date.parse("2026-10-07T17:00:00-07:00"));
  });

  it("requires the agent key on agent endpoints", async () => {
    const noKey = new HttpBookingApi(api["baseUrl"], "", 2000);
    await expect(noKey.lookupBookings("+16045550123")).rejects.toBeInstanceOf(ApiError);
  });

  it("stores callback messages and caller profiles", async () => {
    await api.postMessage({ callerName: "Pat", phone: "+16045550100", message: "Please call back", urgency: "high" });
    expect(mock.messages.at(-1)).toMatchObject({ callerName: "Pat", urgency: "high" });

    const unknown = await api.getCaller("+16045550777");
    expect(unknown).toMatchObject({ preferredLanguage: "en-US", callCount: 0 });
    await api.putCaller("+16045550777", { preferredLanguage: "ko-KR", incrementCallCount: true });
    expect(await api.getCaller("+16045550777")).toMatchObject({ preferredLanguage: "ko-KR", callCount: 1 });
  });

  it("reports an unreachable API as ApiUnavailableError", async () => {
    const dead = new HttpBookingApi("http://127.0.0.1:9", "k", 500);
    await expect(dead.getServices()).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("runs the booking tools end to end through the HTTP client", async () => {
    const outcomes: string[] = [];
    const hooks: ToolHooks = {
      callSid: "CA1",
      callerPhone: "+16045550155",
      currentLanguage: () => "en-US",
      switchLanguage: async () => ({ saved: "api" }),
      requestEnd: () => {},
      requestTransfer: () => ({ ok: false }),
      recordOutcome: (o) => void outcomes.push(o),
      rememberName: () => {},
      sendMessage: async () => "sent",
      now: () => FIXED_NOW,
    };
    const ex = new ToolExecutor(api, salon, hooks);
    const avail = JSON.parse((await ex.run("check_availability", { service_id: "womens-cut", date: "2026-10-08", time_preference: "afternoon" })).content);
    expect(avail.slots.length).toBeGreaterThan(0);
    expect(avail.slots[0].spoken).toMatch(/Thursday, October 8 at (12|1|2|3|4):/);
    const pick = avail.slots[0];
    const booked = await ex.run("book_appointment", {
      service_id: "womens-cut",
      start: pick.start,
      staff_id: pick.staffId,
      customer_name: "Jamie",
      confirmed_with_caller: true,
    });
    expect(booked.isError).toBe(false);
    expect(JSON.parse(booked.content).phoneOnFile).toBe("604 555 0155");
    expect(outcomes).toEqual(["booked"]);
    const look = JSON.parse((await ex.run("lookup_bookings", {})).content);
    expect(look.upcoming).toHaveLength(1);
  });
});
