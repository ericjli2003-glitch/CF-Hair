import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunManifest } from "../src/types.js";

// OUT_DIR is read when config.ts loads, so point it at a temp dir before importing.
const OUT = mkdtempSync(path.join(tmpdir(), "notes-admin-"));
process.env.NOTES_OUT_DIR = OUT;
process.env.HANDWRYTTEN_API_KEY = "hw-key";
process.env.HANDWRYTTEN_CARD_ID = "3404";
process.env.HANDWRYTTEN_FONT = "hwDavid";
const TODAY = "2026-10-09";
const SITE = "http://site.test";

let admin: typeof import("../src/admin.js");
let run: typeof import("../src/run.js");
let History: typeof import("../src/history.js").History;

beforeAll(async () => {
  admin = await import("../src/admin.js");
  run = await import("../src/run.js");
  History = (await import("../src/history.js")).History;
});

/** In-memory website card queue (per the contract) plus a Handwrytten stub, behind one fetch. */
class FakeWorld {
  batches: Array<Record<string, unknown>> = [];
  cards: Array<Record<string, unknown> & { id: string; status: string; batchId: string }> = [];
  sentReports: Array<{ id: string; body: Record<string, unknown> }> = [];
  handwrytten: Array<{ path: string; body?: Record<string, unknown> }> = [];
  failPlaceFor = new Set<string>();
  keys: string[] = [];
  private seq = 0;
  private order = 500;

  fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (url.host === "api.handwrytten.com") {
      this.handwrytten.push({ path: url.pathname, body });
      if (url.pathname.endsWith("basket/count")) return json({ count: 0 });
      if (url.pathname.endsWith("placeBasket")) {
        const msg = String(body?.message ?? "");
        if ([...this.failPlaceFor].some((f) => msg.includes(f))) return json({ status: "error", message: "address rejected" }, 400);
        return json({ status: "ok" });
      }
      if (url.pathname.endsWith("basket/send")) return json({ status: "ok", order_id: this.order++ });
      return json({}, 404);
    }
    this.keys.push((init.headers as Record<string, string>)["x-api-key"]);
    if (url.pathname === "/api/cards/batches" && init.method === "POST") {
      const id = `b${++this.seq}`;
      this.batches.push({ id, ...body, cards: undefined });
      const cards = (body!.cards as Array<Record<string, unknown>>).map((c) => {
        const card = { ...c, id: `k${++this.seq}`, status: "pending", batchId: id, campaignId: body!.campaignId };
        this.cards.push(card as never);
        return { id: card.id, clientRef: c.clientRef };
      });
      return json({ batch: { id, cards } }, 201);
    }
    if (url.pathname === "/api/cards/batches") return json(this.batches);
    if (url.pathname === "/api/cards") {
      const status = url.searchParams.get("status");
      const batchId = url.searchParams.get("batchId");
      return json({ cards: this.cards.filter((c) => (!status || c.status === status) && (!batchId || c.batchId === batchId)) });
    }
    const m = /^\/api\/cards\/([^/]+)\/sent$/.exec(url.pathname);
    if (m && init.method === "POST") {
      const card = this.cards.find((c) => c.id === m[1]);
      if (!card) return json({ error: "NOT_FOUND" }, 404);
      this.sentReports.push({ id: card.id, body: body! });
      card.status = body!.failed ? "failed" : "sent";
      return json({ card });
    }
    return json({ error: "NOT_FOUND" }, 404);
  }) as unknown as typeof fetch;

  approve(clientRefs: string[], edits: Record<string, string> = {}) {
    for (const c of this.cards) {
      if (clientRefs.includes(String(c.clientRef))) {
        c.status = "approved";
        if (edits[String(c.clientRef)]) c.message = edits[String(c.clientRef)];
      }
    }
  }
}

const quiet = () => {};
let world: FakeWorld;
beforeEach(() => {
  world = new FakeWorld();
});

