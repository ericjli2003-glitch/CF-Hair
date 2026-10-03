// Promotional SMS consent records (CASL). The current state lives in SmsConsent
// (one row per phone); every change is also written to the append-only
// ConsentEvent log, which is the proof the sender must be able to produce.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../api";
import { isLanguageCode } from "../languages";
import { toE164 } from "../phone";
import { SALON_TZ } from "../salon";
import { dateKeyOf } from "../time";
import { effectiveConsent, impliedExpiry, type ConsentStatus, type EffectiveConsent } from "./rules";

type Db = PrismaClient | Prisma.TransactionClient;

export const CONSENT_SOURCES = ["web", "admin", "phone", "keyword", "visit", "system"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
export type ConsentActor = "customer" | "owner" | "agent" | "system";

export const SOURCE_LABEL: Record<string, string> = {
  web: "Online booking checkbox",
  admin: "Recorded by the owner",
  phone: "Phone assistant",
  keyword: "Text keyword",
  visit: "Paid visit (existing business relationship)",
  system: "System",
};

export function impliedBasisText(visit: Date): string {
  return `Paid visit on ${dateKeyOf(visit, SALON_TZ)} (existing business relationship, CASL s. 10(10)). Valid for 2 years.`;
}

/** Latest completed, paid visit per customer: the basis for implied consent. */
export async function lastPaidVisits(db: Db = prisma, customerIds?: string[]): Promise<Map<string, Date>> {
  const rows = await db.booking.groupBy({
    by: ["customerId"],
    where: { status: "completed", priceCAD: { gt: 0 }, ...(customerIds ? { customerId: { in: customerIds } } : {}) },
    _max: { start: true },
  });
  const out = new Map<string, Date>();
  for (const r of rows) if (r._max.start) out.set(r.customerId, r._max.start);
  return out;
}

async function logEvent(
  db: Db,
  e: {
    phone: string;
    customerId?: string | null;
    type: string;
    source: string;
    actor: ConsentActor;
    wording?: string | null;
    language?: string | null;
    detail?: Record<string, unknown> | null;
    at?: Date;
  },
) {
  await db.consentEvent.create({
    data: {
      phone: e.phone,
      customerId: e.customerId ?? null,
      type: e.type,
      source: e.source,
      actor: e.actor,
      wording: e.wording ?? null,
      language: e.language ?? null,
      detail: e.detail ? JSON.stringify(e.detail) : null,
      ...(e.at ? { createdAt: e.at } : {}),
    },
  });
}

export interface RecordConsentInput {
  phone: unknown;
  /** express: opted in. withdrawn: opted out. declined: said no to an opt-in question (status unchanged). */
  status: unknown;
  source: unknown;
  wording?: unknown;
  language?: unknown;
  actor: ConsentActor;
  detail?: Record<string, unknown>;
  now?: Date;
}

export interface ConsentView {
  phone: string;
  customerId: string | null;
  status: ConsentStatus;
  stored: string;
  source: string | null;
  wording: string | null;
  language: string | null;
  consentedAt: string | null;
  impliedBasis: string | null;
  impliedExpiresAt: string | null;
  withdrawnAt: string | null;
  phoneAskDeclinedAt: string | null;
  /** The phone assistant may ask this caller once: no explicit answer recorded yet. */
  canAskOnPhone: boolean;
}

export async function getConsent(phoneInput: string, now = new Date()): Promise<ConsentView> {
  const phone = toE164(phoneInput) ?? phoneInput;
  const [row, customer] = await Promise.all([
    prisma.smsConsent.findUnique({ where: { phone } }),
    prisma.customer.findUnique({ where: { phone }, select: { id: true } }),
  ]);
  const paid = customer ? (await lastPaidVisits(prisma, [customer.id])).get(customer.id) ?? null : null;
  return toView(phone, customer?.id ?? row?.customerId ?? null, row, effectiveConsent(row, paid, now));
}

export function toView(
  phone: string,
  customerId: string | null,
  row: Prisma.SmsConsentGetPayload<object> | null,
  eff: EffectiveConsent,
): ConsentView {
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return {
    phone,
    customerId,
    status: eff.status,
    stored: row?.status ?? "none",
    source: eff.status === "implied" ? "visit" : (row?.source ?? null),
    wording: eff.status === "implied" ? null : (row?.wording ?? null),
    language: row?.language ?? null,
    consentedAt: eff.status === "implied" ? iso(eff.basisVisitAt) : iso(row?.consentedAt),
    impliedBasis: eff.basisVisitAt ? impliedBasisText(eff.basisVisitAt) : null,
    impliedExpiresAt: iso(eff.expiresAt),
    withdrawnAt: iso(row?.withdrawnAt),
    phoneAskDeclinedAt: iso(row?.phoneAskDeclinedAt),
    canAskOnPhone: (eff.status === "none" || eff.status === "implied") && !row?.phoneAskDeclinedAt && !row?.withdrawnAt,
  };
}

/** Records an express opt-in, a withdrawal, or a declined opt-in question. Always appends a ConsentEvent. */
export async function recordConsent(input: RecordConsentInput): Promise<ConsentView> {
  const phone = toE164(input.phone);
  if (!phone) throw new HttpError(400, "INVALID_PHONE");
  const status = input.status;
  if (status !== "express" && status !== "withdrawn" && status !== "declined") {
    throw new HttpError(400, "INVALID_STATUS", "status must be express, withdrawn or declined");
  }
  if (typeof input.source !== "string" || !(CONSENT_SOURCES as readonly string[]).includes(input.source)) {
    throw new HttpError(400, "INVALID_SOURCE", `source must be one of ${CONSENT_SOURCES.join(", ")}`);
  }
  const source = input.source as ConsentSource;
  const wording = typeof input.wording === "string" ? input.wording.trim().slice(0, 2000) : "";
  if (status === "express" && !wording) {
    throw new HttpError(400, "WORDING_REQUIRED", "Record the exact consent wording that was shown or spoken");
  }
  const language = isLanguageCode(input.language) ? input.language : typeof input.language === "string" ? input.language.slice(0, 10) : null;
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { phone }, select: { id: true } });
    const existing = await tx.smsConsent.findUnique({ where: { phone } });
    const customerId = customer?.id ?? existing?.customerId ?? null;
    const base = { phone, customerId };

    if (status === "express") {
      await tx.smsConsent.upsert({
        where: { phone },
        create: { ...base, status: "express", source, wording, language, consentedAt: now },
        update: { customerId, status: "express", source, wording, language, consentedAt: now, withdrawnAt: null },
      });
      await logEvent(tx, {
        phone, customerId, type: existing?.status === "withdrawn" ? "resubscribed" : "express", source,
        actor: input.actor, wording, language, detail: input.detail, at: now,
      });
    } else if (status === "withdrawn") {
      await tx.smsConsent.upsert({
        where: { phone },
        create: { ...base, status: "withdrawn", source, wording: wording || null, language, withdrawnAt: now },
        update: { customerId, status: "withdrawn", source, wording: wording || null, language, withdrawnAt: now, impliedExpiresAt: null },
      });
      await logEvent(tx, { phone, customerId, type: "withdrawn", source, actor: input.actor, wording: wording || null, language, detail: input.detail, at: now });
    } else {
      await tx.smsConsent.upsert({
        where: { phone },
        create: { ...base, status: "none", phoneAskDeclinedAt: now },
        update: { customerId, phoneAskDeclinedAt: now },
      });
      await logEvent(tx, { phone, customerId, type: "declined", source, actor: input.actor, wording: wording || null, language, detail: input.detail, at: now });
    }
  });
  return getConsent(phone, now);
}

