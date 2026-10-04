import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import type { CallRecord } from "./agent/calllog.js";
import { ApiError, type BookingApi, type CallOutcome, type CallPayload, type TransferResult } from "./api/types.js";
import type { LanguageCode } from "./languages.js";
import { isAnonymousCaller, toE164 } from "./phone.js";

/**
 * Posts one record per call to the website's Calls tab (POST /api/calls, upsert by callSid).
 * Runs after the call has ended, off the call's critical path. If the website is unreachable the
 * record waits in data/pending-calls.json and is retried after the next call and on startup.
 */

// ---------------------------------------------------------------- payload

export interface CallFacts {
  record: CallRecord;
  language: LanguageCode;
  languageSource: CallPayload["languageSource"];
  timezone: string;
}

const OUTCOME_RANK: CallOutcome[] = ["booked", "rescheduled", "cancelled", "message", "transferred", "spam", "info", "abandoned"];

function mapOutcome(r: CallRecord): CallOutcome {
  if (r.outcome === "info-only") return r.endReason === "spam" ? "spam" : "info";
  return (r.outcome ?? "abandoned") as CallOutcome;
}

/** The contract payload, without the summary (filled in by the reporter). */
export function buildCallPayload(f: CallFacts): Omit<CallPayload, "summary"> {
  const r = f.record;
  const endedAt = r.endedAt ?? new Date().toISOString();
  const durationSec = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(r.startedAt)) / 1000));
  const lastWith = (o: string) => [...r.outcomes].reverse().find((x) => x.outcome === o && x.detail?.bookingId);
  const bookingOutcome = lastWith("booked") ?? lastWith("rescheduled") ?? lastWith("cancelled");
  const payload: Omit<CallPayload, "summary"> = {
    callSid: r.callSid,
    from: r.anonymous ? null : toE164(r.from),
    startedAt: r.startedAt,
    endedAt,
    durationSec,
    language: f.language,
    languageSource: f.languageSource,
    outcome: mapOutcome(r),
    transcript: r.transcript
      .filter((t) => t.role === "caller" || t.role === "agent")
      .map((t) => ({
        role: t.role as "caller" | "agent",
        text: t.text,
        ...(t.lang && t.lang !== "multi" ? { lang: t.lang } : {}),
        at: t.at,
      })),
  };
  if (bookingOutcome?.detail?.bookingId) payload.bookingId = String(bookingOutcome.detail.bookingId);
  if (r.messageId) payload.messageId = r.messageId;
  if (r.smsOptIn) payload.smsConsent = r.smsOptIn.accepted ? "yes" : "no"; // only when it was asked
  if (r.from && isAnonymousCaller(r.from)) payload.from = null;
  return payload;
}

/** Combine two sessions of the same call (for example the agent again after an unanswered transfer). */
export function mergeCalls(a: CallPayload, b: CallPayload): CallPayload {
  const outcome = OUTCOME_RANK.find((o) => o === a.outcome || o === b.outcome) ?? b.outcome;
  const startedAt = a.startedAt < b.startedAt ? a.startedAt : b.startedAt;
  const endedAt = a.endedAt > b.endedAt ? a.endedAt : b.endedAt;
  const seen = new Set(a.transcript.map((t) => `${t.at}|${t.role}|${t.text}`));
  return {
    ...a,
    ...b,
    startedAt,
    endedAt,
    durationSec: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)),
    outcome,
    bookingId: b.bookingId ?? a.bookingId,
    messageId: b.messageId ?? a.messageId,
    transferResult: b.transferResult ?? a.transferResult,
    smsConsent: b.smsConsent ?? a.smsConsent,
    transcript: [...a.transcript, ...b.transcript.filter((t) => !seen.has(`${t.at}|${t.role}|${t.text}`))],
  };
}

export function mapDialStatus(status: string | undefined): TransferResult {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "answered":
      return "answered";
    case "busy":
      return "busy";
    case "no-answer":
    case "canceled":
      return "no-answer";
    default:
      return "failed";
  }
}

// ---------------------------------------------------------------- summary

export interface Summarizer {
  summarize(call: Omit<CallPayload, "summary">, record?: CallRecord): Promise<string>;
}

const LANGUAGE_NAMES: Record<string, string> = { "en-US": "English", "zh-CN": "Mandarin", "zh-HK": "Cantonese", "ko-KR": "Korean" };