async function makeRun(opts: { mock?: boolean; history?: string } = {}): Promise<{ manifest: RunManifest; dir: string; historyFile: string }> {
  const { MockWriter } = await import("../src/writer/mock.js");
  const historyFile = opts.history ?? path.join(mkdtempSync(path.join(tmpdir(), "notes-ah-")), "history.json");
  const { run: manifest, dir } = await run.generate({
    campaign: "win-back",
    csv: path.join(__dirname, "..", "sample", "clients.csv"),
    staffFile: path.join(__dirname, "..", "sample", "staff.sample.json"),
    today: TODAY,
    historyFile,
    writer: new MockWriter(),
    log: quiet,
  });
  if (opts.mock === false) {
    // Pretend Claude wrote it, so the live Handwrytten path can be exercised.
    manifest.mock = false;
    writeFileSync(path.join(dir, "notes.json"), JSON.stringify(manifest));
  }
  return { manifest, dir, historyFile };
}

const api = () => new admin.CardsApi({ baseUrl: SITE, apiKey: "agent-key", fetchImpl: world.fetch });

describe("mapping notes to the contract card shape", () => {
  it("maps every field and only sends what exists", async () => {
    const { manifest } = await makeRun();
    const by = Object.fromEntries(manifest.notes.map((n) => [n.clientId, n]));
    const hk = admin.noteToCard(by.c027, manifest);
    expect(hk).toEqual({
      clientRef: "c027",
      name: "Ka Yan Chan",
      mailingAddress: { line1: "2938 Spuraway Avenue", city: "Coquitlam", province: "BC", postalCode: "V3C 2E3", country: "CA" },
      stylistName: "Anna",
      lastServiceName: "Root Touch-up Colour",
      cardDesign: "cf-thinking-of-you",
      message: by.c027.message,
      messageAlt: by.c027.messageAlt,
      altLanguage: "zh-HK",
      maxChars: 380,
      mock: true,
    });
    // CSV clients have no website customer id; English-only clients get no alt fields.
    const en = admin.noteToCard(by.c012, manifest);
    expect(en).not.toHaveProperty("customerId");
    expect(en).not.toHaveProperty("altLanguage");
    expect(en).not.toHaveProperty("messageAlt");
    expect(admin.noteToCard(by.c026, manifest).altLanguage).toBe("ko-KR");
    // API-sourced runs carry customerId; a client with no favourite stylist gets the team name.
    const fromApi = admin.noteToCard({ ...by.c012, stylistName: undefined }, { ...manifest, source: "api:http://site.test" });
    expect(fromApi.customerId).toBe("c012");
    expect(fromApi.stylistName).toBe(admin.NO_STYLIST);
  });

  it("keeps notes that need attention out of the batch", async () => {
    const { manifest } = await makeRun();
    manifest.notes[0] = { ...manifest.notes[0], status: "needs_attention", issues: [{ code: "too_long", message: "Message is 500 characters" }] };
    const { payload, skipped } = admin.runToBatch(manifest);
    expect(payload.cards).toHaveLength(manifest.notes.length - 1);
    expect(skipped[0].reason).toMatch(/needs attention/);
    expect(payload).toMatchObject({ campaignId: "win-back", campaignName: "We miss you", mock: true });
  });
});

describe("push", () => {
  it("uploads the batch with the agent key and remembers the card ids", async () => {
    const { manifest, dir } = await makeRun();
    const lines: string[] = [];
    const rec = await admin.pushRun(manifest, dir, api(), (m) => lines.push(m));
    expect(world.batches).toHaveLength(1);
    expect(world.cards).toHaveLength(manifest.notes.length);
    expect(world.keys.every((k) => k === "agent-key")).toBe(true);
    expect(rec.cards.every((c) => c.noteId.startsWith("win-back-c"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, "admin-batch.json"), "utf8")).batchId).toBe(rec.batchId);
    expect(lines.join("\n")).toContain(`${SITE}/admin/cards?batch=${rec.batchId}`);
  });
});

