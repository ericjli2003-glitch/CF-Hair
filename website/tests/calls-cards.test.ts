// Calls log and handwritten cards queue against a real SQLite database: auth,
// call upsert idempotency, card text validation, the monthly cap, the sent and
// failed transitions, transcript clean-up and the seed-if-empty step used on deploy.
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createSessionToken } from "@/lib/auth";
import { clearOldTranscripts } from "@/lib/calls";
import { checkCardText, normalizeCardText } from "@/lib/cards/text";
import { monthBounds } from "@/lib/cards";
import { salon } from "@/lib/salon";
import { GET as listCallsRoute, POST as postCall } from "@/app/api/calls/route";
import { GET as getCallRoute } from "@/app/api/calls/[id]/route";
import { GET as listBatchesRoute, POST as postBatch } from "@/app/api/cards/batches/route";
import { POST as approveAllRoute } from "@/app/api/cards/batches/[id]/approve-all/route";
import { GET as listCardsRoute } from "@/app/api/cards/route";
import { PATCH as patchCardRoute } from "@/app/api/cards/[id]/route";
import { POST as sentRoute } from "@/app/api/cards/[id]/sent/route";
import { PUT as putSettings } from "@/app/api/cards/settings/route";
import { POST as queueRoute } from "@/app/api/sms/queue/route";
import { seedExtrasIfEmpty } from "../prisma/seed-extras";
import { DEMO_CALL_CLIENTS } from "../prisma/seed-calls";
import { DEMO_CARD_CLIENTS } from "../prisma/seed-cards";

// The owner's session cookie, read by isAdminSession() through next/headers.
let sessionCookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "cf_admin" && sessionCookie ? { name, value: sessionCookie } : undefined) }),
}));

const B = "http://localhost:3000";
const KEY = { "x-api-key": "test-agent-key", "content-type": "application/json" };
const DAY = 86400000;