/** Plain-punctuation cleanup: no em or en dashes, no markdown, single line. */
export function cleanSummary(s: string): string {
  return s
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Owner-facing summary built from the outcome, used when Claude is unavailable. */
export function templateSummary(call: Omit<CallPayload, "summary">, record?: CallRecord): string {
  const callerName =
    (record?.toolCalls.find((t) => ["book_appointment", "take_message"].includes(t.name))?.input as Record<string, string> | undefined)
      ?.customer_name ??
    (record?.toolCalls.find((t) => t.name === "take_message")?.input as Record<string, string> | undefined)?.caller_name;
  const who = callerName ? callerName : call.from ? `The caller at ${call.from}` : "A caller with a withheld number";
  const lang = call.language !== "en-US" ? ` The call was in ${LANGUAGE_NAMES[call.language]}.` : "";
  const detail = (o: string) => record?.outcomes.find((x) => x.outcome === o)?.detail ?? {};
  const when = (iso: unknown) =>
    typeof iso === "string" ? DateTime.fromISO(iso, { setZone: true }).setZone("America/Vancouver").toFormat("cccc LLLL d 'at' h:mm a") : "";
  const msgInput = record?.toolCalls.find((t) => t.name === "take_message")?.input as Record<string, string> | undefined;
  let main: string;
  switch (call.outcome) {
    case "booked": {
      const d = detail("booked");
      main = `${who} booked ${d.service ?? "an appointment"}${d.start ? ` for ${when(d.start)}` : ""}.`;
      break;
    }
    case "rescheduled":
      main = `${who} moved their appointment${detail("rescheduled").start ? ` to ${when(detail("rescheduled").start)}` : ""}.`;
      break;
    case "cancelled":
      main = `${who} cancelled their appointment${detail("cancelled").start ? ` for ${when(detail("cancelled").start)}` : ""}.`;
      break;
    case "message":
      main = `${who} left a ${msgInput?.urgency ?? "normal"} urgency message${msgInput?.message ? `: ${msgInput.message.slice(0, 200)}` : "."}`;
      if (!/[.!?]$/.test(main)) main += ".";
      main += " Please call back.";
      break;
    case "transferred":
      main = `${who} asked for a person and was transferred to the salon${call.transferResult ? ` (${call.transferResult})` : ""}.`;
      break;
    case "spam":
      main = "A sales or spam call; the receptionist politely ended it.";
      break;
    case "abandoned":
      main = `${who} hung up before finishing.${call.from ? " A callback may be worth it." : ""}`;
      break;
    default:
      main = `${who} asked a question and got an answer; nothing to follow up.`;
  }
  return cleanSummary(main + lang);
}

/** Writes the summary with a small, cheap Claude model (CALL_SUMMARY_MODEL, default claude-haiku-4-5). */
export class ClaudeSummarizer implements Summarizer {
  private client: Anthropic | null = null;
  constructor(
    private readonly model = "claude-haiku-4-5",
    private readonly timeoutMs = 20000,
  ) {}

  async summarize(call: Omit<CallPayload, "summary">): Promise<string> {
    this.client ??= new Anthropic({ maxRetries: 1, timeout: this.timeoutMs });
    const transcript = call.transcript.map((t) => `${t.role === "caller" ? "Caller" : "Receptionist"}${t.lang ? ` [${t.lang}]` : ""}: ${t.text}`).join("\n");
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system:
        "You summarize phone calls to CF Hair Salon for the salon owner. Write 1 to 3 short plain English sentences, whatever language the call was in. " +
        "Say who called (name if given), what they wanted, what happened, and any follow-up the owner should do. Include dates and times if a booking was made or changed. " +
        "No markdown, no lists, no em dashes. Keep the name Henderson Place exactly as written. Output only the summary.",
      messages: [
        {
          role: "user",
          content: `Outcome: ${call.outcome}${call.transferResult ? ` (transfer: ${call.transferResult})` : ""}\nLanguage: ${LANGUAGE_NAMES[call.language]}\nTranscript:\n${transcript.slice(0, 12000)}`,
        },
      ],
    });
    if (res.stop_reason === "refusal") throw new Error("summary refused");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
    const out = cleanSummary(text);
    if (!out) throw new Error("empty summary");
    return out;
  }
}