describe("send --from-admin", () => {
  it("dry run fetches approved cards and writes nothing anywhere", async () => {
    const { manifest, dir, historyFile } = await makeRun({ mock: false });
    await admin.pushRun(manifest, dir, api(), quiet);
    world.approve(["c012", "c027"]);
    const s = await admin.sendFromAdmin({ api: api(), provider: "handwrytten", send: false, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s.dryRun).toBe(true);
    expect(s.sent).toHaveLength(2);
    expect(world.handwrytten).toHaveLength(0);
    expect(world.sentReports).toHaveLength(0);
    expect(existsSync(historyFile)).toBe(false);
  });

  it("sends only approved cards, uses the owner's edits, and reports sent with cost", async () => {
    const { manifest, dir, historyFile } = await makeRun({ mock: false });
    const { batchId } = await admin.pushRun(manifest, dir, api(), quiet);
    const edited = "Hi Arash, I hope the perm is still easy on busy mornings. Your chair is here whenever you like. WELCOME15 is a small welcome-back gift.";
    world.approve(["c012", "c027"], { c012: edited });
    const s = await admin.sendFromAdmin({ api: api(), batchId, provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s.sent.sort()).toEqual(["win-back-c012", "win-back-c027"]);
    const placed = world.handwrytten.filter((h) => h.path.endsWith("placeBasket"));
    expect(placed).toHaveLength(2);
    expect(placed.map((p) => p.body!.message)).toContain(edited);
    // Local note identity is reused, so this ledger is shared with the offline flow.
    expect(placed.map((p) => p.body!.client_metadata).sort()).toEqual(["win-back:c012:lv-2026-07-20", "win-back:c027:lv-2026-08-03"]);
    expect(world.sentReports).toHaveLength(2);
    const r = world.sentReports[0].body;
    expect(r).toMatchObject({ provider: "handwrytten", providerOrderId: expect.stringMatching(/^order_id:5\d\d$/), costCAD: 7.74 });
    expect(Date.parse(String(r.sentAt))).not.toBeNaN();
    expect(world.cards.filter((c) => c.status === "sent")).toHaveLength(2);
    expect(world.cards.filter((c) => c.status === "pending")).toHaveLength(manifest.notes.length - 2);
    expect(new History(historyFile).records.filter((x) => x.status === "sent")).toHaveLength(2);
  });

  it("mails the owner's approved wording even without the name greeting or offer code", async () => {
    const { manifest, dir, historyFile } = await makeRun({ mock: false });
    const { batchId } = await admin.pushRun(manifest, dir, api(), quiet);
    const ownWords = "It has been a while and we would love to see you back at Henderson Place. Your chair is ready whenever you are.";
    world.approve(["c012"], { c012: ownWords });
    const s = await admin.sendFromAdmin({ api: api(), batchId, provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s.sent).toEqual(["win-back-c012"]);
    expect(s.skipped).toHaveLength(0);
    const placed = world.handwrytten.filter((h) => h.path.endsWith("placeBasket"));
    expect(placed.map((p) => p.body!.message)).toContain(ownWords);
  });

  it("still enforces hard limits on the owner's approved wording", async () => {
    const { manifest, dir, historyFile } = await makeRun({ mock: false });
    const { batchId } = await admin.pushRun(manifest, dir, api(), quiet);
    world.approve(["c012"], { c012: "Hi Arash, see you soon. ".repeat(40) });
    const s = await admin.sendFromAdmin({ api: api(), batchId, provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s.sent).toHaveLength(0);
    expect(s.skipped[0].reason).toMatch(/limit/);
  });

  it("never mails a card twice: already-sent cards are skipped and re-reported, not resent", async () => {
    const { manifest, dir, historyFile } = await makeRun({ mock: false });
    await admin.pushRun(manifest, dir, api(), quiet);
    world.approve(["c012"]);
    await admin.sendFromAdmin({ api: api(), provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    // Simulate a lost report-back: the admin still shows the card as approved.
    world.cards.find((c) => c.clientRef === "c012")!.status = "approved";
    world.handwrytten = [];
    world.sentReports = [];
    const s = await admin.sendFromAdmin({ api: api(), provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s.sent).toHaveLength(0);
    expect(s.skipped[0].reason).toMatch(/already sent on 2026-10-09/);
    expect(world.handwrytten.filter((h) => h.path.endsWith("placeBasket"))).toHaveLength(0);
    expect(world.sentReports).toHaveLength(1);
    expect(world.cards.find((c) => c.clientRef === "c012")!.status).toBe("sent");
  });

  it("skips a card already mailed through the offline approved-list flow", async () => {
    const { manifest, dir, historyFile } = await makeRun({ mock: false });
    const n = manifest.notes.find((x) => x.clientId === "c013")!;
    const approvedFile = path.join(dir, "approved.json");
    writeFileSync(approvedFile, JSON.stringify({ runId: manifest.runId, campaignId: "win-back", exportedAt: "", approved: [{ noteId: n.noteId, idempotencyKey: n.idempotencyKey, message: n.message, signature: n.signature }] }));
    await run.sendApproved({ approvedFile, provider: "handwrytten", send: true, historyFile, today: TODAY, log: quiet, fetchImpl: world.fetch });
    await admin.pushRun(manifest, dir, api(), quiet);
    world.approve(["c013"]);
    world.handwrytten = [];
    const s = await admin.sendFromAdmin({ api: api(), provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s.sent).toHaveLength(0);
    expect(world.handwrytten.filter((h) => h.path.endsWith("placeBasket"))).toHaveLength(0);
  });

  it("reports provider failures as failed, and a later retry can succeed", async () => {
    const { manifest, dir, historyFile } = await makeRun({ mock: false });
    await admin.pushRun(manifest, dir, api(), quiet);
    world.approve(["c015"]);
    world.failPlaceFor.add("Maria");
    const s1 = await admin.sendFromAdmin({ api: api(), provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s1.failed).toHaveLength(1);
    expect(world.sentReports[0].body).toMatchObject({ failed: true, provider: "handwrytten", error: expect.stringMatching(/address rejected/) });
    // The owner re-approves after fixing it; the ledger allows a retry of a failed send.
    world.cards.find((c) => c.clientRef === "c015")!.status = "approved";
    world.failPlaceFor.clear();
    const s2 = await admin.sendFromAdmin({ api: api(), provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s2.sent).toEqual(["win-back-c015"]);
  });

  it("works without the local run (another computer): campaign from the batch, key from the card id", async () => {
    const { manifest, dir, historyFile } = await makeRun({ mock: false });
    await admin.pushRun(manifest, dir, api(), quiet);
    world.approve(["c014"]);
    for (const c of world.cards) delete (c as Record<string, unknown>).campaignId; // force the batches lookup
    const elsewhere = mkdtempSync(path.join(tmpdir(), "notes-elsewhere-"));
    const s = await admin.sendFromAdmin({ api: api(), provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet, outDir: elsewhere });
    expect(s.sent).toHaveLength(1);
    const card = world.cards.find((c) => c.clientRef === "c014")!;
    const placed = world.handwrytten.find((h) => h.path.endsWith("placeBasket"))!;
    expect(placed.body!.client_metadata).toBe(`win-back:c014:card-${card.id}`);
    expect(placed.body!.wishes).toBe("Warmly,\nJason\nCF Hair Salon");
  });

  it("never mails mock copy through a real provider", async () => {
    const { manifest, dir, historyFile } = await makeRun(); // mock
    await admin.pushRun(manifest, dir, api(), quiet);
    world.approve(["c012"]);
    const s = await admin.sendFromAdmin({ api: api(), provider: "handwrytten", send: true, historyFile, today: TODAY, fetchImpl: world.fetch, log: quiet });
    expect(s.sent).toHaveLength(0);
    expect(s.skipped[0].reason).toMatch(/mock copy is never mailed/);
    expect(world.handwrytten.filter((h) => h.path.endsWith("placeBasket"))).toHaveLength(0);
  });
});