function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new NextRequest(B + path, {
    method: init.method ?? "GET",
    headers: init.headers ?? KEY,
    ...(init.body !== undefined ? { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) } : {}),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function wipe() {
  await prisma.card.deleteMany();
  await prisma.cardBatch.deleteMany();
  await prisma.call.deleteMany();
  await prisma.message.deleteMany();
  await prisma.appSetting.deleteMany();
  await prisma.slotLock.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.campaignMessage.deleteMany();
  await prisma.smsConsent.deleteMany();
  await prisma.callerProfile.deleteMany();
  await prisma.customer.deleteMany();
}

beforeEach(async () => {
  sessionCookie = undefined;
  delete process.env.CALL_TRANSCRIPT_DAYS;
  delete process.env.SEED_DEMO_EXTRAS;
  await wipe();
});
afterEach(() => {
  sessionCookie = undefined;
});

const call = (over: Record<string, unknown> = {}) => ({
  callSid: "CA0001",
  from: "604-555-0142",
  startedAt: new Date(Date.now() - 600000).toISOString(),
  endedAt: new Date(Date.now() - 480000).toISOString(),
  language: "zh-HK",
  languageSource: "saved",
  outcome: "booked",
  summary: "Booked a men's haircut for Tuesday at 2 pm.",
  transcript: [
    { role: "agent", text: "CF Hair Salon at Henderson Place, how can I help?", lang: "en-US" },
    { role: "caller", text: "我想約剪頭髮。", lang: "zh-HK" },
  ],
  ...over,
});

describe("calls API", () => {
  it("requires the agent key to post and an admin session or the key to read", async () => {
    expect((await postCall(req("/api/calls", { method: "POST", body: call(), headers: { "content-type": "application/json" } }))).status).toBe(401);
    expect((await postCall(req("/api/calls", { method: "POST", body: call(), headers: { "x-api-key": "wrong" } }))).status).toBe(401);
    expect((await listCallsRoute(req("/api/calls", { headers: {} }))).status).toBe(401);
    sessionCookie = createSessionToken().token;
    expect((await listCallsRoute(req("/api/calls", { headers: {} }))).status).toBe(200);
  });

  it("upserts by callSid: 201 then 200, one row, later fields merge in", async () => {
    const client = await prisma.customer.create({ data: { name: "Kevin Wong", phone: "+16045550142" } });
    const first = await postCall(req("/api/calls", { method: "POST", body: call() }));
    expect(first.status).toBe(201);
    const a = (await first.json()).call;
    expect(a.from).toBe("+16045550142");
    expect(a.customer).toEqual({ id: client.id, name: "Kevin Wong" });
    expect(a.durationSec).toBe(120);

    const again = await postCall(req("/api/calls", { method: "POST", body: call() }));
    expect(again.status).toBe(200);
    const update = await postCall(req("/api/calls", { method: "POST", body: { callSid: "CA0001", transferResult: "answered", smsConsent: "yes" } }));
    expect(update.status).toBe(200);
    const b = (await update.json()).call;
    expect(b.id).toBe(a.id);
    expect(b.transferResult).toBe("answered");
    expect(b.summary).toBe(a.summary);
    expect(b.transcript).toHaveLength(2);
    expect(await prisma.call.count()).toBe(1);
  });

  it("stores a withheld number as null and validates the body", async () => {
    const r = await postCall(req("/api/calls", { method: "POST", body: call({ callSid: "CA0002", from: null }) }));
    expect(r.status).toBe(201);
    expect((await r.json()).call.from).toBeNull();
    const bad = await postCall(req("/api/calls", { method: "POST", body: call({ callSid: "CA0003", outcome: "voicemail" }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toContain("outcome");
    const partial = await postCall(req("/api/calls", { method: "POST", body: { callSid: "CA0004", outcome: "info" } }));
    expect(partial.status).toBe(400);
    expect((await partial.json()).message).toContain("summary");
    expect((await postCall(req("/api/calls", { method: "POST", body: "{not json" }))).status).toBe(400);
  });

  it("lists newest first with filters and a cursor, and returns one call with its transcript", async () => {
    for (let i = 0; i < 5; i++) {
      await postCall(req("/api/calls", {
        method: "POST",
        body: call({ callSid: `CA1${i}`, startedAt: new Date(Date.now() - (i + 1) * DAY).toISOString(), endedAt: undefined, durationSec: 30, outcome: i % 2 ? "message" : "booked", from: `604-555-01${10 + i}` }),
      }));
    }
    const all = await (await listCallsRoute(req("/api/calls?limit=2"))).json();
    expect(all.calls.map((c: { callSid: string }) => c.callSid)).toEqual(["CA10", "CA11"]);
    expect(all.calls[0].transcript).toBeUndefined();
    const next = await (await listCallsRoute(req(`/api/calls?limit=2&cursor=${all.nextCursor}`))).json();
    expect(next.calls.map((c: { callSid: string }) => c.callSid)).toEqual(["CA12", "CA13"]);
    const msgs = await (await listCallsRoute(req("/api/calls?outcome=message"))).json();
    expect(msgs.calls).toHaveLength(2);
    const byPhone = await (await listCallsRoute(req("/api/calls?phone=6045550112"))).json();
    expect(byPhone.calls.map((c: { callSid: string }) => c.callSid)).toEqual(["CA12"]);
    expect((await listCallsRoute(req("/api/calls?from=2026-13-01"))).status).toBe(400);

    const one = await getCallRoute(req(`/api/calls/${all.calls[0].id}`), ctx(all.calls[0].id));
    expect((await one.json()).call.transcript[1]).toMatchObject({ role: "caller", lang: "zh-HK" });
    expect((await getCallRoute(req("/api/calls/nope"), ctx("nope"))).status).toBe(404);
  });
});

describe("transcript retention", () => {
  it("clears transcripts older than CALL_TRANSCRIPT_DAYS and keeps the summary", async () => {
    const now = new Date();
    const mk = (sid: string, daysAgo: number) =>
      prisma.call.create({
        data: { callSid: sid, startedAt: new Date(now.getTime() - daysAgo * DAY), outcome: "info", summary: `Summary ${sid}`, transcript: JSON.stringify([{ role: "caller", text: "hi" }]) },
      });
    await mk("old", 91);
    await mk("recent", 89);
    expect(await clearOldTranscripts(now)).toEqual({ cleared: 1, days: 90 });
    const old = await prisma.call.findUniqueOrThrow({ where: { callSid: "old" } });
    expect(old.transcript).toBeNull();
    expect(old.transcriptClearedAt).not.toBeNull();
    expect(old.summary).toBe("Summary old");
    expect((await prisma.call.findUniqueOrThrow({ where: { callSid: "recent" } })).transcript).not.toBeNull();

    process.env.CALL_TRANSCRIPT_DAYS = "30";
    expect((await clearOldTranscripts(now)).cleared).toBe(1);
    expect(await clearOldTranscripts(now)).toEqual({ cleared: 0, days: 30 });
  });

  it("runs from the queue endpoint", async () => {
    await prisma.call.create({ data: { callSid: "q-old", startedAt: new Date(Date.now() - 120 * DAY), outcome: "info", summary: "s", transcript: "[]" } });
    const r = await queueRoute(req("/api/sms/queue", { method: "POST" }));
    expect(r.status).toBe(200);
    expect((await r.json()).transcripts.cleared).toBe(1);
  });
});

// ---------------------------------------------------------------------------

const address = { line1: "2975 Atlantic Ave", line2: "#1504", city: "Coquitlam", province: "BC", postalCode: "V3B 0C5", country: "CA" };
const card = (ref: string, over: Record<string, unknown> = {}) => ({
  clientRef: ref,
  name: `Client ${ref}`,
  mailingAddress: address,
  stylistName: "Stylist A",
  lastServiceName: "Root Touch-up Colour",
  cardDesign: "cf-thinking-of-you",
  message: `Dear ${ref},\nWe miss you at Henderson Place. Come and see us soon!\nWarmly,\nCF Hair Salon`,
  maxChars: 120,
  mock: false,
  ...over,
});
const batch = (cards: unknown[], over: Record<string, unknown> = {}) => ({
  campaignId: "win-back",
  campaignName: "We miss you",
  occasion: "Win-back",
  generatedAt: "2026-10-03T12:00:00-07:00",
  mock: false,
  cards,
  ...over,
});
async function upload(cards: unknown[], over: Record<string, unknown> = {}) {
  const r = await postBatch(req("/api/cards/batches", { method: "POST", body: batch(cards, over) }));
  expect(r.status).toBe(201);
  return (await r.json()).batch as { id: string; cards: { id: string; clientRef: string }[] };
}
const patch = (id: string, body: unknown) => patchCardRoute(req(`/api/cards/${id}`, { method: "PATCH", body }), ctx(id));
const sent = (id: string, body: unknown) => sentRoute(req(`/api/cards/${id}/sent`, { method: "POST", body }), ctx(id));

describe("cards: upload", () => {
  it("needs the agent key, links clients by id or phone, and is idempotent for pending cards", async () => {
    const c = await prisma.customer.create({ data: { name: "Jasmine Liu", phone: "+16045550103" } });
    expect((await postBatch(req("/api/cards/batches", { method: "POST", body: batch([card("a")]), headers: { "content-type": "application/json" } }))).status).toBe(401);

    const one = await upload([card(c.id), card("604-555-0103"), card("x")]);
    expect(one.cards).toHaveLength(3);
    const rows = await prisma.card.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.customerId)).toEqual([c.id, c.id, null]);

    // Same run posted again: same batch, same cards, nothing duplicated.
    const again = await upload([card(c.id, { message: "Dear Jasmine, updated text." }), card("604-555-0103"), card("x")]);
    expect(again.id).toBe(one.id);
    expect(again.cards.map((x) => x.id)).toEqual(one.cards.map((x) => x.id));
    expect(await prisma.card.count()).toBe(3);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: one.cards[0].id } })).message).toBe("Dear Jasmine, updated text.");

    // A new run of the same campaign: pending cards move to it; a skipped one gets a fresh card.
    await patch(one.cards[2].id, { status: "skipped" });
    const later = await upload([card(c.id), card("x")], { generatedAt: "2026-11-03T12:00:00-08:00" });
    expect(later.id).not.toBe(one.id);
    expect(later.cards[0].id).toBe(one.cards[0].id);
    expect(later.cards[1].id).not.toBe(one.cards[2].id);
    expect(await prisma.card.count()).toBe(4);

    const list = await (await listBatchesRoute(req("/api/cards/batches"))).json();
    expect(list.batches[0].counts).toMatchObject({ pending: 2, total: 2 });
    expect(list.batches[1].counts).toMatchObject({ pending: 1, skipped: 1, total: 2 });
    expect(list.month).toMatchObject({ cap: 40, pricePerCardCAD: 8.5, used: 0 });
  });

  it("rejects a malformed batch", async () => {
    const r = await postBatch(req("/api/cards/batches", { method: "POST", body: batch([card("a", { mailingAddress: { line1: "x" } })]) }));
    expect(r.status).toBe(400);
    const dup = await postBatch(req("/api/cards/batches", { method: "POST", body: batch([card("a"), card("a")]) }));
    expect((await dup.json()).error).toBe("DUPLICATE_CLIENT_REF");
  });
});

