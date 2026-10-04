/** The four pipeline steps (plan, generate, proof, send), shared by the CLI and the demo. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { selectAudience, type Selection } from "./audience.js";
import { loadCampaign } from "./campaigns.js";
import { effectiveLimitsFor } from "./limits.js";
import { deliver, type Candidate, type SendSummary } from "./deliver.js";
import { DEFAULT_HISTORY, loadSettings, OUT_DIR, providerSettings } from "./config.js";
import { loadData, type SourceOptions } from "./data/index.js";
import { toCsv } from "./data/csv.js";
import { History } from "./history.js";
import { buildFonts } from "./proof/fonts.js";
import { renderProof } from "./proof/html.js";
import { createProvider } from "./providers/index.js";
import type { ApprovedFile, Campaign, IsoDate, RunManifest } from "./types.js";
import { ClaudeWriter } from "./writer/claude.js";
import { generateNotes } from "./writer/generate.js";
import { MockWriter } from "./writer/mock.js";
import type { NoteWriter } from "./writer/types.js";

export type Log = (m: string) => void;

export interface CommonOptions extends SourceOptions {
  campaign: string;
  today: IsoDate;
  provider?: string;
  historyFile?: string;
  log?: Log;
}

export const effectiveLimits = effectiveLimitsFor;

export function claudeCostEstimateUSD(n: number, batch: boolean): number {
  const c = loadSettings().claude;
  const t = c.estimateTokensPerNote;
  const p = c.pricePerMTokUSD;
  // One cache write for the shared system prompt, cache reads after that.
  const perNote = (t.systemCached * p.cacheRead + t.user * p.input + t.output * p.output) / 1e6;
  const total = n === 0 ? 0 : (t.systemCached * p.cacheWrite5m) / 1e6 + perNote * n;
  return batch ? total / 2 : total;
}

export interface PlanResult {
  campaign: Campaign;
  selection: Selection;
  provider: string;
  costPerCardCAD: number;
  claudeUSD: number;
  source: string;
}

export async function plan(opts: CommonOptions): Promise<PlanResult> {
  const campaign = loadCampaign(opts.campaign);
  const provider = opts.provider ?? loadSettings().defaultProvider;
  const { clients, source } = await loadData(opts);
  const history = new History(opts.historyFile ?? DEFAULT_HISTORY);
  const selection = selectAudience(campaign, clients, { today: opts.today, history, cooldownDays: loadSettings().cooldownDays });
  const adapter = createProvider(provider, { outDir: OUT_DIR });
  const n = selection.matches.length;
  return {
    campaign,
    selection,
    provider,
    costPerCardCAD: adapter.costPerCardCAD(),
    claudeUSD: claudeCostEstimateUSD(n, n >= loadSettings().claude.batchThreshold),
    source,
  };
}

export function printPlan(p: PlanResult, log: Log = console.log): void {
  const { campaign, selection } = p;
  const n = selection.matches.length;
  log(`\n${campaign.name}  [${campaign.id}]`);
  log(`${campaign.description}`);
  log(`Data: ${p.source}`);
  log(`\nAudience: ${n} client(s) will get a card`);
  for (const m of selection.matches) {
    const c = m.client;
    log(
      `  + ${`${c.firstName} ${c.lastName}`.padEnd(22)} ${(c.favouriteStaffName ?? "-").padEnd(8)} ${(c.lastServiceName ?? "-").padEnd(26)} ${(c.preferredLanguage === "en-US" ? "" : c.preferredLanguage).padEnd(5)} ${m.reasons.join(", ")}`,
    );
  }
  if (selection.excluded.length) {
    log(`\nMatched but not mailed: ${selection.excluded.length}`);
    for (const e of selection.excluded) log(`  - ${`${e.client.firstName} ${e.client.lastName}`.padEnd(22)} ${e.reason}`);
  }
  const fx = loadSettings().fxUsdToCad;
  const mail = p.costPerCardCAD * n;
  const ai = p.claudeUSD * fx;
  log(`\nCost estimate (${providerSettings(p.provider).label})`);
  log(`  Cards and postage: ${n} x CAD ${p.costPerCardCAD.toFixed(2)} = CAD ${mail.toFixed(2)}`);
  log(`  Claude writing:    about CAD ${ai.toFixed(2)}${n >= loadSettings().claude.batchThreshold ? " (Batches API, 50% off)" : ""}`);
  log(`  Total:             about CAD ${(mail + ai).toFixed(2)}`);
  if (p.provider === "handwrytten") {
    const plotter = createProvider("plotter", { outDir: OUT_DIR }).costPerCardCAD();
    log(`  (In-house plotter instead: about CAD ${(plotter * n).toFixed(2)} including front-desk time)`);
  }
}

export function chooseWriter(opts: { mock?: boolean } = {}): NoteWriter {
  if (opts.mock || !process.env.ANTHROPIC_API_KEY) return new MockWriter();
  return new ClaudeWriter();
}

export function runDirFor(campaignId: string, today: IsoDate): string {
  return path.join(OUT_DIR, `${campaignId}-${today}`);
}

export interface GenerateResult {
  run: RunManifest;
  dir: string;
}

export async function generate(opts: CommonOptions & { writer?: NoteWriter; mock?: boolean }): Promise<GenerateResult> {
  const log = opts.log ?? console.log;
  const p = await plan(opts);
  const writer = opts.writer ?? chooseWriter({ mock: opts.mock });
  if (writer.mock) log("ANTHROPIC_API_KEY not set (or --mock): using deterministic MOCK templates, clearly labelled as such.");
  const limits = effectiveLimits(p.campaign, p.provider);
  const notes = await generateNotes(p.campaign, p.selection.matches, {
    writer,
    today: opts.today,
    ...limits,
    maxAttempts: loadSettings().claude.maxAttempts,
    log,
  });
  const runId = `${p.campaign.id}-${opts.today}`;
  const dir = runDirFor(p.campaign.id, opts.today);
  mkdirSync(dir, { recursive: true });
  const run: RunManifest = {
    runId,
    campaignId: p.campaign.id,
    campaignName: p.campaign.name,
    design: p.campaign.design,
    occasion: p.campaign.occasion,
    today: opts.today,
    generatedAt: new Date().toISOString(),
    writer: writer.name,
    mock: writer.mock,
    providerForLimits: p.provider,
    source: p.source,
    offer: p.campaign.offer ?? null,
    notes,
    usage: writer.mock ? undefined : { ...writer.usage },
  };
  writeFileSync(path.join(dir, "notes.json"), JSON.stringify(run, null, 2) + "\n");
  writeFileSync(path.join(dir, "notes.csv"), notesCsv(run));
  const bad = notes.filter((n) => n.status !== "ok").length;
  log(`Wrote ${notes.length} note(s) to ${path.relative(process.cwd(), dir)}/notes.json and notes.csv${bad ? ` (${bad} need attention)` : ""}`);
  if (run.usage) {
    const u = run.usage;
    log(`Claude usage: ${u.inputTokens} input, ${u.outputTokens} output, ${u.cacheReadTokens} cache-read, ${u.cacheWriteTokens} cache-write tokens${u.batchId ? ` (batch ${u.batchId})` : ""}`);
  }
  return { run, dir };
}

export function notesCsv(run: RunManifest): string {
  const header = [
    "note_id", "client_id", "first_name", "last_name", "address_line1", "address_line2", "city", "province", "postal_code",
    "language", "stylist", "last_service", "visit_count", "reasons", "message", "second_script", "message_alt", "signature",
    "chars", "max_chars", "status", "issues", "writer", "idempotency_key",
  ];
  const rows = run.notes.map((n) => [
    n.noteId, n.clientId, n.recipient.firstName, n.recipient.lastName, n.recipient.address?.line1, n.recipient.address?.line2,
    n.recipient.address?.city, n.recipient.address?.province, n.recipient.address?.postalCode, n.preferredLanguage,
    n.stylistName, n.lastServiceName, n.visitCount, n.reasons.join("; "), n.message, n.altScript, n.messageAlt, n.signature,
    n.charCount, n.maxChars, n.status, n.issues.map((i) => i.message).join(" | "), n.writer, n.idempotencyKey,
  ]);
  return toCsv(header, rows);
}

export function loadRun(dirOrRunId: string): { run: RunManifest; dir: string } {
  const dir = existsSync(path.join(dirOrRunId, "notes.json")) ? dirOrRunId : path.join(OUT_DIR, dirOrRunId);
  const file = path.join(dir, "notes.json");
  if (!existsSync(file)) throw new Error(`No notes.json in ${dir}. Run generate first.`);
  return { run: JSON.parse(readFileSync(file, "utf8")) as RunManifest, dir };
}

export async function proof(dirOrRunId: string, opts: { provider?: string; log?: Log } = {}): Promise<string> {
  const log = opts.log ?? console.log;
  const { run, dir } = loadRun(dirOrRunId);
  const provider = opts.provider ?? run.providerForLimits ?? loadSettings().defaultProvider;
  const adapter = createProvider(provider, { outDir: OUT_DIR });
  const fonts = await buildFonts(run.notes.map((n) => n.messageAlt ?? "").join(""));
  if (fonts.fallbackLink) log("Note: could not embed Chinese and Korean font subsets (offline?); the proof will load them from Google Fonts when opened.");
  const html = renderProof(run, { provider, costPerCardCAD: adapter.costPerCardCAD(), fonts });
  const file = path.join(dir, "proof.html");
  writeFileSync(file, html);
  log(`Proof sheet: ${path.relative(process.cwd(), file)}  (open it, approve or skip each card, then "Export approved list")`);
  return file;
}

export interface SendOptions {
  approvedFile: string;
  provider?: string;
  send: boolean;
  testMode?: boolean;
  historyFile?: string;
  today: IsoDate;
  runDir?: string;
  log?: Log;
  fetchImpl?: typeof fetch;
}

export type { SendSummary };

/**
 * Sends ONLY what is in the approved file, re-validating every card. Dry run unless
 * `send` is true. Idempotent: a key already sent (or mid-submission) is skipped.
 */
