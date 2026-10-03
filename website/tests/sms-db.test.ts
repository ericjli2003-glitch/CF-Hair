// Promotional SMS against a real SQLite database: two senders, STOP/START/HELP
// routing per sender, consent recording, campaigns in outbox mode, quiet hours,
// frequency cap, implied consent and attribution.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { sendNotice } from "@/lib/notify";
import { campaignStats, createCampaign, previewCampaign, processQueue, queueCampaign, scheduleCampaign } from "@/lib/sms/campaigns";
import { getConsent, recordConsent, syncImpliedConsent } from "@/lib/sms/consent";
import { handleInbound, REPLIES } from "@/lib/sms/inbound";
import { computeTwilioSignature, identifyChannel, senderFor, smsMode, twilioSend } from "@/lib/sms/twilio";
import { zonedTime } from "@/lib/time";
import { POST as inboundRoute } from "@/app/api/sms/inbound/route";
import { POST as consentRoute } from "@/app/api/customers/consent/route";
import { GET as getCallerRoute } from "@/app/api/callers/[phone]/route";

const TZ = "America/Vancouver";
const NOW = zonedTime("2026-10-07", 11 * 60, TZ); // Wednesday 11:00, inside the send window
const DAY = 86400000;

const TWILIO_KEYS = [
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_TXN_MESSAGING_SERVICE_SID", "TWILIO_TXN_FROM", "TWILIO_PROMO_MESSAGING_SERVICE_SID", "TWILIO_PROMO_FROM",
  "SMS_DRY_RUN", "PUBLIC_BASE_URL",
];
function setTwilio(vars: Record<string, string>) {
  for (const k of TWILIO_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

async function reset() {
  await prisma.campaignMessage.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.consentEvent.deleteMany();
  await prisma.smsConsent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.message.deleteMany();
  await prisma.appSetting.deleteMany();
  await prisma.slotLock.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.callerProfile.deleteMany();
  await prisma.customer.deleteMany();
}

async function client(name: string, phone: string, opts: { lang?: string; paidVisitDaysAgo?: number; email?: string; upcomingInDays?: number } = {}) {
  const c = await prisma.customer.create({ data: { name, phone, preferredLanguage: opts.lang ?? "en-US", email: opts.email ?? null } });
  if (opts.paidVisitDaysAgo !== undefined) {
    const start = new Date(NOW.getTime() - opts.paidVisitDaysAgo * DAY);
    await prisma.booking.create({
      data: { serviceId: "sms-cut", staffId: "sms-stylist", customerId: c.id, start, end: new Date(start.getTime() + 30 * 60000), status: "completed", priceCAD: 30, createdAt: start },
    });
  }
  if (opts.upcomingInDays !== undefined) {
    const start = new Date(NOW.getTime() + opts.upcomingInDays * DAY);
    await prisma.booking.create({
      data: { serviceId: "sms-cut", staffId: "sms-stylist", customerId: c.id, start, end: new Date(start.getTime() + 30 * 60000), status: "confirmed", priceCAD: 30, createdAt: new Date(NOW.getTime() - DAY) },
    });
  }
  return c;
}

const express = (phone: string, at = new Date(NOW.getTime() - 30 * DAY)) =>
  recordConsent({ phone, status: "express", source: "admin", wording: "Can CF Hair Salon text you specials? Reply STOP any time.", actor: "owner", now: at });

beforeAll(async () => {
  await prisma.service.upsert({ where: { id: "sms-cut" }, create: { id: "sms-cut", name: "Cut", category: "Haircuts", durationMin: 30, priceCAD: 30, description: "" }, update: {} });
  await prisma.staff.upsert({ where: { id: "sms-stylist" }, create: { id: "sms-stylist", name: "Stylist S", role: "Stylist", bio: "" }, update: {} });
});
beforeEach(async () => {
  setTwilio({});
  await reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setTwilio({});
});

describe("two senders: promotions and appointment texts", () => {
  it("picks the transactional sender, falling back to the old single-number variables", () => {
    setTwilio({ TWILIO_FROM_NUMBER: "+16045550001" });
    expect(senderFor("transactional")).toEqual({ From: "+16045550001" });
    expect(senderFor("promo")).toBeNull(); // the old variable never sends promotions
    setTwilio({ TWILIO_TXN_MESSAGING_SERVICE_SID: "MGtxn", TWILIO_FROM_NUMBER: "+16045550001", TWILIO_PROMO_FROM: "+17785550002" });
    expect(senderFor("transactional")).toEqual({ MessagingServiceSid: "MGtxn" });
    expect(senderFor("promo")).toEqual({ From: "+17785550002" });
  });

  it("is outbox without credentials, blocked without a separate promo sender, live with one", () => {
    expect(smsMode()).toBe("outbox");
    setTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+16045550001" });
    expect(smsMode()).toBe("blocked");
    setTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_TXN_FROM: "+16045550001", TWILIO_PROMO_FROM: "+16045550001" });
    expect(smsMode()).toBe("blocked"); // same number for both is refused
    setTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_TXN_FROM: "+16045550001", TWILIO_PROMO_MESSAGING_SERVICE_SID: "MGpromo" });
    expect(smsMode()).toBe("live");
    process.env.SMS_DRY_RUN = "1";
    expect(smsMode()).toBe("outbox");
  });

  it("refuses to schedule a campaign when no promo sender is configured (outside outbox mode)", async () => {
    await client("Ann", "+16045559001");
    const c = await createCampaign({ name: "x", bodies: { "en-US": "Hello" }, audience: { type: "all" }, includeImplied: false });
    setTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+16045550001" });
    await expect(scheduleCampaign(c.id, null, NOW)).rejects.toMatchObject({ code: "PROMO_SENDER_MISSING" });
    await expect(processQueue({ now: NOW })).rejects.toBeInstanceOf(HttpError);
  });

  it("sends promotions from the promo sender and confirmations from the transactional sender", async () => {
    setTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_TXN_FROM: "+16045550001", TWILIO_PROMO_MESSAGING_SERVICE_SID: "MGpromo" });
    const calls: URLSearchParams[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: URLSearchParams }) => {
      calls.push(new URLSearchParams(init.body));
      return new Response(JSON.stringify({ sid: `SM${calls.length}`, status: "queued" }), { status: 201 });
    });
    await twilioSend("promo", "+16045559002", "CF Hair Salon: hi. Reply STOP to opt out.");
    await sendNotice("confirmation", { phone: "+16045559002", name: "B" }, "CF Hair Salon: you're booked.", { subject: "s", text: "t" });
    expect(calls[0].get("MessagingServiceSid")).toBe("MGpromo");
    expect(calls[0].get("From")).toBeNull();
    expect(calls[1].get("From")).toBe("+16045550001");
    expect(calls[1].get("MessagingServiceSid")).toBeNull();
    expect(calls[1].get("Body")).not.toContain("STOP"); // only promotions carry the opt-out line
  });

  it("skips appointment texts for a client who opted out of the transactional number and uses email", async () => {
    setTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_TXN_FROM: "+16045550001", TWILIO_PROMO_FROM: "+17785550002" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const c = await client("Ryan", "+16045559003", { email: "ryan@example.com" });
    await handleInbound({ from: c.phone, body: "STOP", channel: "transactional", advancedOptOut: true, now: NOW });
    const r = await sendNotice("reminder", { phone: c.phone, email: c.email, name: c.name }, "CF Hair Salon: reminder", { subject: "Reminder", text: "Reminder" });
    expect(r).toMatchObject({ channel: "email", reason: "txn_opted_out" });
    expect(fetchSpy).not.toHaveBeenCalled(); // no Twilio call, and no email provider configured (dry run)
    const log = await prisma.notification.findFirstOrThrow({ where: { kind: "reminder" } });
    expect(log).toMatchObject({ channel: "email", to: "ryan@example.com", status: "dry_run" });
  });
});