describe("cards: text rules on PATCH", () => {
  it("re-checks length, dashes and emoji, and normalises curly quotes", async () => {
    const [c] = (await upload([card("a")])).cards;
    const tooLong = await patch(c.id, { message: "a".repeat(121) });
    expect(tooLong.status).toBe(400);
    const body = await tooLong.json();
    expect(body.error).toBe("INVALID_TEXT");
    expect(body.issues[0]).toMatchObject({ field: "message", code: "too_long" });

    for (const [text, code] of [
      ["Dear Kim, see you soon \u2014 we miss you.", "dash"],
      ["Dear Kim, open 10\u20136 every day.", "dash"],
      ["Dear Kim, we miss you \u{1F487}‍♀️", "emoji"],
      ["Dear Kim ❤️", "emoji"],
      ["Dear Kim → come back", "unsupported_char"],
    ] as const) {
      const r = await patch(c.id, { message: text });
      expect(r.status, text).toBe(400);
      expect((await r.json()).issues.map((i: { code: string }) => i.code)).toContain(code);
    }
    const alt = await patch(c.id, { messageAlt: "好耐冇見\u2014\u2014隨時回來。" });
    expect((await alt.json()).issues[0]).toMatchObject({ field: "messageAlt", code: "dash" });

    const ok = await patch(c.id, { message: "Dear Kim, it’s been a while… “come back” soon!", messageAlt: "好耐冇見，隨時回來Henderson Place。" });
    expect(ok.status).toBe(200);
    const saved = (await ok.json()).card;
    expect(saved.message).toBe(`Dear Kim, it's been a while... "come back" soon!`);
    expect(saved.editedAt).not.toBeNull();
    expect(saved.status).toBe("pending");
  });

  it("counts characters as they are written (graphemes), shared with the editor", () => {
    expect(checkCardText({ message: "é".normalize("NFD").repeat(10) }, 10)).toEqual([]);
    expect(normalizeCardText("  Hi\r\nthere …  ")).toBe("Hi\nthere ...");
    expect(checkCardText({ message: "  " }, 10).map((i) => i.code)).toContain("empty");
  });
});

