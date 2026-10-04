// Handwritten cards approval queue: batch uploads from the notes pipeline, the
// owner's review (edit, approve, skip), the monthly cap, and the pipeline's
// sent/failed reports. Contract: docs/ARCHITECTURE.md, "Handwritten cards".
import type { Card, CardBatch, Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../api";
import { zodError } from "../calls";
import { parseAddress, type MailingAddress } from "../customers";
import { prisma } from "../db";
import { toE164 } from "../phone";
import { SALON_TZ } from "../salon";
import { dateKeyOf, zonedTime } from "../time";
import { checkCardText, normalizeCardText, type TextIssue } from "./text";

export const CARD_STATUSES = ["pending", "approved", "skipped", "sent", "failed"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];
export const ALT_LANGUAGES = ["zh-CN", "zh-HK", "ko-KR"] as const;
export const CARD_PROVIDERS = ["handwrytten", "plotter"] as const;

const isoDate = z.iso.datetime({ offset: true });

const addressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(50),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().min(1).max(50),
});

const cardSchema = z.object({
  clientRef: z.string().trim().min(1).max(64),
  customerId: z.string().trim().min(1).max(64).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  mailingAddress: addressSchema,
  stylistName: z.string().trim().max(80),
  lastServiceName: z.string().trim().max(120).nullable().optional(),
  cardDesign: z.string().trim().min(1).max(80),
  message: z.string().min(1).max(4000),
  messageAlt: z.string().max(4000).nullable().optional(),
  altLanguage: z.enum(ALT_LANGUAGES).nullable().optional(),
  maxChars: z.number().int().min(20).max(2000),
  mock: z.boolean().optional(),
});

export const batchSchema = z.object({
  campaignId: z.string().trim().min(1).max(80),
  campaignName: z.string().trim().min(1).max(160),
  occasion: z.string().trim().max(400),
  generatedAt: isoDate,
  mock: z.boolean(),
  cards: z.array(cardSchema).min(1).max(1000),
});

