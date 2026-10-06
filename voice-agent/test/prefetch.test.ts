import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import { openDays, prefetchOpenings, spread, DEFAULT_PREFETCH } from "../src/agent/prefetch.js";
import { FakeLlm, FIXED_NOW, testDeps } from "./helpers.js";
import type { StreamParams } from "../src/agent/llm.js";

const silent: CallChannel = { sendText: () => {}, setLanguage: () => {}, end: () => {} };
const contextOf = (p: StreamParams) => (p.system as { text: string }[])[1].text;

describe("openings prefetched at call start", () => {
  it("spreads slots across the day and skips closed days", () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
    expect(spread([1, 2], 4)).toEqual([1, 2]);
    const deps = testDeps();
    const days = openDays(deps.salon, FIXED_NOW, 2);
    expect(days).toHaveLength(2);
    expect(days[0].toISODate()).toBe("2026-10-07");
  });

  it("lists bookable times with their exact start and stylist id", async () => {
    const deps = testDeps();
    const text = await prefetchOpenings(deps.api, deps.salon, FIXED_NOW);
    expect(text).toContain("Openings already checked");
    expect(text).toMatch(/\(mens-cut\), Wednesday, October 7 \(today\): /);
    expect(text).toMatch(/\(mens-cut\), Thursday, October 8 \(tomorrow\): /);
    expect(text).toMatch(/\[start=2026-10-07T\d\d:\d\d:00.*staff_id=stylist-[abc]\]/);
    // Nothing earlier than 15 minutes from now (11:00) is offered for today.
    const today = text!.split("\n").find((l) => l.includes("(mens-cut), Wednesday"))!;
    expect(today).not.toMatch(/start=2026-10-07T(09|10):/);
  });

  it("gives up quietly when the booking API is slow or down", async () => {
    const deps = testDeps();
    const api = deps.mockApi!;
    const real = api.getAvailability.bind(api);
    api.getAvailability = (q) => new Promise((r) => setTimeout(() => r(real(q)), 200));
    expect(await prefetchOpenings(deps.api, deps.salon, FIXED_NOW, { ...DEFAULT_PREFETCH, timeoutMs: 20 })).toBeNull();
    api.offline = true;
    expect(await prefetchOpenings(deps.api, deps.salon, FIXED_NOW, { ...DEFAULT_PREFETCH, timeoutMs: 500 })).toBeNull();
  });

  it("books a prefetched time without a check_availability call", async () => {
    let picked: { start: string; staff: string } | null = null;
    const llm = new FakeLlm((p, i) => {
      if (i === 0) {
        const m = contextOf(p).match(/\(mens-cut\), Thursday[^\n]*?\[start=(\S+) staff_id=(\S+)\]/)!;
        picked = { start: m[1], staff: m[2] };
        return { text: "Sure, I can book that.", tools: [{ name: "book_appointment", input: { service_id: "mens-cut", start: m[1], staff_id: m[2], customer_name: "Alex Chen", confirmed_with_caller: true } }] };
      }
      return { text: "You're booked." };
    });
    const deps = testDeps({ llm });
    const s = new CallSession(deps, { callSid: "CAprefetch", from: "+16045550123", to: "+16044757705" }, silent);
    await s.handlePrompt("Men's cut tomorrow, the first one you have. Alex Chen. Yes, book it.");
    expect(s.log.record.toolCalls.map((t) => t.name)).toEqual(["book_appointment"]);
    expect(s.log.record.toolCalls[0].isError).toBe(false);
    const booked = deps.mockApi!.bookings.find((b) => b.customer.name === "Alex Chen")!;
    expect(+DateTime.fromISO(booked.start)).toBe(+DateTime.fromISO(picked!.start));
    await s.close();
  });

  it("can be turned off", async () => {
    const llm = new FakeLlm([{ text: "Hi." }]);
    const deps = testDeps({ llm });
    deps.config.prefetchServiceIds = [];
    const s = new CallSession(deps, { callSid: "CAoff", from: "+16045550123", to: "+16044757705" }, silent);
    await s.handlePrompt("Hello");
    expect(contextOf(llm.requests[0])).not.toContain("Openings already checked");
    await s.close();
  });
});