/**
 * Brings stored implied consent in line with visit history: starts implied consent
 * (with basis and expiry) after a paid visit, extends it after a newer visit, and
 * marks it expired two years after the last paid visit. Express and withdrawn rows
 * are never touched. Each change is logged.
 */
export async function syncImpliedConsent(now = new Date()): Promise<{ started: number; extended: number; expired: number }> {
  const [customers, rows, paid] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, phone: true } }),
    prisma.smsConsent.findMany(),
    lastPaidVisits(),
  ]);
  const byPhone = new Map(rows.map((r) => [r.phone, r]));
  let started = 0;
  let extended = 0;
  let expired = 0;
  for (const c of customers) {
    const row = byPhone.get(c.phone);
    if (row && (row.status === "express" || row.status === "withdrawn")) continue;
    const visit = paid.get(c.id) ?? null;
    const eff = effectiveConsent(row ?? null, visit, now);
    if (eff.status === "implied") {
      const exp = eff.expiresAt!;
      if (row?.status === "implied" && row.impliedExpiresAt?.getTime() === exp.getTime()) continue;
      const isNew = row?.status !== "implied";
      await prisma.$transaction(async (tx) => {
        await tx.smsConsent.upsert({
          where: { phone: c.phone },
          create: {
            phone: c.phone, customerId: c.id, status: "implied", source: "visit", consentedAt: visit,
            impliedBasis: impliedBasisText(visit!), impliedVisitAt: visit, impliedExpiresAt: exp,
          },
          update: {
            customerId: c.id, status: "implied", source: "visit", consentedAt: isNew ? visit : undefined,
            impliedBasis: impliedBasisText(visit!), impliedVisitAt: visit, impliedExpiresAt: exp,
          },
        });
        await logEvent(tx, {
          phone: c.phone, customerId: c.id, type: "implied", source: "visit", actor: "system",
          detail: { basisVisitAt: visit!.toISOString(), expiresAt: exp.toISOString(), extended: !isNew }, at: now,
        });
      });
      if (isNew) started++;
      else extended++;
    } else if (row?.status === "implied") {
      await prisma.$transaction(async (tx) => {
        await tx.smsConsent.update({ where: { phone: c.phone }, data: { status: "none" } });
        await logEvent(tx, {
          phone: c.phone, customerId: c.id, type: "implied_expired", source: "system", actor: "system",
          detail: { expiredAt: row.impliedExpiresAt?.toISOString() ?? null }, at: now,
        });
      });
      expired++;
    }
  }
  return { started, extended, expired };
}

export { impliedExpiry };

/** Effective consent for every client, keyed by customer id (for lists and counts). */
export async function consentByCustomer(now = new Date()): Promise<Map<string, ConsentView>> {
  const [customers, rows, paid] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, phone: true } }),
    prisma.smsConsent.findMany(),
    lastPaidVisits(),
  ]);
  const byPhone = new Map(rows.map((r) => [r.phone, r]));
  const out = new Map<string, ConsentView>();
  for (const c of customers) {
    const row = byPhone.get(c.phone) ?? null;
    out.set(c.id, toView(c.phone, c.id, row, effectiveConsent(row, paid.get(c.id) ?? null, now)));
  }
  return out;
}

export async function consentSummary(now = new Date()) {
  const all = [...(await consentByCustomer(now)).values()];
  const soon = now.getTime() + 60 * 86400000;
  return {
    clients: all.length,
    express: all.filter((c) => c.status === "express").length,
    implied: all.filter((c) => c.status === "implied").length,
    impliedExpiringSoon: all.filter((c) => c.status === "implied" && c.impliedExpiresAt && new Date(c.impliedExpiresAt).getTime() < soon).length,
    withdrawn: all.filter((c) => c.status === "withdrawn").length,
    none: all.filter((c) => c.status === "none").length,
  };
}
