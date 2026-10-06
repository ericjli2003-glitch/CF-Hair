import { describe, expect, it } from "vitest";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import { FakeLlm, testDeps } from "./helpers.js";

type Ev = { kind: "text"; token: string; last: boolean } | { kind: "end" };

describe("no booking in the same reply as a question", () => {
  it("holds book_appointment and end_call when the reply asks the caller something, then books after the yes", async () => {
    const deps = testDeps();
    const slot = (await deps.mockApi!.getAvailability({ serviceId: "mens-cut", date: "2026-10-08" })).slots[0];
    const book = { name: "book_appointment", input: { service_id: "mens-cut", start: slot.start, staff_id: slot.staffId, customer_name: "Eric", confirmed_with_caller: true } };
    // What happened on the real call: the offer, the booking and the goodbye all in one reply.
    const llm = new FakeLlm([
      { text: "Ten in the morning?", tools: [book, { name: "end_call", input: { reason: "completed" } }] },
      // After the caller's yes:
      { text: "OK.", tools: [book] },
      { text: "See you at ten tomorrow.", tools: [{ name: "end_call", input: { reason: "completed" } }] },
    ]);
    const events: Ev[] = [];
    const channel: CallChannel = {
      sendText: (token, last) => void events.push({ kind: "text", token, last }),
      setLanguage: () => {},
      end: () => void events.push({ kind: "end" }),
    };
    const s = new CallSession({ ...deps, llm }, { callSid: "CAguard", from: "+16045550123", to: "+16044757705" }, channel);

    await s.handlePrompt("Men's.");
    expect(deps.mockApi!.bookings.some((b) => b.customer.name === "Eric")).toBe(false);
    expect(s.log.record.toolCalls.map((t) => [t.name, t.isError])).toEqual([["book_appointment", true], ["end_call", true]]);
    expect(events.at(-1)).toMatchObject({ kind: "text", last: true }); // the question ends the reply
    expect(llm.requests).toHaveLength(1); // no extra model call: the caller answers next
    expect(s.ended).toBe(false);

    await s.handlePrompt("Yes.");
    expect(deps.mockApi!.bookings.some((b) => b.customer.name === "Eric")).toBe(true);
    // The goodbye was allowed this time: the call ends once it has been spoken.
    expect(s.log.record.toolCalls.at(-1)).toMatchObject({ name: "end_call", isError: false });
    await s.close();
  });

  it("lets a lookup run in a reply that asks a question", async () => {
    const llm = new FakeLlm([
      { text: "One sec, what time works?", tools: [{ name: "check_availability", input: { service_id: "mens-cut", date: "2026-10-08" } }] },
      { text: "Ten works." },
    ]);
    const deps = testDeps({ llm });
    const s = new CallSession(deps, { callSid: "CAguard2", from: "+16045550123", to: "+16044757705" }, { sendText: () => {}, setLanguage: () => {}, end: () => {} });
    await s.handlePrompt("Men's cut tomorrow.");
    expect(s.log.record.toolCalls[0]).toMatchObject({ name: "check_availability", isError: false });
    await s.close();
  });
});
