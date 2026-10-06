import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, expect, it } from "vitest";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import { SMS_OPTIN_QUESTION } from "../src/agent/sms-optin.js";
import { validateToolInput } from "../src/agent/tools.js";
import { HttpBookingApi } from "../src/api/http.js";
import { InMemoryBookingApi } from "../src/api/mock.js";
import { createMockApiApp } from "../src/mock/server.js";
import { loadConfig } from "../src/config.js";
import { loadSalon } from "../src/salon.js";
import { FakeLlm, FIXED_NOW, testDeps, type ScriptedStep } from "./helpers.js";

const channel: CallChannel = { sendText: () => {}, setLanguage: () => {}, end: () => {} };
const session = (deps: ReturnType<typeof testDeps>, from: string | null) =>
  new CallSession(deps, { callSid: `CA${Math.random().toString(36).slice(2)}`, from, to: "+16044757705" }, channel);

async function firstSlot(deps: ReturnType<typeof testDeps>, nth = 0) {
  const r = await deps.mockApi!.getAvailability({ serviceId: "mens-cut", date: "2026-10-09" });
  return r.slots[nth].start;
}

const book = (start: string, extra: Record<string, unknown> = {}): ScriptedStep => ({
  tools: [{ name: "book_appointment", input: { service_id: "mens-cut", start, customer_name: "Alex Chen", confirmed_with_caller: true, ...extra } }],
});

type Result = { smsOptIn?: { question: string }; ok?: boolean; error?: string };
const results = (s: CallSession, name: string) => s.log.record.toolCalls.filter((t) => t.name === name).map((t) => t.result as Result);

