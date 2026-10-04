/**
 * Client for the website's handwritten-card approval queue
 * (docs/ARCHITECTURE.md, "Handwritten cards (approval queue)").
 *
 *   push              POST /api/cards/batches          upload a generated run for review
 *   send --from-admin GET  /api/cards?status=approved  fetch what the owner approved
 *                     POST /api/cards/{id}/sent        report sent (with cost) or failed
 *
 * All calls use the agent key (x-api-key: $AGENT_API_KEY). The local history ledger
 * stays the guarantee against double mailing; the admin status is kept in step with it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCampaign, renderSignature } from "./campaigns.js";
import { loadSettings, OUT_DIR } from "./config.js";
import { deliver, type Candidate, type Log, type SendSummary } from "./deliver.js";
import { altLimit, altScriptFor, normaliseLanguage } from "./language.js";
import type { Campaign, IsoDate, LanguageCode, MailingAddress, Note, RunManifest } from "./types.js";

/** Card shape from the contract. */
export interface CardPayload {
  clientRef: string;
  customerId?: string;
  name: string;
  mailingAddress: MailingAddress;
  stylistName: string;
  lastServiceName?: string;
  cardDesign: string;
  message: string;
  messageAlt?: string;
  altLanguage?: "zh-CN" | "zh-HK" | "ko-KR";
  maxChars: number;
  mock: boolean;
}

export interface BatchPayload {
  campaignId: string;
  campaignName: string;
  occasion: string;
  generatedAt: string;
  mock: boolean;
  cards: CardPayload[];
}

/** A card as the admin API returns it: the payload plus server fields. */
export interface AdminCard extends CardPayload {
  id: string;
  batchId?: string;
  status: string;
  campaignId?: string;
}

/** stylistName is required by the contract; this marks "no named stylist". */
export const NO_STYLIST = "CF Hair team";

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export function noteToCard(note: Note, run: Pick<RunManifest, "design" | "mock" | "source">): CardPayload {
  if (!note.recipient.address) throw new Error(`${note.noteId} has no mailing address`);
  const a = note.recipient.address;
  const card: CardPayload = {
    clientRef: note.clientId,
    name: `${note.recipient.firstName} ${note.recipient.lastName}`.trim(),
    mailingAddress: {
      line1: a.line1,
      ...(a.line2 ? { line2: a.line2 } : {}),
      city: a.city,
      province: a.province,
      postalCode: a.postalCode,
      country: a.country || "CA",
    },
    stylistName: note.stylistName ?? NO_STYLIST,
    cardDesign: run.design,
    message: note.message,
    maxChars: note.maxChars,
    mock: run.mock,
  };
  // Only clients loaded from the booking API have a website customer id.
  if (run.source?.startsWith("api:")) card.customerId = note.clientId;
  if (note.lastServiceName) card.lastServiceName = note.lastServiceName;
  if (note.altScript && note.messageAlt && note.preferredLanguage !== "en-US") {
    card.messageAlt = note.messageAlt;
    card.altLanguage = note.preferredLanguage as CardPayload["altLanguage"];
  }
  return card;
}

