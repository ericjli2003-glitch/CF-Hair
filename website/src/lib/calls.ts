// Phone receptionist call log: validation, upsert by callSid, listing and the
// transcript retention clean-up. Contract: docs/ARCHITECTURE.md, "Calls".
import type { Call, Customer } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "./api";
import { prisma } from "./db";
import { LANGUAGE_CODES } from "./languages";
import { toE164 } from "./phone";
import { SALON_TZ } from "./salon";
import { addDays, isDateKey, toZonedISO, zonedTime } from "./time";

export const CALL_OUTCOMES = ["booked", "rescheduled", "cancelled", "message", "transferred", "info", "abandoned", "spam"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const LANGUAGE_SOURCES = ["saved", "detected", "keypad", "asked", "default"] as const;
export const TRANSFER_RESULTS = ["answered", "no-answer", "busy", "failed"] as const;
export const SMS_CONSENT_ANSWERS = ["yes", "no", "not-asked"] as const;

const isoDate = z.iso.datetime({ offset: true });

const transcriptLine = z.object({
  role: z.enum(["caller", "agent"]),
  text: z.string().max(4000),
  lang: z.enum(LANGUAGE_CODES).optional(),
  at: isoDate.optional(),
});
export type TranscriptLine = z.infer<typeof transcriptLine>;

/**
 * POST /api/calls body. Everything except callSid is optional here so a later post
 * can update one field (e.g. transferResult); a new call additionally needs
 * startedAt, outcome and summary (checked in upsertCall).
 */
export const callBodySchema = z.object({
  callSid: z.string().trim().min(1).max(64),
  from: z.string().trim().max(32).nullable().optional(),
  startedAt: isoDate.optional(),
  endedAt: isoDate.nullable().optional(),
  durationSec: z.number().int().min(0).max(86400).optional(),
  language: z.enum(LANGUAGE_CODES).optional(),
  languageSource: z.enum(LANGUAGE_SOURCES).optional(),
  outcome: z.enum(CALL_OUTCOMES).optional(),
  summary: z.string().trim().min(1).max(1000).optional(),
  bookingId: z.string().trim().min(1).max(64).nullable().optional(),
  messageId: z.string().trim().min(1).max(64).nullable().optional(),
  transferResult: z.enum(TRANSFER_RESULTS).nullable().optional(),
  smsConsent: z.enum(SMS_CONSENT_ANSWERS).nullable().optional(),
  transcript: z.array(transcriptLine).max(500).optional(),
});
export type CallBody = z.infer<typeof callBodySchema>;

/** Turns zod issues into a 400 with a readable message ("outcome: Invalid option..."). */
export function zodError(error: z.ZodError, code = "INVALID_BODY"): HttpError {
  const first = error.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  return new HttpError(400, code, `${where}${first?.message ?? "Invalid body"}`);
}

export function parseTranscript(raw: string | null): TranscriptLine[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as TranscriptLine[]) : null;
  } catch {
    return null;
  }
}

export function transcriptDays(): number {
  const n = Number(process.env.CALL_TRANSCRIPT_DAYS);
  return Number.isInteger(n) && n > 0 ? n : 90;
}

type CallWithCustomer = Call & { customer?: Pick<Customer, "id" | "name"> | null };

export interface CallView {
  id: string;
  callSid: string;
  from: string | null;
  customer: { id: string; name: string } | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  language: string;
  languageSource: string;
  outcome: string;
  summary: string;
  bookingId: string | null;
  messageId: string | null;
  transferResult: string | null;
  smsConsent: string | null;
  hasTranscript: boolean;
  transcriptClearedAt: string | null;
  transcript?: TranscriptLine[] | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeCall(c: CallWithCustomer, withTranscript = false): CallView {
  const z = (d: Date | null) => (d ? toZonedISO(d, SALON_TZ) : null);
  return {
    id: c.id,
    callSid: c.callSid,
    from: c.fromPhone,
    customer: c.customer ? { id: c.customer.id, name: c.customer.name } : null,
    startedAt: toZonedISO(c.startedAt, SALON_TZ),
    endedAt: z(c.endedAt),
    durationSec: c.durationSec,
    language: c.language,
    languageSource: c.languageSource,
    outcome: c.outcome,
    summary: c.summary,
    bookingId: c.bookingId,
    messageId: c.messageId,
    transferResult: c.transferResult,
    smsConsent: c.smsConsent,
    hasTranscript: !!c.transcript,
    transcriptClearedAt: z(c.transcriptClearedAt),
    ...(withTranscript ? { transcript: parseTranscript(c.transcript) } : {}),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Normalises the caller number: E.164 when valid, null when withheld or empty. */
function callerPhone(from: string | null | undefined): string | null {
  if (from === undefined || from === null) return null;
  const s = from.trim();
  if (!s || /^(anonymous|withheld|private|restricted|unknown)$/i.test(s)) return null;
  return toE164(s) ?? s;
}

async function customerIdFor(phone: string | null, bookingId: string | null | undefined): Promise<string | null> {
  if (phone) {
    const c = await prisma.customer.findUnique({ where: { phone }, select: { id: true } });
    if (c) return c.id;
  }
  if (bookingId) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { customerId: true } });
    if (b) return b.customerId;
  }
  return null;
}

/**
 * Creates or updates the call with this callSid. Returns `created: true` for a new
 * call (201). Fields left out of an update keep their stored values.
 */