describe("inbound replies, routed by sender", () => {
  it("identifies the sender from To or MessagingServiceSid", () => {
    setTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_TXN_FROM: "+16045550001", TWILIO_PROMO_MESSAGING_SERVICE_SID: "MGpromo" });
    expect(identifyChannel({ To: "+16045550001" })).toBe("transactional");
    expect(identifyChannel({ To: "+17785550009", MessagingServiceSid: "MGpromo" })).toBe("promo");
    expect(identifyChannel({ To: "+19999999999" })).toBeNull();
    expect(identifyChannel({ To: "+19999999999" }, "promo")).toBe("promo");
  });

  it("STOP to the promo sender withdraws promotional consent only, immediately, with a logged event", async () => {
    const c = await client("Paolo", "+16045559010");
    await express(c.phone);
    const r = await handleInbound({ from: c.phone, body: "Stop", channel: "promo", messageSid: "SMin1", advancedOptOut: false, now: NOW });
    expect(r.action).toBe("stop");
    expect(r.reply).toBe(REPLIES.promoStop["en-US"]);
    const consent = await getConsent(c.phone, NOW);
    expect(consent.status).toBe("withdrawn");
    const row = await prisma.smsConsent.findUniqueOrThrow({ where: { phone: c.phone } });
    expect(row.txnOptedOutAt).toBeNull(); // appointment texts unaffected
    const ev = await prisma.consentEvent.findFirstOrThrow({ where: { phone: c.phone, type: "withdrawn" } });
    expect(ev).toMatchObject({ source: "keyword", actor: "customer", wording: "Stop" });
    expect(JSON.parse(ev.detail!)).toMatchObject({ channel: "promo", messageSid: "SMin1" });
  });

  it("STOP to the transactional sender marks appointment texts off and keeps promotional consent", async () => {
    const c = await client("Ryan", "+16045559011");
    await express(c.phone);
    const r = await handleInbound({ from: c.phone, body: "STOP", channel: "transactional", advancedOptOut: false, now: NOW });
    expect(r.reply).toBe(REPLIES.txnStop["en-US"]);
    const row = await prisma.smsConsent.findUniqueOrThrow({ where: { phone: c.phone } });
    expect(row.txnOptedOutAt).not.toBeNull();
    expect(row.status).toBe("express");
    expect(await prisma.consentEvent.count({ where: { phone: c.phone, type: "txn_opted_out" } })).toBe(1);
    await handleInbound({ from: c.phone, body: "START", channel: "transactional", advancedOptOut: false, now: NOW });
    expect((await prisma.smsConsent.findUniqueOrThrow({ where: { phone: c.phone } })).txnOptedOutAt).toBeNull();
  });

  it("Chinese and Korean keywords opt out and get a reply in that language", async () => {
    const a = await client("Mei", "+16045559012", { lang: "zh-CN" });
    const b = await client("Ji-woo", "+16045559013", { lang: "ko-KR" });
    await express(a.phone);
    await express(b.phone);
    const ra = await handleInbound({ from: a.phone, body: "退订", channel: "promo", advancedOptOut: true, now: NOW });
    const rb = await handleInbound({ from: b.phone, body: "수신거부", channel: "promo", advancedOptOut: true, now: NOW });
    // Twilio does not know these keywords, so the app replies even with Advanced Opt-Out on.
    expect(ra.reply).toBe(REPLIES.promoStop["zh-CN"]);
    expect(rb.reply).toBe(REPLIES.promoStop["ko-KR"]);
    expect((await getConsent(a.phone, NOW)).status).toBe("withdrawn");
    expect((await getConsent(b.phone, NOW)).status).toBe("withdrawn");
  });

  it("does not reply twice when Twilio Advanced Opt-Out already answered STOP", async () => {
    const c = await client("Al", "+16045559014");
    const r = await handleInbound({ from: c.phone, body: "STOP", channel: "promo", optOutType: "STOP", advancedOptOut: true, now: NOW });
    expect(r.reply).toBeNull();
    expect((await getConsent(c.phone, NOW)).status).toBe("withdrawn");
  });

  it("START and UNSTOP re-subscribe (logged as resubscribed)", async () => {
    const c = await client("Al", "+16045559015");
    await express(c.phone);
    await handleInbound({ from: c.phone, body: "STOP", channel: "promo", advancedOptOut: false, now: NOW });
    const r = await handleInbound({ from: c.phone, body: "unstop", channel: "promo", advancedOptOut: false, now: new Date(NOW.getTime() + 60000) });
    expect(r.action).toBe("start");
    expect(r.reply).toContain("Reply STOP to opt out");
    const v = await getConsent(c.phone, NOW);
    expect(v).toMatchObject({ status: "express", source: "keyword" });
    expect(await prisma.consentEvent.count({ where: { phone: c.phone, type: "resubscribed" } })).toBe(1);
  });

  it("HELP replies with the salon name and phone", async () => {
    const r = await handleInbound({ from: "+16045559016", body: "help", channel: "promo", advancedOptOut: false, now: NOW });
    expect(r.action).toBe("help");
    expect(r.reply).toContain("CF Hair Salon");
    expect(r.reply).toContain("(604) 475-7705");
    expect(await prisma.consentEvent.count({ where: { phone: "+16045559016", type: "help" } })).toBe(1);
  });

  it("other replies go to the admin Messages inbox", async () => {
    const c = await client("Kevin", "+16045559017", { lang: "zh-HK" });
    const r = await handleInbound({ from: c.phone, body: "請問星期日有冇位？", channel: "promo", advancedOptOut: false, now: NOW });
    expect(r.action).toBe("message");
    expect(r.reply).toBeNull();
    const m = await prisma.message.findUniqueOrThrow({ where: { id: r.inboxMessageId! } });
    expect(m).toMatchObject({ source: "sms", callerName: "Kevin", phone: c.phone });
    expect(m.message).toContain("請問星期日有冇位");
  });

  it("CANCEL from a client with an appointment opts out and flags the appointment for a call", async () => {
    const c = await client("Grace", "+16045559018", { upcomingInDays: 2 });
    const r = await handleInbound({ from: c.phone, body: "CANCEL", channel: "promo", advancedOptOut: false, now: NOW });
    expect(r.action).toBe("stop");
    const m = await prisma.message.findUniqueOrThrow({ where: { id: r.inboxMessageId! } });
    expect(m.urgency).toBe("high");
    expect(m.message).toContain("meant to cancel the appointment");
  });
});

