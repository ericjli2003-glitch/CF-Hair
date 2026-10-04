import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import { HttpBookingApi } from "../src/api/http.js";
import { InMemoryBookingApi } from "../src/api/mock.js";
import { CallReporter, cleanSummary, templateSummary, type Summarizer } from "../src/calls.js";
import { createMockApiApp } from "../src/mock/server.js";
import { loadConfig } from "../src/config.js";
import { loadSalon } from "../src/salon.js";
import { FakeLlm, FIXED_NOW, tempDir, testDeps, waitFor, type ScriptedStep } from "./helpers.js";

const quiet: CallChannel = { sendText: () => {}, setLanguage: () => {}, end: () => {} };
const fixedSummary: Summarizer = { summarize: async () => "Alex Chen booked a men's haircut for Thursday at ten \u2014 no follow-up needed." };
const failingSummary: Summarizer = {
  summarize: async () => {
    throw new Error("model unavailable");
  },
};

const BOOK: ScriptedStep[] = [
  {
    tools: [
      {
        name: "book_appointment",
        input: { service_id: "mens-cut", start: "2026-10-08T10:00:00-07:00", staff_id: "stylist-b", customer_name: "Alex Chen", confirmed_with_caller: true },
      },
    ],
  },
  { text: "You're booked for Thursday at ten with Stylist B." },
];

async function runCall(deps: ReturnType<typeof testDeps>, from: string | null, lines: string[], callSid = `CA${Math.random().toString(36).slice(2)}`) {
  const s = new CallSession(deps, { callSid, from, to: "+16044757705" }, quiet);
  await s.start();
  for (const l of lines) await s.handlePrompt(l);
  await s.close();
  await s.reported;
  return s;
}

describe("Calls tab payload", () => {
  it("posts the contract shape at the end of a call", async () => {
    const deps = testDeps({ llm: new FakeLlm(BOOK), summarizer: fixedSummary });
    const s = await runCall(deps, "+16045550123", ["Men's cut Thursday at ten please, I'm Alex Chen. Yes, book it."]);
    const call = deps.mockApi!.calls.get(s.init.callSid)!;
    expect(call).toBeDefined();
    const booking = deps.mockApi!.bookings.find((b) => b.customer.name === "Alex Chen")!;
    expect(call).toMatchObject({
      callSid: s.init.callSid,
      from: "+16045550123",
      language: "en-US",
      languageSource: "default",
      outcome: "booked",
      bookingId: booking.id,
      summary: "Alex Chen booked a men's haircut for Thursday at ten, no follow-up needed.",
    });
    expect(Date.parse(call.startedAt)).not.toBeNaN();
    expect(Date.parse(call.endedAt)).toBeGreaterThanOrEqual(Date.parse(call.startedAt));
    expect(typeof call.durationSec).toBe("number");
    expect(call.transcript.map((t) => t.role)).toEqual(["agent", "caller", "agent"]);
    expect(call.transcript.every((t) => t.lang === "en-US" && typeof t.at === "string")).toBe(true);
    expect(call).not.toHaveProperty("smsConsent"); // only reported when it was asked
    expect(call).not.toHaveProperty("messageId");
    expect(call.summary).not.toMatch(/[\u2014\u2013]/);
    // The local JSON log is still written.
    expect(fs.readdirSync(deps.config.logDir)).toHaveLength(1);
  });

  it("records detected language, per-line language, withheld numbers, messages and spam", async () => {
    const korean = testDeps({ llm: new FakeLlm([{ text: "네, 남자 커트는 삼십 달러예요." }]) });
    const k = await runCall(korean, "anonymous", ["안녕하세요, 남자 커트 얼마예요?"]);
    const kc = korean.mockApi!.calls.get(k.init.callSid)!;
    expect(kc).toMatchObject({ from: null, language: "ko-KR", languageSource: "detected", outcome: "info" });
    expect(kc.transcript.map((t) => t.lang)).toEqual(["en-US", "ko-KR", "ko-KR"]);
    expect(kc.summary).toMatch(/Korean/); // template fallback mentions the language

    const msg = testDeps({
      llm: new FakeLlm([
        { tools: [{ name: "take_message", input: { caller_name: "Pat", message: "Unhappy with a colour, wants the owner to call.", urgency: "high", reason: "complaint" } }] },
        { text: "I've passed that on. The owner will call you back." },
      ]),
    });
    const m = await runCall(msg, "+16045550111", ["I want to complain about my colour."]);
    const mc = msg.mockApi!.calls.get(m.init.callSid)!;
    expect(mc.outcome).toBe("message");
    expect(mc.messageId).toBe(msg.mockApi!.messages[0].id);

    const spam = testDeps({ llm: new FakeLlm([{ text: "No thank you. Goodbye.", tools: [{ name: "end_call", input: { reason: "spam" } }] }]) });
    const sp = await runCall(spam, "+16045550222", ["Hi, I'm calling about your Google business listing."]);
    expect(spam.mockApi!.calls.get(sp.init.callSid)!.outcome).toBe("spam");
  });

  it("reports the SMS opt-in answer only when it was asked", async () => {
    const deps = testDeps({ llm: new FakeLlm([{ text: "Sure." }]) });
    const s = new CallSession(deps, { callSid: "CAsms", from: "+16045550333", to: null }, quiet);
    await s.handlePrompt("Hi");
    s.log.record.smsOptIn = { accepted: true, language: "en-US", saved: true };
    await s.close();
    await s.reported;
    expect(deps.mockApi!.calls.get("CAsms")!.smsConsent).toBe("yes");
  });
});