describe("cards: monthly cap", () => {
  it("refuses approvals past the cap with 409 MONTHLY_CAP; skipped cards do not count", async () => {
    expect((await putSettings(req("/api/cards/settings", { method: "PUT", body: { monthlyCap: 2, pricePerCardCAD: 9.25 } }))).status).toBe(200);
    expect((await putSettings(req("/api/cards/settings", { method: "PUT", body: { monthlyCap: -1 } }))).status).toBe(400);
    const ids = (await upload([card("a"), card("b"), card("c"), card("d")])).cards.map((c) => c.id);
    expect((await patch(ids[0], { status: "approved" })).status).toBe(200);
    expect((await patch(ids[1], { status: "skipped" })).status).toBe(200);
    expect((await patch(ids[2], { status: "approved" })).status).toBe(200);
    const over = await patch(ids[3], { status: "approved" });
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ error: "MONTHLY_CAP", cap: 2, used: 2, left: 0 });
    // Un-approving frees a place.
    expect((await patch(ids[0], { status: "pending" })).status).toBe(200);
    expect((await patch(ids[3], { status: "approved" })).status).toBe(200);
    // Approvals from last month do not count.
    await prisma.card.update({ where: { id: ids[2] }, data: { approvedAt: new Date(monthBounds().start.getTime() - DAY) } });
    expect((await patch(ids[0], { status: "approved" })).status).toBe(200);
  });

  it("'Approve all remaining' checks the cap, and approves up to a limit when asked", async () => {
    await putSettings(req("/api/cards/settings", { method: "PUT", body: { monthlyCap: 3 } }));
    const b = await upload([card("a"), card("b"), card("c"), card("d"), card("e", { message: "x".repeat(200) })]);
    const all = await approveAllRoute(req(`/api/cards/batches/${b.id}/approve-all`, { method: "POST", body: {} }), ctx(b.id));
    expect(all.status).toBe(409);
    expect(await all.json()).toMatchObject({ error: "MONTHLY_CAP", left: 3, ready: 4 });
    const some = await approveAllRoute(req(`/api/cards/batches/${b.id}/approve-all`, { method: "POST", body: { limit: 3 } }), ctx(b.id));
    expect(await some.json()).toMatchObject({ approved: 3, needsFix: 1, leftPending: 2, used: 3 });
    expect(await prisma.card.count({ where: { status: "approved" } })).toBe(3);
  });
});