export async function upsertCall(input: unknown, now = new Date()): Promise<{ call: CallView; created: boolean }> {
  const parsed = callBodySchema.safeParse(input);
  if (!parsed.success) throw zodError(parsed.error);
  const b = parsed.data;
  const existing = await prisma.call.findUnique({ where: { callSid: b.callSid } });

  const startedAt = b.startedAt ? new Date(b.startedAt) : undefined;
  const endedAt = b.endedAt === undefined ? undefined : b.endedAt ? new Date(b.endedAt) : null;
  if (startedAt && endedAt && endedAt < startedAt) throw new HttpError(400, "INVALID_BODY", "endedAt is before startedAt");
  const fromPhone = b.from === undefined ? undefined : callerPhone(b.from);
  const durationSec =
    b.durationSec ??
    (startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : undefined);
  // A transcript posted for a call already past retention is not stored.
  const tooOld = (startedAt ?? existing?.startedAt ?? now).getTime() < now.getTime() - transcriptDays() * 86400000;
  const transcript = b.transcript === undefined || tooOld ? undefined : JSON.stringify(b.transcript);

  const fields = {
    ...(fromPhone !== undefined ? { fromPhone } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(b.language ? { language: b.language } : {}),
    ...(b.languageSource ? { languageSource: b.languageSource } : {}),
    ...(b.outcome ? { outcome: b.outcome } : {}),
    ...(b.summary ? { summary: b.summary } : {}),
    ...(b.bookingId !== undefined ? { bookingId: b.bookingId } : {}),
    ...(b.messageId !== undefined ? { messageId: b.messageId } : {}),
    ...(b.transferResult !== undefined ? { transferResult: b.transferResult } : {}),
    ...(b.smsConsent !== undefined ? { smsConsent: b.smsConsent } : {}),
    ...(transcript !== undefined ? { transcript } : {}),
  };

  const phoneForLink = fromPhone !== undefined ? fromPhone : (existing?.fromPhone ?? null);
  const bookingForLink = b.bookingId !== undefined ? b.bookingId : existing?.bookingId;
  const customerId = await customerIdFor(phoneForLink, bookingForLink);

  if (!existing) {
    const missing = (["startedAt", "outcome", "summary"] as const).filter((k) => !b[k]);
    if (missing.length) throw new HttpError(400, "INVALID_BODY", `A new call needs ${missing.join(", ")}`);
  }
  const include = { customer: { select: { id: true, name: true } } } as const;
  const row = existing
    ? await prisma.call.update({ where: { callSid: b.callSid }, data: { ...fields, customerId }, include })
    : // Upsert so two posts for the same new call cannot both insert (unique callSid).
      await prisma.call.upsert({
        where: { callSid: b.callSid },
        create: {
          callSid: b.callSid,
          startedAt: startedAt!,
          outcome: b.outcome!,
          summary: b.summary!,
          transcript: transcript ?? (tooOld ? null : "[]"),
          ...fields,
          customerId,
        },
        update: { ...fields, customerId },
        include,
      });
  return { call: serializeCall(row, true), created: !existing };
}

export interface CallFilters {
  from?: string | null; // YYYY-MM-DD, salon time, inclusive
  to?: string | null; // YYYY-MM-DD, inclusive
  outcome?: string | null;
  phone?: string | null;
  customerId?: string | null;
  cursor?: string | null;
  limit?: number;
}

/** Builds the Prisma filter; throws 400 on bad dates or outcome. */
export function callWhere(f: CallFilters) {
  const where: Record<string, unknown> = {};
  const range: Record<string, Date> = {};
  if (f.from) {
    if (!isDateKey(f.from)) throw new HttpError(400, "INVALID_DATE", "from must be YYYY-MM-DD");
    range.gte = zonedTime(f.from, 0, SALON_TZ);
  }
  if (f.to) {
    if (!isDateKey(f.to)) throw new HttpError(400, "INVALID_DATE", "to must be YYYY-MM-DD");
    range.lt = zonedTime(addDays(f.to, 1), 0, SALON_TZ);
  }
  if (Object.keys(range).length) where.startedAt = range;
  if (f.outcome) {
    if (!(CALL_OUTCOMES as readonly string[]).includes(f.outcome)) throw new HttpError(400, "INVALID_OUTCOME");
    where.outcome = f.outcome;
  }
  if (f.phone && f.phone.trim()) {
    const p = f.phone.trim();
    if (/^withheld$/i.test(p)) where.fromPhone = null;
    else {
      const e164 = toE164(p);
      const digits = p.replace(/\D/g, "");
      if (e164) where.fromPhone = e164;
      else if (digits) where.fromPhone = { contains: digits };
      else throw new HttpError(400, "INVALID_PHONE");
    }
  }
  if (f.customerId) where.customerId = f.customerId;
  return where;
}

export async function listCalls(f: CallFilters): Promise<{ calls: CallView[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await prisma.call.findMany({
    where: callWhere(f),
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { customer: { select: { id: true, name: true } } },
  });
  const page = rows.slice(0, limit);
  return { calls: page.map((c) => serializeCall(c)), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

export async function getCall(id: string): Promise<CallView | null> {
  const row = await prisma.call.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true } } } });
  return row ? serializeCall(row, true) : null;
}

/**
 * Clears transcripts of calls older than CALL_TRANSCRIPT_DAYS (default 90) and
 * keeps everything else, including the summary. Run from /api/sms/queue.
 */
export async function clearOldTranscripts(now = new Date()): Promise<{ cleared: number; days: number }> {
  const days = transcriptDays();
  const cutoff = new Date(now.getTime() - days * 86400000);
  const r = await prisma.call.updateMany({
    where: { startedAt: { lt: cutoff }, transcript: { not: null } },
    data: { transcript: null, transcriptClearedAt: now },
  });
  return { cleared: r.count, days };
}