/** Build the batch body. Notes that failed checks or have no address stay local. */
export function runToBatch(run: RunManifest): { payload: BatchPayload; skipped: Array<{ noteId: string; reason: string }>; noteIdByClientRef: Map<string, string> } {
  const skipped: Array<{ noteId: string; reason: string }> = [];
  const cards: CardPayload[] = [];
  const noteIdByClientRef = new Map<string, string>();
  for (const n of run.notes) {
    if (n.status !== "ok") {
      skipped.push({ noteId: n.noteId, reason: `needs attention: ${n.issues.map((i) => i.message).join("; ")}` });
      continue;
    }
    if (!n.recipient.address) {
      skipped.push({ noteId: n.noteId, reason: "no mailing address" });
      continue;
    }
    const card = noteToCard(n, run);
    cards.push(card);
    noteIdByClientRef.set(card.clientRef, n.noteId);
  }
  return {
    payload: { campaignId: run.campaignId, campaignName: run.campaignName, occasion: run.occasion, generatedAt: run.generatedAt, mock: run.mock, cards },
    skipped,
    noteIdByClientRef,
  };
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export class CardsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface CardsApiOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class CardsApi {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: CardsApiOptions) {
    this.baseUrl = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  static fromEnv(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): CardsApi {
    const baseUrl = opts.baseUrl ?? process.env.BOOKING_API_URL;
    const apiKey = process.env.AGENT_API_KEY;
    if (!baseUrl || !apiKey) throw new Error("Set BOOKING_API_URL and AGENT_API_KEY to use the website's card approval queue.");
    return new CardsApi({ baseUrl, apiKey, fetchImpl: opts.fetchImpl });
  }

  /** Where the owner reviews cards. */
  adminUrl(batchId?: string): string {
    const u = new URL("admin/cards", this.baseUrl);
    if (batchId) u.searchParams.set("batch", batchId);
    return u.toString();
  }

  private async request<T>(method: "GET" | "POST", pathAndQuery: string, body?: unknown): Promise<T> {
    const url = new URL(pathAndQuery.replace(/^\//, ""), this.baseUrl);
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        accept: "application/json",
        "x-api-key": this.apiKey,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const o = (parsed ?? {}) as { error?: string; message?: string };
      throw new CardsApiError(`${method} ${url.pathname} failed (${res.status}): ${o.message ?? o.error ?? String(text).slice(0, 200)}`, res.status, parsed);
    }
    return parsed as T;
  }

  async createBatch(payload: BatchPayload): Promise<{ id: string; cards: Array<{ id: string; clientRef: string }> }> {
    const res = await this.request<{ batch?: { id: string | number; cards?: Array<{ id: string | number; clientRef: string }> } }>("POST", "api/cards/batches", payload);
    if (!res?.batch?.id) throw new CardsApiError("POST /api/cards/batches returned no batch id", undefined, res);
    return { id: String(res.batch.id), cards: (res.batch.cards ?? []).map((c) => ({ id: String(c.id), clientRef: String(c.clientRef) })) };
  }

  async listCards(filter: { status?: string; batchId?: string } = {}): Promise<AdminCard[]> {
    const q = new URLSearchParams();
    if (filter.batchId) q.set("batchId", filter.batchId);
    if (filter.status) q.set("status", filter.status);
    const res = await this.request<unknown>("GET", `api/cards${q.size ? `?${q}` : ""}`);
    const list = Array.isArray(res) ? res : ((res as { cards?: unknown[] })?.cards ?? []);
    return (list as Array<Record<string, unknown>>).map((c) => ({ ...(c as unknown as AdminCard), id: String(c.id), batchId: c.batchId != null ? String(c.batchId) : undefined }));
  }

  async listBatches(): Promise<Array<{ id: string; campaignId?: string; campaignName?: string }>> {
    const res = await this.request<unknown>("GET", "api/cards/batches");
    const list = Array.isArray(res) ? res : ((res as { batches?: unknown[] })?.batches ?? []);
    return (list as Array<Record<string, unknown>>).map((b) => ({ ...b, id: String(b.id), campaignId: b.campaignId as string | undefined }));
  }

  markSent(cardId: string, body: { provider: string; providerOrderId?: string; sentAt: string; costCAD?: number }): Promise<unknown> {
    const { providerOrderId, ...rest } = body;
    // The website keeps order ids up to 120 characters.
    return this.request("POST", `api/cards/${encodeURIComponent(cardId)}/sent`, providerOrderId ? { ...rest, providerOrderId: providerOrderId.slice(0, 120) } : rest);
  }

  markFailed(cardId: string, error: string, provider?: string): Promise<unknown> {
    return this.request("POST", `api/cards/${encodeURIComponent(cardId)}/sent`, { failed: true, error: (error.trim() || "send failed").slice(0, 1000), ...(provider ? { provider } : {}) });
  }
}

/** Is the website up? Used by the demo to decide whether to try the admin step. */
export async function websiteReachable(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(new URL("api/services", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`), { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

export interface PushRecord {
  batchId: string;
  baseUrl: string;
  pushedAt: string;
  cards: Array<{ cardId: string; clientRef: string; noteId: string }>;
}

export const PUSH_FILE = "admin-batch.json";

export async function pushRun(run: RunManifest, dir: string, api: CardsApi, log: Log = console.log): Promise<PushRecord> {
  const { payload, skipped, noteIdByClientRef } = runToBatch(run);
  for (const s of skipped) log(`  not pushed ${s.noteId}: ${s.reason}`);
  if (!payload.cards.length) throw new Error("Nothing to push: no card in this run passed every check.");
  const batch = await api.createBatch(payload);
  const record: PushRecord = {
    batchId: batch.id,
    baseUrl: api.baseUrl,
    pushedAt: new Date().toISOString(),
    cards: batch.cards.map((c) => ({ cardId: c.id, clientRef: c.clientRef, noteId: noteIdByClientRef.get(c.clientRef) ?? "" })),
  };
  writeFileSync(path.join(dir, PUSH_FILE), JSON.stringify(record, null, 2) + "\n");
  log(`Pushed ${payload.cards.length} card(s) for review${run.mock ? " (marked mock)" : ""}. Batch ${batch.id}`);
  log(`Review and approve them at ${api.adminUrl(batch.id)}`);
  return record;
}

// ---------------------------------------------------------------------------
// send --from-admin
// ---------------------------------------------------------------------------

interface LocalRef {
  run: RunManifest;
  note?: Note;
}

/** Index every pushed run under out/ so admin cards can be matched to their local notes. */
export function localPushIndex(outDir = OUT_DIR): { byCardId: Map<string, LocalRef>; runByBatch: Map<string, RunManifest> } {
  const byCardId = new Map<string, LocalRef>();
  const runByBatch = new Map<string, RunManifest>();
  if (!existsSync(outDir)) return { byCardId, runByBatch };
  for (const d of readdirSync(outDir)) {
    const pushFile = path.join(outDir, d, PUSH_FILE);
    const notesFile = path.join(outDir, d, "notes.json");
    if (!existsSync(pushFile) || !existsSync(notesFile)) continue;
    try {
      const rec = JSON.parse(readFileSync(pushFile, "utf8")) as PushRecord;
      const run = JSON.parse(readFileSync(notesFile, "utf8")) as RunManifest;
      runByBatch.set(rec.batchId, run);
      const notes = new Map(run.notes.map((n) => [n.noteId, n]));
      for (const c of rec.cards) byCardId.set(c.cardId, { run, note: notes.get(c.noteId) });
    } catch {
      /* ignore unreadable runs */
    }
  }
  return { byCardId, runByBatch };
}

function splitName(name: string): { firstName: string; lastName: string } {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

/** Turn an approved admin card into a send candidate, reusing the local note when we have it. */
export function cardToCandidate(card: AdminCard, campaign: Campaign, local: LocalRef | undefined): Candidate {
  const lang: LanguageCode = card.altLanguage ? normaliseLanguage(card.altLanguage) : (local?.note?.preferredLanguage ?? "en-US");
  const altScript = altScriptFor(lang);
  const stylist = card.stylistName && card.stylistName !== NO_STYLIST ? card.stylistName : undefined;
  const base = local?.note;
  const note: Note = base
    ? { ...base, recipient: { ...splitName(card.name), address: card.mailingAddress ?? base.recipient.address } }
    : {
        noteId: `card-${card.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
        idempotencyKey: `${campaign.id}:${card.customerId ?? card.clientRef}:card-${card.id}`,
        campaignId: campaign.id,
        clientId: card.customerId ?? card.clientRef,
        recipient: { ...splitName(card.name), address: card.mailingAddress },
        preferredLanguage: lang,
        altScript,
        stylistName: stylist,
        lastServiceName: card.lastServiceName,
        visitCount: 0,
        reasons: [],
        message: card.message,
        messageAlt: card.messageAlt,
        signature: renderSignature(campaign, stylist),
        charCount: 0,
        maxChars: card.maxChars,
        maxCharsAlt: altLimit(campaign.maxCharsAlt, altScript),
        issues: [],
        status: "ok",
        writer: card.mock ? "mock" : "admin",
        attempts: 0,
      };
  const signature = base && (base.stylistName ?? undefined) === stylist ? base.signature : renderSignature(campaign, stylist);
  return {
    note,
    campaign,
    runId: local?.run.runId ?? `admin-${card.batchId ?? "unknown"}`,
    // The owner may have edited the text in the admin; the admin copy wins.
    message: card.message,
    messageAlt: card.messageAlt || undefined,
    signature,
    // Mock if either side says so: mock copy is never mailed.
    mock: card.mock === true || local?.run.mock === true,
  };
}

export interface SendFromAdminOptions {
  api: CardsApi;
  batchId?: string;
  provider?: string;
  send: boolean;
  testMode?: boolean;
  historyFile?: string;
  today: IsoDate;
  outDir?: string;
  log?: Log;
  fetchImpl?: typeof fetch;
}

export async function sendFromAdmin(opts: SendFromAdminOptions): Promise<SendSummary> {
  const log = opts.log ?? console.log;
  const provider = opts.provider ?? loadSettings().defaultProvider;
  const cards = await opts.api.listCards({ status: "approved", batchId: opts.batchId });
  log(`Fetched ${cards.length} approved card(s) from ${opts.api.adminUrl(opts.batchId)}`);
  const { byCardId, runByBatch } = localPushIndex(opts.outDir ?? OUT_DIR);

  let batches: Awaited<ReturnType<CardsApi["listBatches"]>> | undefined;
  const campaignIdFor = async (card: AdminCard): Promise<string | undefined> => {
    const local = byCardId.get(card.id)?.run ?? (card.batchId ? runByBatch.get(card.batchId) : undefined);
    if (local) return local.campaignId;
    if (card.campaignId) return card.campaignId;
    if (!card.batchId) return undefined;
    batches ??= await opts.api.listBatches().catch(() => []);
    return batches.find((b) => b.id === card.batchId)?.campaignId;
  };

  const early: SendSummary["skipped"] = [];
  const cands: Candidate[] = [];
  for (const card of cards) {
    const campaignId = await campaignIdFor(card);
    let campaign: Campaign | undefined;
    try {
      campaign = campaignId ? loadCampaign(campaignId) : undefined;
    } catch {
      campaign = undefined;
    }
    if (!campaign) {
      early.push({ noteId: `card-${card.id}`, reason: `unknown campaign${campaignId ? ` "${campaignId}"` : ""}; add campaigns/${campaignId ?? "<id>"}.json` });
      continue;
    }
    const local = byCardId.get(card.id) ?? (card.batchId && runByBatch.get(card.batchId) ? { run: runByBatch.get(card.batchId)! } : undefined);
    const cand = cardToCandidate(card, campaign, local);
    cand.onSent = async (res, costCAD) => {
      await opts.api.markSent(card.id, { provider, providerOrderId: res.providerRef, sentAt: new Date().toISOString(), costCAD });
    };
    cand.onFailed = async (error) => {
      await opts.api.markFailed(card.id, error, provider);
    };
    // Mailed earlier but the report-back was lost: bring the admin up to date, never resend.
    cand.onAlreadySent = async (rec) => {
      await opts.api.markSent(card.id, { provider: rec.provider, providerOrderId: rec.providerRef, sentAt: rec.updatedAt });
      log(`  re-reported ${cand.note.noteId} as sent (it was mailed on ${rec.sentOn})`);
    };
    cands.push(cand);
  }
  for (const e of early) log(`  skipped ${e.noteId}: ${e.reason}`);
  const summary = await deliver(cands, {
    provider,
    send: opts.send,
    testMode: opts.testMode,
    historyFile: opts.historyFile,
    today: opts.today,
    outDir: path.join(opts.outDir ?? OUT_DIR, "plotter", `admin-${opts.batchId ?? "all"}-${opts.today}-${provider}`),
    label: `${cards.length} approved card(s) from the admin queue${opts.batchId ? ` (batch ${opts.batchId})` : ""}`,
    log,
    fetchImpl: opts.fetchImpl,
  });
  summary.skipped.unshift(...early);
  if (opts.send && !opts.testMode) log(`Results reported to ${opts.api.adminUrl(opts.batchId)}`);
  return summary;
}