export const patchSchema = z
  .object({
    status: z.enum(["pending", "approved", "skipped"]).optional(),
    message: z.string().max(4000).optional(),
    messageAlt: z.string().max(4000).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.message !== undefined || b.messageAlt !== undefined, { message: "Nothing to change" });

export const sentSchema = z.union([
  z.object({
    failed: z.literal(true),
    error: z.string().trim().min(1).max(1000),
    provider: z.enum(CARD_PROVIDERS).optional(),
  }),
  z.object({
    provider: z.enum(CARD_PROVIDERS),
    providerOrderId: z.string().trim().min(1).max(120).nullable().optional(),
    sentAt: isoDate,
    costCAD: z.number().min(0).max(1000).nullable().optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Settings: monthly cap and price per card (AppSetting rows, env defaults).
// ---------------------------------------------------------------------------

export interface CardSettings {
  monthlyCap: number;
  pricePerCardCAD: number;
}

export const DEFAULT_CARD_SETTINGS: CardSettings = { monthlyCap: 40, pricePerCardCAD: 8.5 };

export async function getCardSettings(): Promise<CardSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: ["cards.monthlyCap", "cards.pricePerCardCAD"] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const cap = Number(get("cards.monthlyCap") ?? process.env.CARDS_MONTHLY_CAP);
  const price = Number(get("cards.pricePerCardCAD") ?? process.env.CARDS_PRICE_CAD);
  return {
    monthlyCap: Number.isInteger(cap) && cap >= 0 ? cap : DEFAULT_CARD_SETTINGS.monthlyCap,
    pricePerCardCAD: Number.isFinite(price) && price >= 0 ? price : DEFAULT_CARD_SETTINGS.pricePerCardCAD,
  };
}

export const settingsSchema = z
  .object({
    monthlyCap: z.number().int().min(0).max(10000).optional(),
    pricePerCardCAD: z.number().min(0).max(1000).optional(),
  })
  .refine((b) => b.monthlyCap !== undefined || b.pricePerCardCAD !== undefined, { message: "Nothing to change" });

export async function saveCardSettings(input: unknown): Promise<CardSettings> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw zodError(parsed.error, "INVALID_SETTINGS");
  const put = (key: string, value: string) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const ops = [];
  if (parsed.data.monthlyCap !== undefined) ops.push(put("cards.monthlyCap", String(parsed.data.monthlyCap)));
  if (parsed.data.pricePerCardCAD !== undefined) ops.push(put("cards.pricePerCardCAD", String(Math.round(parsed.data.pricePerCardCAD * 100) / 100)));
  await prisma.$transaction(ops);
  return getCardSettings();
}

// ---------------------------------------------------------------------------
// Monthly cap
// ---------------------------------------------------------------------------

/** Start of the calendar month (salon time) containing `now`, and of the next one. */
export function monthBounds(now = new Date()): { start: Date; end: Date; label: string } {
  const key = dateKeyOf(now, SALON_TZ);
  const [y, m] = key.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const label = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
  return { start: zonedTime(`${y}-${pad(m)}-01`, 0, SALON_TZ), end: zonedTime(next, 0, SALON_TZ), label };
}

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Cards that count against this month's cap: approved or sent, by the date the
 * owner approved them. Skipped, failed and pending cards do not count.
 */
export async function monthUsage(now = new Date(), db: Db = prisma): Promise<number> {
  const { start, end } = monthBounds(now);
  return db.card.count({ where: { status: { in: ["approved", "sent"] }, approvedAt: { gte: start, lt: end } } });
}

export interface MonthSummary {
  label: string;
  used: number;
  cap: number;
  left: number;
  pricePerCardCAD: number;
  estimatedCAD: number;
}

export async function monthSummary(now = new Date()): Promise<MonthSummary> {
  const [used, s] = await Promise.all([monthUsage(now), getCardSettings()]);
  return {
    label: monthBounds(now).label,
    used,
    cap: s.monthlyCap,
    left: Math.max(0, s.monthlyCap - used),
    pricePerCardCAD: s.pricePerCardCAD,
    estimatedCAD: Math.round(used * s.pricePerCardCAD * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export interface CardView {
  id: string;
  batchId: string;
  campaignId: string;
  clientRef: string;
  customerId: string | null;
  name: string;
  mailingAddress: MailingAddress | null;
  stylistName: string;
  lastServiceName: string | null;
  cardDesign: string;
  message: string;
  messageAlt: string | null;
  altLanguage: string | null;
  maxChars: number;
  mock: boolean;
  status: string;
  editedAt: string | null;
  approvedAt: string | null;
  skippedAt: string | null;
  provider: string | null;
  providerOrderId: string | null;
  sentAt: string | null;
  costCAD: number | null;
  failedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function serializeCard(c: Card): CardView {
  return {
    id: c.id,
    batchId: c.batchId,
    campaignId: c.campaignId,
    clientRef: c.clientRef,
    customerId: c.customerId,
    name: c.name,
    mailingAddress: parseAddress(c.mailingAddress),
    stylistName: c.stylistName,
    lastServiceName: c.lastServiceName,
    cardDesign: c.cardDesign,
    message: c.message,
    messageAlt: c.messageAlt,
    altLanguage: c.altLanguage,
    maxChars: c.maxChars,
    mock: c.mock,
    status: c.status,
    editedAt: iso(c.editedAt),
    approvedAt: iso(c.approvedAt),
    skippedAt: iso(c.skippedAt),
    provider: c.provider,
    providerOrderId: c.providerOrderId,
    sentAt: iso(c.sentAt),
    costCAD: c.costCAD,
    failedAt: iso(c.failedAt),
    error: c.error,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export type StatusCounts = Record<CardStatus, number> & { total: number };

export function emptyCounts(): StatusCounts {
  return { pending: 0, approved: 0, skipped: 0, sent: 0, failed: 0, total: 0 };
}

export interface BatchView {
  id: string;
  campaignId: string;
  campaignName: string;
  occasion: string;
  generatedAt: string;
  mock: boolean;
  createdAt: string;
  counts: StatusCounts;
}

export async function listBatches(): Promise<BatchView[]> {
  const [batches, groups] = await Promise.all([
    prisma.cardBatch.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.card.groupBy({ by: ["batchId", "status"], _count: { _all: true } }),
  ]);
  return batches.map((b) => {
    const counts = emptyCounts();
    for (const g of groups) {
      if (g.batchId !== b.id) continue;
      if (g.status in counts) counts[g.status as CardStatus] += g._count._all;
      counts.total += g._count._all;
    }
    return serializeBatch(b, counts);
  });
}

export function serializeBatch(b: CardBatch, counts: StatusCounts): BatchView {
  return {
    id: b.id,
    campaignId: b.campaignId,
    campaignName: b.campaignName,
    occasion: b.occasion,
    generatedAt: b.generatedAt.toISOString(),
    mock: b.mock,
    createdAt: b.createdAt.toISOString(),
    counts,
  };
}

// ---------------------------------------------------------------------------
// Upload (notes pipeline)
// ---------------------------------------------------------------------------

async function linkCustomer(db: Db, ref: string, customerId?: string | null): Promise<string | null> {
  for (const id of [customerId, ref]) {
    if (!id) continue;
    const c = await db.customer.findUnique({ where: { id }, select: { id: true } });
    if (c) return c.id;
  }
  const phone = toE164(ref);
  if (phone) {
    const c = await db.customer.findUnique({ where: { phone }, select: { id: true } });
    if (c) return c.id;
  }
  return null;
}

/**
 * Stores a batch. Idempotent on (campaignId, clientRef) while a card is pending:
 * posting the same client again updates that pending card (and moves it into this
 * batch) instead of adding a second one. Re-posting the same run (same campaignId
 * and generatedAt) reuses its batch. Cards already approved, skipped, sent or
 * failed are never touched; a new pending card is created next to them.
 */
export async function createBatch(input: unknown): Promise<{ batch: { id: string; cards: { id: string; clientRef: string }[] } }> {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) throw zodError(parsed.error);
  const b = parsed.data;
  const refs = b.cards.map((c) => c.clientRef);
  if (new Set(refs).size !== refs.length) throw new HttpError(400, "DUPLICATE_CLIENT_REF", "Each clientRef may appear once per batch");
  const generatedAt = new Date(b.generatedAt);

  return prisma.$transaction(async (tx) => {
    const batch =
      (await tx.cardBatch.findFirst({ where: { campaignId: b.campaignId, generatedAt } })) ??
      (await tx.cardBatch.create({
        data: { campaignId: b.campaignId, campaignName: b.campaignName, occasion: b.occasion, generatedAt, mock: b.mock },
      }));
    await tx.cardBatch.update({ where: { id: batch.id }, data: { campaignName: b.campaignName, occasion: b.occasion, mock: b.mock } });

    const out: { id: string; clientRef: string }[] = [];
    const touchedBatches = new Set<string>();
    for (const c of b.cards) {
      const data = {
        batchId: batch.id,
        campaignId: b.campaignId,
        clientRef: c.clientRef,
        customerId: await linkCustomer(tx, c.clientRef, c.customerId),
        name: c.name,
        mailingAddress: JSON.stringify({ ...c.mailingAddress, line2: c.mailingAddress.line2 || undefined }),
        stylistName: c.stylistName,
        lastServiceName: c.lastServiceName ?? null,
        cardDesign: c.cardDesign,
        message: c.message,
        messageAlt: c.messageAlt || null,
        altLanguage: c.altLanguage ?? null,
        maxChars: c.maxChars,
        mock: c.mock ?? b.mock,
      };
      const pending = await tx.card.findFirst({ where: { campaignId: b.campaignId, clientRef: c.clientRef, status: "pending" } });
      if (pending) {
        if (pending.batchId !== batch.id) touchedBatches.add(pending.batchId);
        // Keep the owner's edit if they already changed this card.
        const keepText = pending.editedAt ? { message: pending.message, messageAlt: pending.messageAlt } : {};
        await tx.card.update({ where: { id: pending.id }, data: { ...data, ...keepText } });
        out.push({ id: pending.id, clientRef: c.clientRef });
      } else {
        const row = await tx.card.create({ data });
        out.push({ id: row.id, clientRef: c.clientRef });
      }
    }
    // An older batch whose pending cards all moved here is left empty: remove it.
    for (const id of touchedBatches) {
      if ((await tx.card.count({ where: { batchId: id } })) === 0) await tx.cardBatch.delete({ where: { id } });
    }
    return { batch: { id: batch.id, cards: out } };
  });
}

// ---------------------------------------------------------------------------
// Review (owner)
// ---------------------------------------------------------------------------

export class TextError extends HttpError {
  constructor(public issues: TextIssue[]) {
    super(400, "INVALID_TEXT", issues.map((i) => i.message).join(" "), { issues });
  }
}

function capError(cap: number, used: number, extra: Record<string, unknown> = {}) {
  const msg =
    used >= cap
      ? `This month's limit of ${cap} cards is reached (${used} approved or sent).`
      : `Only ${cap - used} more card${cap - used === 1 ? "" : "s"} fit this month's limit of ${cap}.`;
  return new HttpError(409, "MONTHLY_CAP", msg, { cap, used, left: Math.max(0, cap - used), ...extra });
}

/**
 * PATCH /api/cards/{id}: edit text (re-validated) and/or change status among
 * pending, approved and skipped. Approving past the monthly cap is refused.
 * Sent cards cannot change; a failed card can be approved again to retry, or skipped.
 */
export async function patchCard(id: string, input: unknown, now = new Date()): Promise<CardView> {
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) throw zodError(parsed.error);
  const p = parsed.data;

  return prisma.$transaction(async (tx) => {
    const card = await tx.card.findUnique({ where: { id } });
    if (!card) throw new HttpError(404, "CARD_NOT_FOUND");
    if (card.status === "sent") throw new HttpError(409, "CARD_SENT", "This card has already been mailed.");

    const data: Prisma.CardUpdateInput = {};
    if (p.message !== undefined || p.messageAlt !== undefined) {
      const message = p.message !== undefined ? normalizeCardText(p.message) : undefined;
      const messageAlt = p.messageAlt === undefined ? undefined : p.messageAlt === null ? null : normalizeCardText(p.messageAlt) || null;
      const issues = checkCardText({ message, messageAlt }, card.maxChars);
      if (issues.length) throw new TextError(issues);
      if (message !== undefined) data.message = message;
      if (messageAlt !== undefined) data.messageAlt = messageAlt;
      data.editedAt = now;
    }

    const next = p.status;
    if (next && next !== card.status) {
      if (card.status === "failed" && next === "pending") throw new HttpError(409, "INVALID_TRANSITION", "Approve a failed card to retry it, or skip it.");
      if (next === "approved") {
        // The stored text must pass too (it may come from the pipeline unedited).
        const issues = checkCardText({ message: (data.message as string) ?? card.message, messageAlt: (data.messageAlt as string | null) ?? card.messageAlt }, card.maxChars);
        if (issues.length) throw new TextError(issues);
        const [settings, used] = await Promise.all([getCardSettings(), monthUsage(now, tx)]);
        if (used >= settings.monthlyCap) throw capError(settings.monthlyCap, used);
        Object.assign(data, { status: "approved", approvedAt: now, skippedAt: null, failedAt: null, error: null });
      } else if (next === "skipped") {
        Object.assign(data, { status: "skipped", skippedAt: now, approvedAt: null });
      } else {
        Object.assign(data, { status: "pending", approvedAt: null, skippedAt: null });
      }
    }
    const row = await tx.card.update({ where: { id }, data });
    return serializeCard(row);
  });
}

/**
 * Approves every pending card in a batch whose text passes the checks, up to the
 * cap. Without `limit`, refuses with 409 MONTHLY_CAP when there are more such cards
 * than the cap has room for; with `limit`, approves that many (oldest first).
 */
export async function approveAll(batchId: string, opts: { limit?: number } = {}, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.cardBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new HttpError(404, "BATCH_NOT_FOUND");
    const pending = await tx.card.findMany({ where: { batchId, status: "pending" }, orderBy: { createdAt: "asc" } });
    const valid = pending.filter((c) => checkCardText({ message: c.message, messageAlt: c.messageAlt }, c.maxChars).length === 0);
    const [settings, used] = await Promise.all([getCardSettings(), monthUsage(now, tx)]);
    const left = Math.max(0, settings.monthlyCap - used);
    if (opts.limit === undefined && valid.length > left) {
      throw capError(settings.monthlyCap, used, { ready: valid.length });
    }
    const take = valid.slice(0, Math.min(valid.length, left, opts.limit ?? Infinity));
    if (take.length) {
      await tx.card.updateMany({
        where: { id: { in: take.map((c) => c.id) }, status: "pending" },
        data: { status: "approved", approvedAt: now, skippedAt: null },
      });
    }
    return { approved: take.length, needsFix: pending.length - valid.length, leftPending: pending.length - take.length, cap: settings.monthlyCap, used: used + take.length };
  });
}

/** POST /api/cards/{id}/sent from the notes pipeline. */
export async function reportSent(id: string, input: unknown, now = new Date()): Promise<{ card: CardView; changed: boolean }> {
  const parsed = sentSchema.safeParse(input);
  if (!parsed.success) throw zodError(parsed.error);
  const b = parsed.data;
  return prisma.$transaction(async (tx) => {
    const card = await tx.card.findUnique({ where: { id } });
    if (!card) throw new HttpError(404, "CARD_NOT_FOUND");
    if ("failed" in b) {
      if (card.status === "sent") throw new HttpError(409, "ALREADY_SENT", "This card is already recorded as sent.");
      if (card.status !== "approved" && card.status !== "failed") throw new HttpError(409, "NOT_APPROVED", "Only approved cards can be mailed.");
      const row = await tx.card.update({
        where: { id },
        data: { status: "failed", failedAt: now, error: b.error, ...(b.provider ? { provider: b.provider } : {}) },
      });
      return { card: serializeCard(row), changed: true };
    }
    if (card.status === "sent") {
      // Repeating the same report is fine; a different order is a conflict.
      if (card.provider === b.provider && (card.providerOrderId ?? null) === (b.providerOrderId ?? null)) return { card: serializeCard(card), changed: false };
      throw new HttpError(409, "ALREADY_SENT", "This card is already recorded as sent.");
    }
    if (card.status !== "approved" && card.status !== "failed") throw new HttpError(409, "NOT_APPROVED", "Only approved cards can be mailed.");
    const row = await tx.card.update({
      where: { id },
      data: {
        status: "sent",
        provider: b.provider,
        providerOrderId: b.providerOrderId ?? null,
        sentAt: new Date(b.sentAt),
        costCAD: b.costCAD ?? null,
        error: null,
        approvedAt: card.approvedAt ?? now,
      },
    });
    return { card: serializeCard(row), changed: true };
  });
}

export async function listCards(f: { batchId?: string | null; status?: string | null }): Promise<CardView[]> {
  if (f.status && !(CARD_STATUSES as readonly string[]).includes(f.status)) throw new HttpError(400, "INVALID_STATUS");
  const rows = await prisma.card.findMany({
    where: { ...(f.batchId ? { batchId: f.batchId } : {}), ...(f.status ? { status: f.status } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(serializeCard);
}