describe("summary fallback", () => {
  it("uses a template built from the outcome when Claude fails", async () => {
    const deps = testDeps({ llm: new FakeLlm(BOOK), summarizer: failingSummary });
    const s = await runCall(deps, "+16045550123", ["Book me in please."]);
    const call = deps.mockApi!.calls.get(s.init.callSid)!;
    expect(call.summary).toMatch(/^Alex Chen booked Men's Haircut for Thursday October 8 at 10:00 AM\.$/);
    expect(s.log.record.errors.some((e) => e.includes("summary fallback: model unavailable"))).toBe(true);
  });

  it("templates cover every outcome in plain punctuation", () => {
    const base = { callSid: "x", from: "+16045550123", startedAt: "", endedAt: "", durationSec: 0, language: "zh-HK" as const, languageSource: "detected" as const, transcript: [] };
    for (const outcome of ["booked", "rescheduled", "cancelled", "message", "transferred", "info", "abandoned", "spam"] as const) {
      const t = templateSummary({ ...base, outcome });
      expect(t.length).toBeGreaterThan(10);
      expect(t).not.toMatch(/[\u2014\u2013]/);
    }
    expect(templateSummary({ ...base, outcome: "info" })).toMatch(/Cantonese/);
    expect(cleanSummary("**Booked** \u2014 Tuesday")).toBe("Booked, Tuesday");
  });
});

describe("retry when the website is down", () => {
  it("queues the record locally and posts it on the next call", async () => {
    const deps = testDeps({ llm: new FakeLlm([{ text: "We open at ten." }, { text: "Sunday is noon to six." }]) });
    deps.mockApi!.offline = true;
    const first = await runCall(deps, "+16045550444", ["When do you open?"]);
    const queueFile = path.join(deps.config.dataDir, "pending-calls.json");
    expect(Object.keys(JSON.parse(fs.readFileSync(queueFile, "utf8")))).toEqual([first.init.callSid]);
    expect(deps.mockApi!.calls.size).toBe(0);

    deps.mockApi!.offline = false;
    const second = await runCall(deps, "+16045550444", ["And Sunday?"]);
    await deps.reporter!.flush();
    expect(deps.mockApi!.calls.has(first.init.callSid)).toBe(true);
    expect(deps.mockApi!.calls.has(second.init.callSid)).toBe(true);
    expect(JSON.parse(fs.readFileSync(queueFile, "utf8"))).toEqual({});
  });

  it("retries queued records on startup", async () => {
    const dir = tempDir();
    const salon = loadSalon(loadConfig().salonJsonPath);
    const down = new InMemoryBookingApi(salon, { now: () => FIXED_NOW });
    down.offline = true;
    const payload = {
      callSid: "CAstartup",
      from: "+16045550555",
      startedAt: "2026-10-07T18:00:00.000Z",
      endedAt: "2026-10-07T18:02:00.000Z",
      durationSec: 120,
      language: "en-US" as const,
      languageSource: "default" as const,
      outcome: "info" as const,
      summary: "A caller asked about hours.",
      transcript: [{ role: "caller" as const, text: "Hours?" }],
    };
    const r1 = new CallReporter(down, null, dir);
    await r1["send"](payload);
    expect(r1.pendingCount()).toBe(1);

    const up = new InMemoryBookingApi(salon, { now: () => FIXED_NOW });
    const r2 = new CallReporter(up, null, dir); // a restarted server
    await r2.flush();
    expect(up.calls.get("CAstartup")).toMatchObject({ summary: "A caller asked about hours." });
    expect(r2.pendingCount()).toBe(0);
  });
});

describe("transfers", () => {
  it("posts again with the transfer result, and merges the agent session that follows an unanswered transfer", async () => {
    const deps = testDeps({
      forward: "+16045559999",
      llm: new FakeLlm([
        { tools: [{ name: "transfer_to_human", input: { reason: "wants a person", summary: "Wants to talk to the owner." } }] },
        { text: "Connecting you now." },
        { tools: [{ name: "take_message", input: { caller_name: "Sam", message: "Wants the owner to call about a colour.", urgency: "normal", reason: "callback" } }] },
        { text: "Got it, the owner will call you back." },
      ]),
    });
    const sid = "CAtransfer1";
    let ended = false;
    const first = new CallSession(deps, { callSid: sid, from: "+16045550666", to: null }, { ...quiet, end: () => void (ended = true) });
    await first.handlePrompt("Can I talk to someone?");
    await waitFor(() => ended); // the transfer `end` fires once "Connecting you now." has had time to play
    await first.close("transfer");
    await first.reported;
    expect(deps.mockApi!.calls.get(sid)).toMatchObject({ outcome: "transferred" });

    await deps.reporter!.transferResult(sid, "no-answer");
    expect(deps.mockApi!.calls.get(sid)).toMatchObject({ outcome: "transferred", transferResult: "no-answer" });
    expect(deps.mockApi!.callPosts).toBe(2);

    // Twilio reconnects the same CallSid to the agent, which takes a message.
    const second = new CallSession(deps, { callSid: sid, from: "+16045550666", to: null, resumeReason: "transfer_failed" }, quiet);
    await second.handlePrompt("Please have the owner call me, I'm Sam.");
    await second.close();
    await second.reported;
    const merged = deps.mockApi!.calls.get(sid)!;
    expect(merged).toMatchObject({ outcome: "message", transferResult: "no-answer" });
    expect(merged.transcript.filter((t) => t.role === "caller").map((t) => t.text)).toEqual([
      "Can I talk to someone?",
      "Please have the owner call me, I'm Sam.",
    ]);
    expect(deps.mockApi!.calls.size).toBe(1);
  });
});

describe("POST /api/calls over HTTP", () => {
  it("creates then updates by callSid", async () => {
    const mock = new InMemoryBookingApi(loadSalon(loadConfig().salonJsonPath), { now: () => FIXED_NOW });
    const server = createMockApiApp(mock, "k").listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const body = {
      callSid: "CAhttp",
      from: null,
      startedAt: "2026-10-07T18:00:00.000Z",
      endedAt: "2026-10-07T18:01:00.000Z",
      durationSec: 60,
      language: "zh-HK",
      languageSource: "saved",
      outcome: "info",
      summary: "A Cantonese caller asked about prices.",
      transcript: [],
    };
    const post = () => fetch(`${base}/api/calls`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: JSON.stringify(body) });
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(200);
    const api = new HttpBookingApi(base, "k", 2000);
    await expect(api.postCall({ ...body, summary: "" } as never)).resolves.toBeDefined();
    server.close();
  });
});
