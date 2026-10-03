import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ApprovedFile, RunManifest } from "../src/types.js";

// OUT_DIR is read when config.ts loads, so point it at a temp dir before importing.
const OUT = mkdtempSync(path.join(tmpdir(), "notes-idem-"));
process.env.NOTES_OUT_DIR = OUT;
const TODAY = "2026-10-09";
let run: typeof import("../src/run.js");
let History: typeof import("../src/history.js").History;

beforeAll(async () => {
  run = await import("../src/run.js");
  History = (await import("../src/history.js")).History;
});

async function makeRun(): Promise<{ manifest: RunManifest; approvedFile: string; historyFile: string }> {
  const csv = path.join(__dirname, "..", "sample", "clients.csv");
  const staff = path.join(__dirname, "..", "sample", "staff.sample.json");
  const { MockWriter } = await import("../src/writer/mock.js");
  const historyFile = path.join(mkdtempSync(path.join(tmpdir(), "notes-hist-")), "history.json");
  const { run: manifest, dir } = await run.generate({
    campaign: "win-back",
    csv,
    staffFile: staff,
    today: TODAY,
    historyFile,
    writer: new MockWriter(),
    log: () => {},
  });
  const approved: ApprovedFile = {
    runId: manifest.runId,
    campaignId: manifest.campaignId,
    exportedAt: new Date().toISOString(),
    approved: manifest.notes.map((n) => ({ noteId: n.noteId, idempotencyKey: n.idempotencyKey, message: n.message, messageAlt: n.messageAlt, signature: n.signature })),
  };
  const approvedFile = path.join(dir, "approved.json");
  writeFileSync(approvedFile, JSON.stringify(approved));
  return { manifest, approvedFile, historyFile };
}

const quiet = () => {};