describe("inbound webhook security", () => {
  const form = (p: Record<string, string>) => new URLSearchParams(p).toString();

  it("rejects unsigned requests and accepts Twilio-signed ones when Twilio is configured", async () => {
    setTwilio({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "secret", TWILIO_PROMO_FROM: "+17785550002", TWILIO_TXN_FROM: "+16045550001", PUBLIC_BASE_URL: "https://cfhair.example" });
    const c = await client("Sig", "+16045559020");
    await express(c.phone);
    const params = { From: c.phone, To: "+17785550002", Body: "STOP", MessageSid: "SMsig" };
    const unsigned = await inboundRoute(new Request("http://localhost:3000/api/sms/inbound", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-api-key": "test-agent-key" }, body: form(params) }));
    expect(unsigned.status).toBe(403); // the agent key is not a bypass once Twilio is configured
    expect((await getConsent(c.phone)).status).toBe("express");

    const sig = computeTwilioSignature("secret", "https://cfhair.example/api/sms/inbound", params);
    const ok = await inboundRoute(new Request("http://localhost:3000/api/sms/inbound", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: form(params) }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/xml");
    expect((await getConsent(c.phone)).status).toBe("withdrawn");
  });

  it("in outbox mode accepts the agent key instead (test bypass) and routes by Channel", async () => {
    const c = await client("Test", "+16045559021");
    await express(c.phone);
    const res = await inboundRoute(
      new Request("http://localhost:3000/api/sms/inbound", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-api-key": "test-agent-key", accept: "application/json" },
        body: form({ From: c.phone, Body: "STOP", Channel: "transactional" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: "stop", channel: "transactional" });
    const noKey = await inboundRoute(new Request("http://localhost:3000/api/sms/inbound", { method: "POST", body: form({ From: c.phone, Body: "STOP" }) }));
    expect(noKey.status).toBe(403);
  });
});

describe("campaigns in outbox mode", () => {
  async function audienceFixture() {
    const a = await client("Express Anna", "+16045559030", { paidVisitDaysAgo: 20 });
    await express(a.phone);
    const b = await client("Implied Ben", "+16045559031", { paidVisitDaysAgo: 365 });
    const c = await client("Expired Cara", "+16045559032", { paidVisitDaysAgo: 3 * 365 });
    const d = await client("Withdrawn Dan", "+16045559033", { paidVisitDaysAgo: 10 });
    await express(d.phone);
    await recordConsent({ phone: d.phone, status: "withdrawn", source: "keyword", wording: "STOP", actor: "customer" });
    const e = await client("Nobody Ed", "+16045559034");
    const f = await client("Busy Fay", "+16045559035", { lang: "zh-CN" });
    await express(f.phone);
    const old = await createCampaign({ name: "old", bodies: { "en-US": "x" }, audience: { type: "all" }, includeImplied: false });
    for (const days of [2, 8, 15, 25]) {
      await prisma.campaignMessage.create({
        data: { campaignId: old.id, phone: f.phone, name: f.name, body: "x", status: "delivered", sentAt: new Date(NOW.getTime() - days * DAY) },
      });
    }
    return { a, b, c, d, e, f };
  }

  it("previews who gets it, why others do not, segments and cost", async () => {
    const { a } = await audienceFixture();
    const input = { name: "Autumn", bodies: { "en-US": "15% off colour this week.", "zh-CN": "本周染发85折。" }, audience: { type: "all" as const }, includeImplied: false };
    const p = await previewCampaign(input, NOW);
    expect(p.audience.eligibleCount).toBe(1);
    expect(p.audience.sample[0].name).toBe(a.name);
    expect(p.audience.skipped).toMatchObject({ implied_excluded: 1, implied_expired: 1, withdrawn: 1, no_consent: 1, frequency_cap: 1 });
    expect(p.previews.find((x) => x.language === "en-US")?.info.segments).toBe(1);
    expect(p.estimatedCostUSD).toBeCloseTo(0.0163, 4);

    const withImplied = await previewCampaign({ ...input, includeImplied: true }, NOW);
    expect(withImplied.audience.eligibleCount).toBe(2);
    expect(withImplied.audience.byConsent).toEqual({ express: 1, implied: 1 });
    expect(withImplied.audience.skipped.implied_expired).toBe(1); // expired implied consent never counts
  });

  it("sends through the outbox, and a STOP between queueing and sending wins", async () => {
    const { a } = await audienceFixture();
    const late = await client("Late Lee", "+16045559036");
    await express(late.phone);
    const c = await createCampaign({ name: "Now", bodies: { "en-US": "Hello from us." }, audience: { type: "all" }, includeImplied: true });
    const s = await scheduleCampaign(c.id, null, NOW);
    expect(s.adjustedForQuietHours).toBe(false);
    await queueCampaign(c.id, NOW);
    await handleInbound({ from: late.phone, body: "STOP", channel: "promo", advancedOptOut: false, now: NOW });
    const run = await processQueue({ now: NOW, intervalMs: 0 });
    expect(run.mode).toBe("outbox");

    const msgs = await prisma.campaignMessage.findMany({ where: { campaignId: c.id } });
    const byPhone = new Map(msgs.map((m) => [m.phone, m]));
    expect(byPhone.get(a.phone)).toMatchObject({ status: "sent", dryRun: true, body: "CF Hair Salon: Hello from us. Reply STOP to opt out." });
    expect(byPhone.get(late.phone)).toMatchObject({ status: "skipped", skipReason: "withdrawn" });
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("sent");

    // Next campaign: Lee is excluded up front.
    const next = await previewCampaign({ name: "n", bodies: { "en-US": "Again" }, audience: { type: "all" }, includeImplied: true }, NOW);
    expect(next.audience.sample.map((r) => r.name)).not.toContain("Late Lee");
  });

  it("moves a send in quiet hours to 09:00 and never sends before then", async () => {
    await audienceFixture();
    const c = await createCampaign({ name: "Late", bodies: { "en-US": "Hi" }, audience: { type: "all" }, includeImplied: false });
    const evening = zonedTime("2026-10-07", 21 * 60 + 30, TZ);
    const s = await scheduleCampaign(c.id, null, evening);
    expect(s.adjustedForQuietHours).toBe(true);
    expect(s.campaign.scheduledAt?.toISOString()).toBe(zonedTime("2026-10-08", 9 * 60, TZ).toISOString());
    const night = await processQueue({ now: evening });
    expect(night.campaignsStarted).toBe(0);
    expect(night.sent).toBe(0);
    const morning = await processQueue({ now: zonedTime("2026-10-08", 9 * 60 + 5, TZ), intervalMs: 0 });
    expect(morning.campaignsStarted).toBe(1);
    expect(morning.sent).toBe(1);
  });

  it("re-checks the frequency cap at send time", async () => {
    const f = await client("Fay", "+16045559040");
    await express(f.phone);
    const old = await createCampaign({ name: "old", bodies: { "en-US": "x" }, audience: { type: "all" }, includeImplied: false });
    const c = await createCampaign({ name: "Cap", bodies: { "en-US": "Hi" }, audience: { type: "all" }, includeImplied: false });
    await scheduleCampaign(c.id, null, NOW);
    await queueCampaign(c.id, NOW);
    for (const days of [1, 3, 5, 7]) {
      await prisma.campaignMessage.create({ data: { campaignId: old.id, phone: f.phone, name: "Fay", body: "x", status: "sent", sentAt: new Date(NOW.getTime() - days * DAY) } });
    }
    await processQueue({ now: NOW, intervalMs: 0 });
    const m = await prisma.campaignMessage.findFirstOrThrow({ where: { campaignId: c.id, phone: f.phone } });
    expect(m).toMatchObject({ status: "skipped", skipReason: "frequency_cap" });
  });

  it("attributes bookings and opt-outs within 14 days", async () => {
    const a = await client("Booker", "+16045559050");
    const b = await client("Leaver", "+16045559051");
    await express(a.phone);
    await express(b.phone);
    const c = await createCampaign({ name: "Attr", bodies: { "en-US": "Hi" }, audience: { type: "all" }, includeImplied: false });
    await scheduleCampaign(c.id, null, NOW);
    await processQueue({ now: NOW, intervalMs: 0 });
    const start = new Date(NOW.getTime() + 5 * DAY);
    await prisma.booking.create({
      data: { serviceId: "sms-cut", staffId: "sms-stylist", customerId: a.id, start, end: new Date(start.getTime() + 1800000), priceCAD: 45, createdAt: new Date(NOW.getTime() + 2 * DAY) },
    });
    await recordConsent({ phone: b.phone, status: "withdrawn", source: "keyword", wording: "STOP", actor: "customer", now: new Date(NOW.getTime() + 3600000) });
    const s = (await campaignStats([c.id])).get(c.id)!;
    expect(s).toMatchObject({ sent: 2, bookings: 1, bookedValueCAD: 45, optOuts: 1 });
  });
});

describe("consent records", () => {
  it("requires the exact wording for express consent", async () => {
    await expect(recordConsent({ phone: "+16045559060", status: "express", source: "admin", actor: "owner" })).rejects.toMatchObject({ code: "WORDING_REQUIRED" });
  });

  it("starts implied consent after a paid visit and expires it after two years", async () => {
    const c = await client("Imp", "+16045559061", { paidVisitDaysAgo: 2 * 365 - 5 });
    const r1 = await syncImpliedConsent(NOW);
    expect(r1.started).toBe(1);
    const row = await prisma.smsConsent.findUniqueOrThrow({ where: { phone: c.phone } });
    expect(row.status).toBe("implied");
    expect(row.impliedBasis).toContain("existing business relationship");
    const r2 = await syncImpliedConsent(new Date(NOW.getTime() + 10 * DAY));
    expect(r2.expired).toBe(1);
    expect((await prisma.smsConsent.findUniqueOrThrow({ where: { phone: c.phone } })).status).toBe("none");
    expect((await prisma.consentEvent.findMany({ where: { phone: c.phone } })).map((e) => e.type)).toEqual(["implied", "implied_expired"]);
  });

  it("the agent endpoint records a phone opt-in, and a decline stops future asks", async () => {
    const c = await client("Caller", "+16045559062");
    const post = (body: object) =>
      consentRoute(
        new Request("http://localhost/api/customers/consent", { method: "POST", headers: { "x-api-key": "test-agent-key", "content-type": "application/json" }, body: JSON.stringify(body) }) as never,
      );
    const callerView = async () =>
      (await (await getCallerRoute(new Request("http://localhost/api/callers/x", { headers: { "x-api-key": "test-agent-key" } }) as never, { params: Promise.resolve({ phone: c.phone }) } as never)).json()) as {
        smsConsent: { status: string; canAsk: boolean };
      };
    expect((await callerView()).smsConsent).toMatchObject({ status: "none", canAsk: true });

    const declined = await post({ phone: c.phone, status: "declined", source: "phone", wording: "Would you like the occasional text about specials? You can reply STOP any time." });
    expect(declined.status).toBe(201);
    expect((await callerView()).smsConsent).toMatchObject({ status: "none", canAsk: false });

    const yes = await post({ phone: "604-555-9063", status: "express", source: "phone", wording: "Would you like the occasional text about specials? You can reply STOP any time.", language: "en-US" });
    expect(yes.status).toBe(201);
    const ev = await prisma.consentEvent.findFirstOrThrow({ where: { phone: "+16045559063", type: "express" } });
    expect(ev).toMatchObject({ source: "phone", actor: "agent" });

    const bad = await post({ phone: c.phone, status: "maybe", source: "phone" });
    expect(bad.status).toBe(400);
  });
});