export async function sendApproved(opts: SendOptions): Promise<SendSummary> {
  const log = opts.log ?? console.log;
  const approved = JSON.parse(readFileSync(opts.approvedFile, "utf8")) as ApprovedFile;
  if (!approved.runId || !Array.isArray(approved.approved)) throw new Error("Not an approved-list file (missing runId/approved).");
  const { run } = loadRun(opts.runDir ?? approved.runId);
  const campaign = loadCampaign(run.campaignId);
  const provider = opts.provider ?? loadSettings().defaultProvider;
  // Mock copy never goes to a mailing provider. Plotter output stays on this computer,
  // so it is allowed for demos, with a warning file next to the SVGs.
  if (run.mock && opts.send && !opts.testMode && provider !== "plotter") {
    throw new Error("Refusing to mail MOCK copy. Re-run generate with ANTHROPIC_API_KEY set, review the proof, and export a new approved list.");
  }
  const byId = new Map(run.notes.map((n) => [n.noteId, n]));
  const early: SendSummary["skipped"] = [];
  const cands: Candidate[] = [];
  for (const a of approved.approved) {
    const note = byId.get(a.noteId);
    if (!note) {
      early.push({ noteId: a.noteId, reason: "not in this run" });
      continue;
    }
    if (a.idempotencyKey !== note.idempotencyKey) {
      early.push({ noteId: a.noteId, reason: "idempotency key mismatch (approved list from a different run?)" });
      continue;
    }
    // Tolerate approved lists exported before the field was renamed.
    const messageAlt = a.messageAlt ?? (a as { messageZh?: string }).messageZh;
    cands.push({ note, campaign, runId: run.runId, message: a.message, messageAlt, signature: a.signature, mock: run.mock });
  }
  for (const e of early) log(`  skipped ${e.noteId}: ${e.reason}`);
  const summary = await deliver(cands, {
    provider,
    send: opts.send,
    testMode: opts.testMode,
    historyFile: opts.historyFile,
    today: opts.today,
    outDir: path.join(OUT_DIR, "plotter", `${run.runId}-${provider}`),
    label: `${approved.approved.length} approved card(s) from ${run.runId}${approved.approvedBy ? `, reviewed by ${approved.approvedBy}` : ""}`,
    log,
    fetchImpl: opts.fetchImpl,
  });
  summary.skipped.unshift(...early);
  return summary;
}