describe("send is gated, dry by default and idempotent", () => {
  it("dry run sends nothing and records nothing", async () => {
    const { approvedFile, historyFile, manifest } = await makeRun();
    const s = await run.sendApproved({ approvedFile, provider: "plotter", send: false, historyFile, today: TODAY, log: quiet });
    expect(s.dryRun).toBe(true);
    expect(s.sent).toHaveLength(manifest.notes.length);
    expect(existsSync(historyFile)).toBe(false);
    expect(existsSync(path.join(OUT, "plotter"))).toBe(false);
  });

  it("refuses to mail mock copy for real", async () => {
    const { approvedFile, historyFile } = await makeRun();
    await expect(
      run.sendApproved({ approvedFile, provider: "handwrytten", send: true, historyFile, today: TODAY, log: quiet, fetchImpl: (() => { throw new Error("must not be called"); }) as never }),
    ).rejects.toThrow(/MOCK/);
  });

  it("a second send of the same approved list mails nobody twice", async () => {
    const { approvedFile, historyFile, manifest } = await makeRun();
    // Plotter output is local, so mock copy may be "sent" there; it exercises the same ledger.
    const first = await run.sendApproved({ approvedFile, provider: "plotter", send: true, historyFile, today: TODAY, log: quiet });
    const total = manifest.notes.length;
    expect(total).toBe(8);
    expect(first.sent).toHaveLength(total);
    const second = await run.sendApproved({ approvedFile, provider: "plotter", send: true, historyFile, today: TODAY, log: quiet });
    expect(second.sent).toHaveLength(0);
    expect(second.skipped.every((s) => /already sent/.test(s.reason))).toBe(true);
    const h = new History(historyFile);
    expect(h.records.filter((r) => r.status === "sent")).toHaveLength(total);
    // And the next plan excludes them too.
    const p = await run.plan({ campaign: "win-back", csv: path.join(__dirname, "..", "sample", "clients.csv"), today: TODAY, historyFile });
    expect(p.selection.matches).toHaveLength(0);
    expect(p.selection.excluded.filter((e) => e.reason === "already sent this card")).toHaveLength(manifest.notes.length);
    const svgs = readdirSync(path.join(OUT, "plotter", `${manifest.runId}-plotter`)).filter((f) => f.endsWith(".svg"));
    expect(svgs).toHaveLength(total * 2);
    // Chinese and Korean lines are listed for a person to add by hand.
    const handFinish = readFileSync(path.join(OUT, "plotter", `${manifest.runId}-plotter`, "hand-finish.txt"), "utf8");
    expect(handFinish).toMatch(/Traditional Chinese lines/);
    expect(handFinish).toMatch(/Korean lines/);
    expect(existsSync(path.join(OUT, "plotter", `${manifest.runId}-plotter`, "MOCK-COPY-DO-NOT-MAIL.txt"))).toBe(true);
  });

  it("an interrupted send (status submitting) blocks a resend until a human checks", async () => {
    const { approvedFile, historyFile, manifest } = await makeRun();
    const n = manifest.notes[0];
    new History(historyFile).upsert({ idempotencyKey: n.idempotencyKey, campaignId: "win-back", clientId: n.clientId, noteId: n.noteId, runId: manifest.runId, provider: "handwrytten", status: "submitting" });
    const s = await run.sendApproved({ approvedFile, provider: "plotter", send: true, historyFile, today: TODAY, log: quiet });
    expect(s.sent).toHaveLength(manifest.notes.length - 1);
    expect(s.skipped[0].reason).toMatch(/interrupted/);
  });

  it("only approved cards are sent, and edited text is re-validated", async () => {
    const { approvedFile, historyFile } = await makeRun();
    const a = JSON.parse(readFileSync(approvedFile, "utf8")) as ApprovedFile;
    a.approved = a.approved.slice(0, 2);
    a.approved[1].message = `${a.approved[1].message} ${"and more ".repeat(60)}`;
    writeFileSync(approvedFile, JSON.stringify(a));
    const s = await run.sendApproved({ approvedFile, provider: "plotter", send: true, historyFile, today: TODAY, log: quiet });
    expect(s.sent).toEqual([a.approved[0].noteId]);
    expect(s.skipped[0].reason).toMatch(/limit is 380/);
  });

  it("Handwrytten adapter sends one basket per card with the idempotency key, and never resends", async () => {
    const { manifest, historyFile } = await makeRun();
    // Pretend Claude wrote these so the live path is exercised.
    const notesFile = path.join(OUT, manifest.runId, "notes.json");
    const m = JSON.parse(readFileSync(notesFile, "utf8")) as RunManifest;
    m.mock = false;
    writeFileSync(notesFile, JSON.stringify(m));
    const approved: ApprovedFile = {
      runId: m.runId,
      campaignId: m.campaignId,
      exportedAt: "",
      approved: m.notes.slice(0, 2).map((n) => ({ noteId: n.noteId, idempotencyKey: n.idempotencyKey, message: n.message, signature: n.signature })),
    };
    const approvedFile = path.join(OUT, "hw-approved.json");
    writeFileSync(approvedFile, JSON.stringify(approved));
    const calls: Array<{ url: string; headers: Record<string, string>; body?: Record<string, unknown> }> = [];
    let order = 100;
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const p = new URL(String(url)).pathname;
      const json = p.endsWith("basket/count") ? { count: 0 } : p.endsWith("basket/send") ? { status: "ok", order_id: order++ } : { status: "ok" };
      return new Response(JSON.stringify(json), { status: 200 });
    }) as unknown as typeof fetch;
    process.env.HANDWRYTTEN_API_KEY = "test-key";
    process.env.HANDWRYTTEN_CARD_ID = "3404";
    process.env.HANDWRYTTEN_FONT = "hwDavid";
    const first = await run.sendApproved({ approvedFile, provider: "handwrytten", send: true, historyFile, today: TODAY, log: quiet, fetchImpl });
    expect(first.sent).toHaveLength(2);
    const places = calls.filter((c) => c.url.endsWith("orders/placeBasket"));
    expect(places).toHaveLength(2);
    expect(places[0].headers.Authorization).toBe("test-key");
    expect(places[0].headers["Idempotency-Key"]).toBe(approved.approved[0].idempotencyKey);
    expect(places[0].body).toMatchObject({ card_id: 3404, font: "hwDavid", client_metadata: approved.approved[0].idempotencyKey });
    const addr = (places[0].body!.addresses as Array<Record<string, string>>)[0];
    expect(addr).toMatchObject({ to_country: "CA", to_state: "BC", from_city: "Coquitlam" });
    expect(new History(historyFile).get(approved.approved[0].idempotencyKey)?.providerRef).toBe("order_id:100");

    calls.length = 0;
    const second = await run.sendApproved({ approvedFile, provider: "handwrytten", send: true, historyFile, today: TODAY, log: quiet, fetchImpl });
    expect(second.sent).toHaveLength(0);
    expect(calls.filter((c) => c.url.endsWith("orders/placeBasket"))).toHaveLength(0);
  });

  it("a failed provider call is recorded as failed and can be retried", async () => {
    const { manifest, historyFile } = await makeRun();
    const notesFile = path.join(OUT, manifest.runId, "notes.json");
    const m = JSON.parse(readFileSync(notesFile, "utf8")) as RunManifest;
    m.mock = false;
    writeFileSync(notesFile, JSON.stringify(m));
    const n = m.notes[0];
    const approvedFile = path.join(OUT, "hw-fail.json");
    writeFileSync(approvedFile, JSON.stringify({ runId: m.runId, campaignId: m.campaignId, exportedAt: "", approved: [{ noteId: n.noteId, idempotencyKey: n.idempotencyKey, message: n.message, signature: n.signature }] }));
    let fail = true;
    const fetchImpl = (async (url: URL) => {
      const p = new URL(String(url)).pathname;
      if (p.endsWith("basket/count")) return new Response(JSON.stringify({ count: 0 }));
      if (fail && p.endsWith("placeBasket")) return new Response(JSON.stringify({ status: "error", message: "card not found" }), { status: 400 });
      return new Response(JSON.stringify({ status: "ok", order_id: 7 }));
    }) as unknown as typeof fetch;
    const s1 = await run.sendApproved({ approvedFile, provider: "handwrytten", send: true, historyFile, today: TODAY, log: quiet, fetchImpl });
    expect(s1.failed).toHaveLength(1);
    expect(new History(historyFile).get(n.idempotencyKey)?.status).toBe("failed");
    fail = false;
    const s2 = await run.sendApproved({ approvedFile, provider: "handwrytten", send: true, historyFile, today: TODAY, log: quiet, fetchImpl });
    expect(s2.sent).toHaveLength(1);
    expect(new History(historyFile).get(n.idempotencyKey)?.status).toBe("sent");
  });
});

mkdirSync(OUT, { recursive: true });