// ---------------------------------------------------------------- reporter

export class CallReporter {
  /** Recent payloads by callSid, so a transfer result or a resumed session can update them. */
  private readonly recent = new Map<string, CallPayload>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly file: string;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly api: BookingApi,
    private readonly summarizer: Summarizer | null,
    dataDir: string,
  ) {
    this.file = path.join(dataDir, "pending-calls.json");
  }

  /** Called when a call session ends. Returns when posted or queued. */
  submit(facts: CallFacts): Promise<void> {
    const own = buildCallPayload(facts);
    return this.serial(own.callSid, async () => {
      // Same CallSid seen before (e.g. back with the agent after an unanswered transfer): one record.
      const prev = this.recent.get(own.callSid) ?? this.readQueue()[own.callSid];
      const { summary: _old, ...base } = prev ? mergeCalls(prev, { ...own, summary: "" }) : { ...own, summary: "" };
      let summary: string;
      try {
        if (!this.summarizer) throw new Error("summaries disabled");
        summary = cleanSummary(await this.summarizer.summarize(base, facts.record));
        if (!summary) throw new Error("empty summary");
      } catch (err) {
        summary = templateSummary(base, facts.record);
        facts.record.errors.push(`summary fallback: ${(err as Error).message}`);
      }
      const payload: CallPayload = { ...base, summary };
      this.remember(payload);
      await this.send(payload);
    });
  }

  /** Twilio reported how the transfer went (<Dial action>). Posts the call again with the result. */
  transferResult(callSid: string, dialStatus: string | undefined): Promise<void> {
    return this.serial(callSid, async () => {
      const prev = this.recent.get(callSid) ?? this.readQueue()[callSid];
      if (!prev) {
        console.warn(`[calls] transfer result for unknown call ${callSid}`);
        return;
      }
      const transferResult = mapDialStatus(dialStatus);
      const summary = prev.outcome === "transferred" && !prev.summary.includes(transferResult) ? `${prev.summary} Transfer result: ${transferResult}.` : prev.summary;
      const payload = { ...prev, transferResult, summary };
      this.remember(payload);
      await this.send(payload);
    });
  }

  /** Retry everything queued while the website was down. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = async () => {
      try {
        await Promise.resolve(); // let `this.flushing` be set before anything can finish
        const queued = this.readQueue();
        for (const p of Object.values(queued)) {
          try {
            await this.api.postCall(p);
            this.dequeue(p.callSid, p);
          } catch {
            break; // still down; try again later
          }
        }
      } finally {
        this.flushing = null;
      }
    };
    this.flushing = run();
    return this.flushing;
  }

  pendingCount(): number {
    return Object.keys(this.readQueue()).length;
  }

  private async send(payload: CallPayload) {
    try {
      await this.api.postCall(payload);
      this.dequeue(payload.callSid);
      void this.flush();
    } catch (err) {
      this.enqueue(payload);
      const why = err instanceof ApiError ? `${err.status} ${err.code}` : (err as Error).message;
      console.warn(`[calls] could not post call ${payload.callSid} (${why}); queued for retry`);
    }
  }

  private serial(callSid: string, fn: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(callSid) ?? Promise.resolve()).then(fn, fn);
    this.chains.set(callSid, next.catch(() => {}));
    return next;
  }

  private remember(p: CallPayload) {
    this.recent.set(p.callSid, p);
    if (this.recent.size > 200) this.recent.delete(this.recent.keys().next().value!);
  }

  private readQueue(): Record<string, CallPayload> {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }

  private writeQueue(q: Record<string, CallPayload>) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(q, null, 2));
    fs.renameSync(tmp, this.file);
  }

  private enqueue(p: CallPayload) {
    const q = this.readQueue();
    q[p.callSid] = q[p.callSid] ? mergeCalls(q[p.callSid], p) : p;
    q[p.callSid].summary = p.summary;
    this.writeQueue(q);
  }

  /** Remove a queued record, unless a newer version replaced it meanwhile. */
  private dequeue(callSid: string, sent?: CallPayload) {
    const q = this.readQueue();
    if (!(callSid in q)) return;
    if (sent && JSON.stringify(q[callSid]) !== JSON.stringify(sent)) return;
    delete q[callSid];
    this.writeQueue(q);
  }
}
