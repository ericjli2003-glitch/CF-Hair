/**
 * The one send loop, shared by the offline approved-list flow (`send --approved`) and
 * the admin queue flow (`send --from-admin`).
 *
 * For every candidate card: re-validate the (possibly owner-edited) text, check the local
 * history ledger, then either preview it (dry run) or send it through the provider adapter,
 * recording "submitting" before the call and "sent" or "failed" after it. Callers get hooks
 * to report each outcome elsewhere (the website admin queue).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_HISTORY } from "./config.js";
import { History, withHistoryLock, type HistoryRecord } from "./history.js";
import { altLimit } from "./language.js";
import { createProvider } from "./providers/index.js";
import type { SendItem, SendResult } from "./providers/types.js";
import { charCount, sanitizeAlt, sanitizeForPen, validateNote } from "./text.js";
import type { Campaign, IsoDate, Note } from "./types.js";
import { forbiddenDetails } from "./writer/generate.js";
import { effectiveLimitsFor } from "./limits.js";

export type Log = (m: string) => void;

export interface Candidate {
  note: Note;
  campaign: Campaign;
  runId: string;
  message: string;
  messageAlt?: string;
  signature: string;
  mock: boolean;
  /** Called after a real (non-test) send succeeds. */
  onSent?: (res: SendResult, costCAD: number) => Promise<void>;
  /** Called after a real send fails. */
  onFailed?: (error: string) => Promise<void>;
  /** Called on a real run when the ledger says this card already went out. */
  onAlreadySent?: (rec: HistoryRecord) => Promise<void>;
}

export interface DeliverOptions {
  provider: string;
  send: boolean;
  testMode?: boolean;
  historyFile?: string;
  today: IsoDate;
  /** Where plotter SVGs go. */
  outDir: string;
  /** Header line, e.g. "8 approved card(s) from win-back-2026-10-09". */
  label: string;
  log?: Log;
  fetchImpl?: typeof fetch;
}

export interface SendSummary {
  sent: string[];
  skipped: Array<{ noteId: string; reason: string }>;
  failed: Array<{ noteId: string; error: string }>;
  dryRun: boolean;
}

/** Text and provider checks for one card. Returns the ready item or the problems. */
export function prepare(c: Candidate, provider: string, adapter: { validate(i: SendItem): string[] }): { item?: SendItem; problems: string[] } {
  const note = c.note;
  if (!note.recipient.address) return { problems: ["no address"] };
  const limits = effectiveLimitsFor(c.campaign, provider);
  const message = sanitizeForPen(c.message);
  const messageAlt = c.messageAlt && note.altScript ? sanitizeAlt(c.messageAlt, note.altScript) : undefined;
  const v = validateNote(message, messageAlt, {
    firstName: note.recipient.firstName,
    maxChars: limits.maxChars,
    maxCharsAlt: altLimit(limits.maxCharsAlt, note.altScript),
    maxSignatureChars: limits.maxSignatureChars,
    signature: c.signature,
    // The second-language lines are optional at send time (written by hand), but checked if present.
    altScript: messageAlt ? note.altScript : undefined,
    offerCode: c.campaign.offer?.code,
    forbidden: forbiddenDetails({
      client: { ...note.recipient, id: note.clientId, visitCount: note.visitCount, preferredLanguage: note.preferredLanguage, tags: [] },
      reasons: [],
      occasion: {},
      idempotencyKey: note.idempotencyKey,
    }),
  });
  const item: SendItem = { note, campaign: c.campaign, message, messageAlt, signature: c.signature, address: note.recipient.address };
  const problems = [...v.issues.map((i) => i.message), ...adapter.validate(item)];
  return problems.length ? { problems } : { item, problems };
}