describe("cards: sent and failed", () => {
  it("only approved cards can be mailed; sent is final, failed can be retried", async () => {
    const [c] = (await upload([card("a")])).cards;
    const report = { provider: "handwrytten", providerOrderId: "HW-1", sentAt: "2026-10-05T10:00:00-07:00", costCAD: 7.74 };
    expect((await sentRoute(req(`/api/cards/${c.id}/sent`, { method: "POST", body: report, headers: { "content-type": "application/json" } }), ctx(c.id))).status).toBe(401);
    expect((await (await sent(c.id, report)).json()).error).toBe("NOT_APPROVED");

    await patch(c.id, { status: "approved" });
    const approved = await (await listCardsRoute(req("/api/cards?status=approved"))).json();
    expect(approved.cards.map((x: { id: string }) => x.id)).toEqual([c.id]);
    expect(approved.cards[0].mailingAddress).toMatchObject({ city: "Coquitlam", line2: "#1504" });

    const failed = await sent(c.id, { failed: true, error: "Address rejected", provider: "plotter" });
    expect((await failed.json()).card).toMatchObject({ status: "failed", error: "Address rejected", provider: "plotter" });
    expect((await patch(c.id, { status: "pending" })).status).toBe(409);
    expect((await patch(c.id, { status: "approved" })).status).toBe(200);

    const ok = await sent(c.id, report);
    expect(ok.status).toBe(200);
    expect((await ok.json()).card).toMatchObject({ status: "sent", provider: "handwrytten", providerOrderId: "HW-1", costCAD: 7.74, error: null });
    expect((await sent(c.id, report)).status).toBe(200); // the same report again is harmless
    expect((await (await sent(c.id, { ...report, providerOrderId: "HW-2" })).json()).error).toBe("ALREADY_SENT");
    expect((await (await sent(c.id, { failed: true, error: "late" })).json()).error).toBe("ALREADY_SENT");
    expect((await (await patch(c.id, { status: "skipped" })).json()).error).toBe("CARD_SENT");
    expect((await (await patch(c.id, { message: "Dear a, hello." })).json()).error).toBe("CARD_SENT");
    expect((await sent(c.id, { provider: "fax", sentAt: "2026-10-05T10:00:00-07:00" })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe("seed-if-empty for calls and cards (vercel-build)", () => {
  beforeAll(async () => {
    for (const [i, s] of salon.services.entries()) {
      await prisma.service.upsert({ where: { id: s.id }, create: { id: s.id, name: s.name, category: s.category, durationMin: s.durationMin, priceCAD: s.priceCAD, description: "", sortOrder: i }, update: {} });
    }
    for (const [i, s] of salon.staff.entries()) {
      await prisma.staff.upsert({ where: { id: s.id }, create: { id: s.id, name: s.name, role: s.role, bio: "", sortOrder: i }, update: {} });
      for (const serviceId of s.serviceIds) {
        await prisma.staffService.upsert({ where: { staffId_serviceId: { staffId: s.id, serviceId } }, create: { staffId: s.id, serviceId }, update: {} });
      }
    }
  });
  const demoClients = async () => {
    const names = [...new Set([...DEMO_CALL_CLIENTS, ...DEMO_CARD_CLIENTS])];
    for (const [i, name] of names.entries()) {
      await prisma.customer.create({
        data: { name, phone: `+1604555${String(100 + i).padStart(4, "0")}`, mailingAddress: JSON.stringify({ line1: `${100 + i} Pinetree Way`, city: "Coquitlam", province: "BC", postalCode: "V3B 0A1", country: "CA" }) },
      });
    }
  };

  it("fills empty tables once, then leaves them alone", async () => {
    await demoClients();
    const now = new Date();
    const first = await seedExtrasIfEmpty(prisma, now);
    expect("seeded" in first.calls && first.calls.seeded).toBeGreaterThanOrEqual(20);
    expect("seeded" in first.cards && first.cards.seeded).toBe(13);
    const calls = await prisma.call.findMany();
    expect(new Set(calls.map((c) => c.language))).toEqual(new Set(["en-US", "zh-CN", "zh-HK", "ko-KR"]));
    expect(calls.filter((c) => c.outcome === "booked").every((c) => c.bookingId)).toBe(true);
    // Henderson Place stays in English in every transcript that mentions the mall.
    const lines = calls.flatMap((c) => JSON.parse(c.transcript ?? "[]") as { text: string }[]);
    expect(lines.some((l) => /[一-鿿].*Henderson Place|Henderson Place.*[一-鿿]/.test(l.text))).toBe(true);
    expect(lines.every((l) => !/\u2014|\u2013/.test(l.text))).toBe(true);
    expect(await prisma.cardBatch.count()).toBe(2);
    expect(await prisma.card.count({ where: { status: "pending" } })).toBe(8);

    const second = await seedExtrasIfEmpty(prisma, now);
    expect(second).toEqual({ calls: { skipped: "has-data" }, cards: { skipped: "has-data" } });
    expect(await prisma.call.count()).toBe(calls.length);
  });

  it("seeds only the area that is empty", async () => {
    await demoClients();
    await prisma.call.create({ data: { callSid: "real", startedAt: new Date(), outcome: "info", summary: "A real call" } });
    const r = await seedExtrasIfEmpty(prisma);
    expect(r.calls).toEqual({ skipped: "has-data" });
    expect("seeded" in r.cards).toBe(true);
    expect(await prisma.call.count()).toBe(1);
  });

  it("never seeds a database without the demo clients, or when turned off", async () => {
    await prisma.customer.create({ data: { name: "Real Client", phone: "+16045551234" } });
    expect(await seedExtrasIfEmpty(prisma)).toEqual({ calls: { skipped: "no-demo-clients" }, cards: { skipped: "no-demo-clients" } });
    await demoClients();
    process.env.SEED_DEMO_EXTRAS = "0";
    expect(await seedExtrasIfEmpty(prisma)).toEqual({ calls: { skipped: "disabled" }, cards: { skipped: "disabled" } });
    expect(await prisma.call.count()).toBe(0);
  });
});