describe("promotional SMS opt-in on the phone", () => {
  it("is off by default, so calls stay short", async () => {
    const deps = testDeps({ llm: new FakeLlm([]) });
    const start = await firstSlot(deps);
    const s = session({ ...deps, llm: new FakeLlm([book(start), { text: "OK, see you Friday." }]) }, "+16045550177");
    await s.handlePrompt("Book me a men's cut Friday at ten, I'm Alex Chen.");
    expect(results(s, "book_appointment")[0]).toMatchObject({ ok: true });
    expect(results(s, "book_appointment")[0].smsOptIn).toBeUndefined();
    await s.close();
  });

  it("asks once after a booking when the caller has no answer on file, and records a yes with the exact wording", async () => {
    const deps = testDeps({ llm: new FakeLlm([]) });
    deps.config.phoneSmsOptIn = true;
    const start = await firstSlot(deps);
    const steps: ScriptedStep[] = [
      book(start),
      { text: "You're booked for Friday. Would you like the occasional text about specials? You can reply STOP any time." },
      { tools: [{ name: "record_sms_consent", input: { accepted: true } }] },
      { text: "Thank you!" },
    ];
    const phone = "+16045550177";
    const s = session({ ...deps, llm: new FakeLlm(steps) }, phone);
    await s.handlePrompt("Book me a men's cut Friday at ten, I'm Alex Chen.");
    const booked = results(s, "book_appointment")[0];
    expect(booked.smsOptIn?.question).toBe(SMS_OPTIN_QUESTION["en-US"]);
    await s.handlePrompt("Sure, yes please.");
    expect(results(s, "record_sms_consent")[0]).toMatchObject({ ok: true });

    const ev = deps.mockApi!.consentEvents.at(-1)!;
    expect(ev).toMatchObject({ phone, status: "express", source: "phone", language: "en-US" });
    expect(ev.wording).toContain(SMS_OPTIN_QUESTION["en-US"]);
    expect(ev.wording).toContain("CF Hair Salon");
    expect(ev.wording).toContain("Caller said yes");
    expect(s.log.record.smsOptIn).toEqual({ accepted: true, language: "en-US", saved: true });
    await s.close();

    // Opted in now: a later booking never asks again.
    const llm2 = new FakeLlm([book(await firstSlot(deps, 3)), { text: "Booked." }]);
    const s2 = session({ ...deps, llm: llm2 }, phone);
    await s2.handlePrompt("Another cut please.");
    expect(results(s2, "book_appointment")[0]).toMatchObject({ ok: true });
    expect(results(s2, "book_appointment")[0].smsOptIn).toBeUndefined();
    await s2.close();
  });

  it("records a decline so the caller is never asked on future calls", async () => {
    const deps = testDeps({ llm: new FakeLlm([]) });
    deps.config.phoneSmsOptIn = true;
    const phone = "+16045550178";
    const steps: ScriptedStep[] = [book(await firstSlot(deps)), { text: "Booked. Would you like texts?" }, { tools: [{ name: "record_sms_consent", input: { accepted: false } }] }, { text: "No problem." }];
    const s = session({ ...deps, llm: new FakeLlm(steps) }, phone);
    await s.handlePrompt("Men's cut Friday morning please, Alex Chen.");
    await s.handlePrompt("No thanks.");
    expect(deps.mockApi!.consentEvents.at(-1)).toMatchObject({ phone, status: "declined", source: "phone" });
    expect((await deps.mockApi!.getCaller(phone)).smsConsent).toMatchObject({ status: "none", canAsk: false });
    await s.close();

    const s2 = session({ ...deps, llm: new FakeLlm([book(await firstSlot(deps, 4)), { text: "Booked." }]) }, phone);
    await s2.handlePrompt("Book again.");
    expect(results(s2, "book_appointment")[0].smsOptIn).toBeUndefined();
    await s2.close();
  });

  it("asks only once per call, even after a second booking", async () => {
    const deps = testDeps({ llm: new FakeLlm([]) });
    deps.config.phoneSmsOptIn = true;
    const steps: ScriptedStep[] = [book(await firstSlot(deps)), { text: "Booked." }, book(await firstSlot(deps, 5), { customer_name: "Sam Chen" }), { text: "Booked too." }];
    const s = session({ ...deps, llm: new FakeLlm(steps) }, "+16045550179");
    await s.handlePrompt("A cut for me.");
    await s.handlePrompt("And one for my son.");
    const r = results(s, "book_appointment");
    expect(r[0].smsOptIn).toBeDefined();
    expect(r[1].smsOptIn).toBeUndefined();
    await s.close();
  });

  it("never asks without caller ID, or when the booking is for another number", async () => {
    const deps = testDeps({ llm: new FakeLlm([]) });
    deps.config.phoneSmsOptIn = true;
    const anon = session({ ...deps, llm: new FakeLlm([book(await firstSlot(deps), { customer_phone: "604 555 0190" }), { text: "Booked." }]) }, "anonymous");
    await anon.handlePrompt("Cut please, my number is 604 555 0190.");
    expect(results(anon, "book_appointment")[0]).toMatchObject({ ok: true });
    expect(results(anon, "book_appointment")[0].smsOptIn).toBeUndefined();
    await anon.close();

    const other = session({ ...deps, llm: new FakeLlm([book(await firstSlot(deps, 2), { customer_phone: "604 555 0191" }), { text: "Booked." }]) }, "+16045550180");
    await other.handlePrompt("Book it under my wife's number.");
    expect(results(other, "book_appointment")[0]).toMatchObject({ ok: true });
    expect(results(other, "book_appointment")[0].smsOptIn).toBeUndefined();
    await other.close();
  });

  it("refuses record_sms_consent when the question was not offered", async () => {
    const deps = testDeps({ llm: new FakeLlm([{ tools: [{ name: "record_sms_consent", input: { accepted: true } }] }, { text: "Okay." }]) });
    deps.config.phoneSmsOptIn = true;
    const s = session(deps, "+16045550181");
    await s.handlePrompt("Sign me up for texts.");
    expect(results(s, "record_sms_consent")[0]).toMatchObject({ error: "NOT_OFFERED" });
    expect(deps.mockApi!.consentEvents).toHaveLength(0);
    expect(validateToolInput("record_sms_consent", { accepted: "yes" }).ok).toBe(false);
    await s.close();
  });

  it("asks in the caller's language: Mandarin, Cantonese and Korean", async () => {
    for (const lang of ["zh-CN", "zh-HK", "ko-KR"] as const) {
      const deps = testDeps({ llm: new FakeLlm([]) });
      deps.config.phoneSmsOptIn = true;
      const phone = `+1604555${lang === "zh-CN" ? "0182" : lang === "zh-HK" ? "0183" : "0184"}`;
      deps.mockApi!.callers.set(phone, { phone, preferredLanguage: lang, callCount: 1, lastCallAt: null, name: null });
      const steps: ScriptedStep[] = [book(await firstSlot(deps)), { text: SMS_OPTIN_QUESTION[lang] }, { tools: [{ name: "record_sms_consent", input: { accepted: true } }] }, { text: "OK" }];
      const s = session({ ...deps, llm: new FakeLlm(steps) }, phone);
      await s.handlePrompt("...");
      expect(results(s, "book_appointment")[0].smsOptIn?.question).toBe(SMS_OPTIN_QUESTION[lang]);
      await s.handlePrompt("好 / 네");
      const ev = deps.mockApi!.consentEvents.at(-1)!;
      expect(ev.language).toBe(lang);
      expect(ev.wording).toContain(SMS_OPTIN_QUESTION[lang]);
      await s.close();
    }
  });

  it("posts to /api/customers/consent over HTTP with the agent key", async () => {
    const salon = loadSalon(loadConfig().salonJsonPath);
    const mock = new InMemoryBookingApi(salon, { now: () => FIXED_NOW });
    const server: Server = createMockApiApp(mock, "agent-key").listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const api = new HttpBookingApi(base, "agent-key", 2000);
      await api.recordSmsConsent({ phone: "+16045550185", status: "express", source: "phone", wording: "w", language: "en-US" });
      expect((await api.getCaller("+16045550185")).smsConsent).toMatchObject({ status: "express", canAsk: false });
      const bad = new HttpBookingApi(base, "wrong", 2000);
      await expect(bad.recordSmsConsent({ phone: "+16045550185", status: "express", source: "phone", wording: "w", language: "en-US" })).rejects.toMatchObject({ status: 401 });
      await expect(api.recordSmsConsent({ phone: "+16045550185", status: "express", source: "phone", wording: "", language: "en-US" })).rejects.toMatchObject({ status: 400 });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