export async function deliver(cands: Candidate[], opts: DeliverOptions): Promise<SendSummary> {
  const log = opts.log ?? console.log;
  const provider = opts.provider;
  const adapter = createProvider(provider, { outDir: opts.outDir, fetchImpl: opts.fetchImpl });
  const historyFile = opts.historyFile ?? DEFAULT_HISTORY;
  const summary: SendSummary = { sent: [], skipped: [], failed: [], dryRun: !opts.send };
  const live = opts.send && !opts.testMode;

  const mode = !opts.send ? "DRY RUN (nothing leaves this computer)" : opts.testMode ? "PROVIDER TEST MODE" : "LIVE SEND";
  log(`\n${mode}: ${opts.label} via ${provider}`);

  if (opts.send && provider === "plotter" && cands.some((c) => c.mock)) {
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(path.join(opts.outDir, "MOCK-COPY-DO-NOT-MAIL.txt"), "These SVGs contain mock template copy from a demo run. Do not plot and mail them.\n");
    log("Warning: plotting MOCK copy (demo only). A MOCK-COPY-DO-NOT-MAIL.txt marker sits next to the SVGs.");
  }

  const work = async () => {
    const history = new History(historyFile);
    const ready: Array<{ c: Candidate; item: SendItem }> = [];
    for (const c of cands) {
      const id = c.note.noteId;
      const prior = history.get(c.note.idempotencyKey);
      if (prior && (prior.status === "sent" || prior.status === "submitting")) {
        summary.skipped.push({
          noteId: id,
          reason:
            prior.status === "sent"
              ? `already sent on ${prior.sentOn} (${prior.provider} ${prior.providerRef ?? ""})`.trim()
              : "a previous send was interrupted; check the provider dashboard, then fix history",
        });
        if (live && prior.status === "sent" && c.onAlreadySent) await c.onAlreadySent(prior).catch((e) => log(`  warning: ${(e as Error).message}`));
        continue;
      }
      // Mock copy never goes to a mailing provider. Plotter output stays on this computer.
      if (c.mock && live && provider !== "plotter") {
        summary.skipped.push({ noteId: id, reason: "mock copy is never mailed; regenerate with ANTHROPIC_API_KEY set" });
        continue;
      }
      const { item, problems } = prepare(c, provider, adapter);
      if (!item) {
        summary.skipped.push({ noteId: id, reason: problems.join("; ") });
        continue;
      }
      ready.push({ c, item });
    }

    if (!opts.send) {
      ready.forEach(({ item }, i) => {
        log(`  would send ${item.note.noteId.padEnd(26)} ${`${item.note.recipient.firstName} ${item.note.recipient.lastName}`.padEnd(20)} ${charCount(item.message)} chars`);
        // Show the full request for the first card so the payload can be checked once.
        if (i === 0) log(`    payload: ${JSON.stringify(adapter.preview(item), null, 2).replace(/\n/g, "\n    ")}`);
        summary.sent.push(item.note.noteId);
      });
      return;
    }

    if (ready.length && adapter.preflight) await adapter.preflight({ testMode: !!opts.testMode });
    const cost = Math.round(adapter.costPerCardCAD() * 100) / 100;
    for (const { c, item } of ready) {
      const base = {
        idempotencyKey: item.note.idempotencyKey,
        campaignId: c.campaign.id,
        clientId: item.note.clientId,
        noteId: item.note.noteId,
        runId: c.runId,
        provider,
      };
      if (!opts.testMode) history.upsert({ ...base, status: "submitting" });
      let res: SendResult;
      try {
        res = await adapter.send(item, { testMode: !!opts.testMode });
      } catch (err) {
        const msg = (err as Error).message;
        // A failed request is safe to retry; only "submitting" (crash mid-call) blocks.
        if (!opts.testMode) history.upsert({ ...base, status: "failed", error: msg });
        summary.failed.push({ noteId: item.note.noteId, error: msg });
        log(`  FAILED ${item.note.noteId}: ${msg}`);
        if (!opts.testMode && c.onFailed) await c.onFailed(msg).catch((e) => log(`  warning: ${(e as Error).message}`));
        continue;
      }
      summary.sent.push(item.note.noteId);
      if (opts.testMode) {
        log(`  test ok ${item.note.noteId}: ${res.providerRef}`);
        continue;
      }
      history.upsert({ ...base, status: "sent", providerRef: res.providerRef, sentOn: opts.today });
      log(`  sent ${item.note.noteId}: ${res.providerRef}${res.detail ? ` (${res.detail})` : ""}`);
      // The card is mailed and in the ledger; a failed report-back is retried on the next run.
      if (c.onSent) await c.onSent(res, cost).catch((e) => log(`  warning: could not report ${item.note.noteId} as sent: ${(e as Error).message}`));
    }
  };

  if (opts.send) await withHistoryLock(historyFile, work);
  else await work();

  for (const s of summary.skipped) log(`  skipped ${s.noteId}: ${s.reason}`);
  log(
    `${opts.send ? (opts.testMode ? "Tested" : "Sent") : "Would send"} ${summary.sent.length}, skipped ${summary.skipped.length}, failed ${summary.failed.length}.${
      !opts.send ? " Add --send to mail them." : ""
    }`,
  );
  return summary;
}
