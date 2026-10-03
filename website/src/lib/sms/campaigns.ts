// Promotional campaigns: audience building, consent filtering, scheduling with
// quiet hours, the throttled send queue (live via Twilio or the offline outbox),
// and results. Consent and the frequency cap are checked twice: when the audience
// is snapshotted and again right before each text is sent, so a STOP that arrives
// in between always wins.
import type { Campaign } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../api";
import { listCustomers } from "../customers";
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from "../languages";
import { toE164 } from "../phone";
import { SALON_TZ } from "../salon";
import { parseStart, toZonedISO, zonedParts } from "../time";
import { assertCompliant, CAMPAIGN_LANGS, composePromo, parseBodies, pickLanguage, previewAll, type CampaignBodies, type PreviewItem } from "./compose";
import { lastPaidVisits } from "./consent";
import {
  consentDecision,
  effectiveConsent,
  inSendWindow,
  nextAllowedSendTime,
  underFrequencyCap,
  type EffectiveConsent,
  type FrequencyCap,
  type SkipReason,
} from "./rules";
import { costPerSegmentUSD, countSegments } from "./segments";
import { getSmsSettings } from "./settings";
import { publicBaseUrl, smsMode, twilioSend } from "./twilio";

// ---------------------------------------------------------------- audience

export const AUDIENCE_TYPES = ["all", "recent", "lapsed", "stylist", "category", "birthday"] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export interface AudienceSpec {
  type: AudienceType;
  /** recent: visited in the last N days (default 90). */
  days?: number;
  /** lapsed: last visit between minDays and maxDays ago (default 60 to 120). */
  minDays?: number;
  maxDays?: number;
  staffId?: string;
  category?: string;
}

export function parseAudience(raw: unknown): AudienceSpec {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = {};
    }
  }
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const type = (AUDIENCE_TYPES as readonly string[]).includes(String(o.type)) ? (o.type as AudienceType) : "all";
  const int = (x: unknown, d: number, max = 3650) => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : d;
  };
  const spec: AudienceSpec = { type };
  if (type === "recent") spec.days = int(o.days, 90);
  if (type === "lapsed") {
    spec.minDays = int(o.minDays, 60);
    spec.maxDays = Math.max(int(o.maxDays, 120), spec.minDays + 1);
  }
  if (type === "stylist") spec.staffId = typeof o.staffId === "string" ? o.staffId : "";
  if (type === "category") spec.category = typeof o.category === "string" ? o.category : "";
  return spec;
}

export function describeAudience(a: AudienceSpec, staffNames: Map<string, string> = new Map()): string {
  switch (a.type) {
    case "all":
      return "Everyone who can receive promotions";
    case "recent":
      return `Visited in the last ${a.days ?? 90} days`;
    case "lapsed":
      return `Lapsed: last visit ${a.minDays ?? 60} to ${a.maxDays ?? 120} days ago`;
    case "stylist":
      return `Usual stylist: ${staffNames.get(a.staffId ?? "") ?? a.staffId ?? "?"}`;
    case "category":
      return `Has had ${a.category ?? "?"} services`;
    case "birthday":
      return "Birthday this month";
  }
}

export interface Recipient {
  customerId: string;
  name: string;
  phone: string;
  preferredLanguage: LanguageCode;
  language: LanguageCode; // version they get
  consent: EffectiveConsent;
  decision: { ok: true; basis: "express" | "implied" } | { ok: false; reason: SkipReason };
}

export interface AudienceResult {
  matched: number;
  recipients: Recipient[];
  eligible: Recipient[];
  skipped: Record<string, number>;
  byLanguage: Record<LanguageCode, number>;
  byConsent: { express: number; implied: number };
}

/** Finds who matches the audience and decides, per person, whether they may get the text. */
export async function resolveAudience(
  spec: AudienceSpec,
  includeImplied: boolean,
  bodies: CampaignBodies,
  opts: { now?: Date; cap?: FrequencyCap } = {},
): Promise<AudienceResult> {
  const now = opts.now ?? new Date();
  const cap = opts.cap ?? (await getSmsSettings()).frequencyCap;
  const customers = await listCustomers({}, now);
  const dayMs = 86400000;
  const month = zonedParts(now, SALON_TZ).month;

  let categoryCustomers: Set<string> | null = null;
  if (spec.type === "category") {
    const rows = await prisma.booking.findMany({
      where: { status: "completed", service: { category: spec.category ?? "" } },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    categoryCustomers = new Set(rows.map((r) => r.customerId));
  }

  const matched = customers.filter((c) => {
    const last = c.lastVisit ? new Date(c.lastVisit).getTime() : null;
    switch (spec.type) {
      case "all":
        return true;
      case "recent":
        return last !== null && last >= now.getTime() - (spec.days ?? 90) * dayMs;
      case "lapsed": {
        if (last === null || c.upcomingCount > 0) return false;
        const ago = (now.getTime() - last) / dayMs;
        return ago >= (spec.minDays ?? 60) && ago <= (spec.maxDays ?? 120);
      }
      case "stylist":
        return !!spec.staffId && c.favouriteStaffId === spec.staffId;
      case "category":
        return categoryCustomers!.has(c.id);
      case "birthday":
        return !!c.birthday && Number(c.birthday.slice(5, 7)) === month;
    }
  });

  const ids = matched.map((c) => c.id);
  const phones = matched.map((c) => c.phone);
  const [rows, paid, sent] = await Promise.all([
    prisma.smsConsent.findMany({ where: { phone: { in: phones } } }),
    lastPaidVisits(prisma, ids),
    prisma.campaignMessage.findMany({
      where: { phone: { in: phones }, isTest: false, status: { in: ["sent", "delivered"] }, sentAt: { gt: new Date(now.getTime() - cap.days * dayMs) } },
      select: { phone: true, sentAt: true },
    }),
  ]);
  const consentByPhone = new Map(rows.map((r) => [r.phone, r]));
  const sentByPhone = new Map<string, Date[]>();
  for (const s of sent) sentByPhone.set(s.phone, [...(sentByPhone.get(s.phone) ?? []), s.sentAt!]);

  const seen = new Set<string>();
  const recipients: Recipient[] = matched.map((c) => {
    const paidAt = paid.get(c.id) ?? null;
    const consent = effectiveConsent(consentByPhone.get(c.phone), paidAt, now);
    let decision = consentDecision(consent, includeImplied, !!paidAt);
    if (decision.ok && !toE164(c.phone)) decision = { ok: false, reason: "invalid_phone" };
    if (decision.ok && seen.has(c.phone)) decision = { ok: false, reason: "duplicate" };
    if (decision.ok && !underFrequencyCap(sentByPhone.get(c.phone) ?? [], now, cap)) decision = { ok: false, reason: "frequency_cap" };
    seen.add(c.phone);
    return {
      customerId: c.id,
      name: c.name,
      phone: c.phone,
      preferredLanguage: c.preferredLanguage,
      language: pickLanguage(bodies, c.preferredLanguage),
      consent,
      decision,
    };
  });

  const eligible = recipients.filter((r) => r.decision.ok);
  const skipped: Record<string, number> = {};
  for (const r of recipients) if (!r.decision.ok) skipped[r.decision.reason] = (skipped[r.decision.reason] ?? 0) + 1;
  const byLanguage = Object.fromEntries(CAMPAIGN_LANGS.map((l) => [l, 0])) as Record<LanguageCode, number>;
  for (const r of eligible) byLanguage[r.language]++;
  return {
    matched: matched.length,
    recipients,
    eligible,
    skipped,
    byLanguage,
    byConsent: {
      express: eligible.filter((r) => r.decision.ok && r.decision.basis === "express").length,
      implied: eligible.filter((r) => r.decision.ok && r.decision.basis === "implied").length,
    },
  };
}

// ---------------------------------------------------------------- input

export interface CampaignInput {
  name: string;
  bodies: CampaignBodies;
  audience: AudienceSpec;
  includeImplied: boolean;
}

export function parseCampaignInput(body: Record<string, unknown>, partial = false): Partial<CampaignInput> {
  const out: Partial<CampaignInput> = {};
  if (body.name !== undefined || !partial) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) throw new HttpError(400, "INVALID_NAME", "Give the campaign a name");
    out.name = name;
  }
  if (body.bodies !== undefined || body.message !== undefined || !partial) {
    const raw = (body.bodies ?? {}) as Record<string, unknown>;
    const bodies: CampaignBodies = { "en-US": typeof raw["en-US"] === "string" ? raw["en-US"] : typeof body.message === "string" ? body.message : "" };
    for (const l of CAMPAIGN_LANGS) {
      const v = raw[l];
      if (typeof v === "string" && v.trim()) bodies[l] = v.slice(0, 1000);
    }
    bodies["en-US"] = bodies["en-US"].slice(0, 1000);
    if (!bodies["en-US"].trim()) throw new HttpError(400, "INVALID_MESSAGE", "The English message is required");
    out.bodies = bodies;
  }
  if (body.audience !== undefined || !partial) out.audience = parseAudience(body.audience ?? { type: "all" });
  if (body.includeImplied !== undefined || !partial) out.includeImplied = body.includeImplied === true;
  return out;
}

// ---------------------------------------------------------------- preview

export interface CampaignPreview {
  previews: PreviewItem[];
  audience: Omit<AudienceResult, "recipients" | "eligible"> & { eligibleCount: number; sample: { name: string; language: LanguageCode; basis: string }[] };
  segmentsTotal: number;
  estimatedCostUSD: number;
  costPerSegmentUSD: number;
  sendWindow: { now: string; inWindow: boolean; nextAllowed: string };
}

export async function previewCampaign(input: CampaignInput, now = new Date()): Promise<CampaignPreview> {
  const previews = previewAll(input.bodies);
  const aud = await resolveAudience(input.audience, input.includeImplied, input.bodies, { now });
  const segOf = new Map(previews.map((p) => [p.language, p.info.segments]));
  const segmentsTotal = aud.eligible.reduce((s, r) => s + (segOf.get(r.language) ?? 1), 0);
  const per = costPerSegmentUSD();
  const next = nextAllowedSendTime(now, SALON_TZ);
  return {
    previews,
    audience: {
      matched: aud.matched,
      skipped: aud.skipped,
      byLanguage: aud.byLanguage,
      byConsent: aud.byConsent,
      eligibleCount: aud.eligible.length,
      sample: aud.eligible.slice(0, 8).map((r) => ({ name: r.name, language: r.language, basis: r.decision.ok ? r.decision.basis : "" })),
    },
    segmentsTotal,
    estimatedCostUSD: Math.round(segmentsTotal * per * 10000) / 10000,
    costPerSegmentUSD: per,
    sendWindow: { now: toZonedISO(now, SALON_TZ), inWindow: inSendWindow(now, SALON_TZ), nextAllowed: toZonedISO(next, SALON_TZ) },
  };
}

// ---------------------------------------------------------------- CRUD

export async function createCampaign(input: CampaignInput) {
  return prisma.campaign.create({
    data: {
      name: input.name,
      bodies: JSON.stringify(input.bodies),
      audience: JSON.stringify(input.audience),
      includeImplied: input.includeImplied,
    },
  });
}

export async function updateCampaign(id: string, input: Partial<CampaignInput>) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "CAMPAIGN_NOT_FOUND");
  if (c.status !== "draft" && c.status !== "scheduled") throw new HttpError(409, "CAMPAIGN_LOCKED", `Campaign is ${c.status}`);
  return prisma.campaign.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.bodies !== undefined ? { bodies: JSON.stringify(input.bodies) } : {}),
      ...(input.audience !== undefined ? { audience: JSON.stringify(input.audience) } : {}),
      ...(input.includeImplied !== undefined ? { includeImplied: input.includeImplied } : {}),
    },
  });
}

export function campaignInputOf(c: Campaign): CampaignInput {
  return { name: c.name, bodies: parseBodies(c.bodies), audience: parseAudience(c.audience), includeImplied: c.includeImplied };
}

/**
 * Schedules a campaign. `at` null means "send now". Either way the time is moved
 * out of quiet hours (before 09:00 or from 20:00 salon time) to the next allowed
 * time. Returns the campaign and whether the time was adjusted.
 */
export async function scheduleCampaign(id: string, atInput: unknown, now = new Date()) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "CAMPAIGN_NOT_FOUND");
  if (c.status !== "draft" && c.status !== "scheduled") throw new HttpError(409, "CAMPAIGN_LOCKED", `Campaign is ${c.status}`);
  assertPromoSenderReady();
  let requested: Date | null = null;
  if (atInput !== null && atInput !== undefined && atInput !== "") {
    requested = atInput instanceof Date ? atInput : parseStart(atInput, SALON_TZ);
    if (!requested) throw new HttpError(400, "INVALID_TIME", "at must be an ISO date-time");
    if (requested.getTime() < now.getTime() - 60000) throw new HttpError(400, "TIME_IN_PAST");
  }
  const base = requested && requested > now ? requested : now;
  const scheduledAt = nextAllowedSendTime(base, SALON_TZ);
  const updated = await prisma.campaign.update({
    where: { id },
    data: { status: "scheduled", requestedAt: requested, scheduledAt },
  });
  return { campaign: updated, adjustedForQuietHours: scheduledAt.getTime() !== base.getTime() };
}

export async function cancelCampaign(id: string) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "CAMPAIGN_NOT_FOUND");
  if (c.status === "sent" || c.status === "cancelled") throw new HttpError(409, "CAMPAIGN_LOCKED", `Campaign is ${c.status}`);
  await prisma.$transaction([
    prisma.campaignMessage.updateMany({ where: { campaignId: id, status: "queued", isTest: false }, data: { status: "skipped", skipReason: "cancelled" } }),
    prisma.campaign.update({ where: { id }, data: { status: c.status === "sending" ? "sent" : "cancelled", completedAt: c.status === "sending" ? new Date() : null } }),
  ]);
}

export async function deleteDraft(id: string) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "CAMPAIGN_NOT_FOUND");
  if (c.status !== "draft" && c.status !== "cancelled") throw new HttpError(409, "CAMPAIGN_LOCKED");
  await prisma.campaign.delete({ where: { id } });
}

// ---------------------------------------------------------------- queue

/** Snapshots the audience into per-recipient rows: queued for eligible people, skipped (with reason) for the rest. */
export async function queueCampaign(id: string, now = new Date()) {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "CAMPAIGN_NOT_FOUND");
  if (c.status !== "scheduled") return { queued: 0, skipped: 0 };
  const input = campaignInputOf(c);
  const aud = await resolveAudience(input.audience, input.includeImplied, input.bodies, { now });
  const sendAfter = nextAllowedSendTime(c.scheduledAt && c.scheduledAt > now ? c.scheduledAt : now, SALON_TZ);
  const texts = new Map<LanguageCode, string>();
  const textFor = (l: LanguageCode) => {
    if (!texts.has(l)) texts.set(l, composePromo(input.bodies[l] ?? input.bodies["en-US"], l));
    return texts.get(l)!;
  };
  const data = aud.recipients.map((r) => {
    const text = textFor(r.language);
    const info = countSegments(text);
    return {
      campaignId: id,
      customerId: r.customerId,
      phone: r.phone,
      name: r.name,
      language: r.language,
      body: text,
      segments: info.segments,
      encoding: info.encoding,
      consentType: r.decision.ok ? r.decision.basis : r.consent.status,
      status: r.decision.ok ? "queued" : "skipped",
      skipReason: r.decision.ok ? null : r.decision.reason,
      dryRun: smsMode() === "outbox",
      sendAfter,
    };
  });
  await prisma.$transaction([
    prisma.campaignMessage.createMany({ data }),
    prisma.campaign.update({ where: { id }, data: { status: "sending", startedAt: now, dryRun: smsMode() === "outbox" } }),
  ]);
  return { queued: data.filter((d) => d.status === "queued").length, skipped: data.filter((d) => d.status === "skipped").length };
}

export interface ProcessResult {
  mode: "live" | "outbox";
  campaignsStarted: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
  remaining: number;
  inSendWindow: boolean;
  nextAllowed: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One pass of the send queue. Safe to call often (Vercel Cron, a curl loop, or
 * after "Send now"): it starts campaigns whose time has come, then sends up to
 * `limit` due texts, spacing live sends by SMS_SEND_INTERVAL_MS.
 */
export async function processQueue(opts: { now?: Date; limit?: number; intervalMs?: number } = {}): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? Number(process.env.SMS_SEND_BATCH ?? 50);
  const intervalMs = opts.intervalMs ?? Number(process.env.SMS_SEND_INTERVAL_MS ?? 250);
  const mode = assertPromoSenderReady();
  const settings = await getSmsSettings();

  const due = await prisma.campaign.findMany({ where: { status: "scheduled", scheduledAt: { lte: now } }, orderBy: { scheduledAt: "asc" } });
  for (const c of due) await queueCampaign(c.id, now);

  const window = inSendWindow(now, SALON_TZ);
  const result: ProcessResult = {
    mode,
    campaignsStarted: due.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    remaining: 0,
    inSendWindow: window,
    nextAllowed: window ? null : toZonedISO(nextAllowedSendTime(now, SALON_TZ), SALON_TZ),
  };

  if (!window) {
    // Quiet hours: push anything due to the next allowed time instead of sending.
    const next = nextAllowedSendTime(now, SALON_TZ);
    const r = await prisma.campaignMessage.updateMany({
      where: { status: "queued", isTest: false, sendAfter: { lte: now } },
      data: { sendAfter: next },
    });
    result.deferred = r.count;
  } else {
    const batch = await prisma.campaignMessage.findMany({
      where: { status: "queued", isTest: false, sendAfter: { lte: now } },
      orderBy: [{ sendAfter: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
    for (const [i, m] of batch.entries()) {
      const check = await recheckBeforeSend(m.phone, m.customerId, m.consentType, settings.frequencyCap, now);
      if (!check.ok) {
        await prisma.campaignMessage.update({ where: { id: m.id }, data: { status: "skipped", skipReason: check.reason } });
        result.skipped++;
        continue;
      }
      const lang = isLanguageCode(m.language) ? m.language : DEFAULT_LANGUAGE;
      assertCompliant(m.body, lang);
      const r = await deliver(m.id, m.phone, m.body, mode, now);
      if (r) result.sent++;
      else result.failed++;
      if (mode === "live" && i < batch.length - 1 && intervalMs > 0) await sleep(intervalMs);
    }
  }

  // Finish campaigns with nothing left to send.
  const sending = await prisma.campaign.findMany({ where: { status: "sending" }, select: { id: true } });
  for (const c of sending) {
    const left = await prisma.campaignMessage.count({ where: { campaignId: c.id, status: "queued", isTest: false } });
    if (left === 0) await prisma.campaign.update({ where: { id: c.id }, data: { status: "sent", completedAt: now } });
  }
  result.remaining = await prisma.campaignMessage.count({ where: { status: "queued", isTest: false } });
  return result;
}

async function recheckBeforeSend(
  phone: string,
  customerId: string | null,
  basis: string | null,
  cap: FrequencyCap,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: SkipReason }> {
  const row = await prisma.smsConsent.findUnique({ where: { phone } });
  const paid = customerId ? (await lastPaidVisits(prisma, [customerId])).get(customerId) ?? null : null;
  const eff = effectiveConsent(row, paid, now);
  const decision = consentDecision(eff, basis === "implied", !!paid);
  if (!decision.ok) return decision;
  const sent = await prisma.campaignMessage.findMany({
    where: { phone, isTest: false, status: { in: ["sent", "delivered"] }, sentAt: { gt: new Date(now.getTime() - cap.days * 86400000) } },
    select: { sentAt: true },
  });
  if (!underFrequencyCap(sent.map((s) => s.sentAt!), now, cap)) return { ok: false, reason: "frequency_cap" };
  return { ok: true };
}

export function assertPromoSenderReady(): "live" | "outbox" {
  const mode = smsMode();
  if (mode === "blocked") {
    throw new HttpError(
      409,
      "PROMO_SENDER_MISSING",
      "Set TWILIO_PROMO_MESSAGING_SERVICE_SID or TWILIO_PROMO_FROM (a different sender from appointment texts) before sending promotions",
    );
  }
  return mode;
}

async function deliver(id: string, phone: string, body: string, mode: "live" | "outbox", now: Date): Promise<boolean> {
  if (mode === "outbox") {
    await prisma.campaignMessage.update({ where: { id }, data: { status: "sent", sentAt: now, dryRun: true } });
    return true;
  }
  const base = publicBaseUrl();
  const r = await twilioSend("promo", phone, body, { statusCallback: base ? `${base}/api/sms/status` : undefined });
  if (r.ok) {
    await prisma.campaignMessage.update({ where: { id }, data: { status: "sent", sentAt: now, twilioSid: r.sid, dryRun: false } });
    return true;
  }
  await prisma.campaignMessage.update({ where: { id }, data: { status: "failed", failedAt: now, error: r.error ?? "send failed", dryRun: false } });
  return false;
}

/** Sends the campaign text (in one language) to the owner's phone. Ignores audience and quiet hours; still adds the footer. */
export async function sendTest(id: string, opts: { phone?: unknown; language?: unknown; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "CAMPAIGN_NOT_FOUND");
  const settings = await getSmsSettings();
  const phone = toE164(opts.phone) ?? settings.ownerPhone;
  if (!phone) throw new HttpError(400, "NO_TEST_PHONE", "Set the owner's phone for test sends");
  const bodies = parseBodies(c.bodies);
  const lang = isLanguageCode(opts.language) && bodies[opts.language]?.trim() ? opts.language : "en-US";
  const text = composePromo(bodies[lang]!, lang);
  const info = countSegments(text);
  const mode = assertPromoSenderReady();
  const m = await prisma.campaignMessage.create({
    data: {
      campaignId: id, phone, name: "Test (owner)", language: lang, body: text, segments: info.segments, encoding: info.encoding,
      isTest: true, status: "queued", dryRun: mode === "outbox", sendAfter: now,
    },
  });
  await deliver(m.id, phone, text, mode, now);
  return prisma.campaignMessage.findUniqueOrThrow({ where: { id: m.id } });
}

// ---------------------------------------------------------------- results

export const ATTRIBUTION_DAYS = 14;

export interface CampaignStats {
  recipients: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  optOuts: number;
  bookings: number;
  bookedValueCAD: number;
  segments: number;
  costUSD: number;
}

export async function campaignStats(campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  const msgs = await prisma.campaignMessage.findMany({
    where: { campaignId: { in: campaignIds }, isTest: false },
    select: { campaignId: true, status: true, skipReason: true, phone: true, customerId: true, sentAt: true, segments: true },
  });
  const sentMsgs = msgs.filter((m) => m.sentAt && (m.status === "sent" || m.status === "delivered" || m.status === "failed"));
  const phones = [...new Set(sentMsgs.map((m) => m.phone))];
  const custIds = [...new Set(sentMsgs.map((m) => m.customerId).filter(Boolean) as string[])];
  const [optOuts, bookings] = await Promise.all([
    prisma.consentEvent.findMany({ where: { phone: { in: phones }, type: "withdrawn" }, select: { phone: true, createdAt: true } }),
    prisma.booking.findMany({
      where: { customerId: { in: custIds }, status: { not: "cancelled" } },
      select: { customerId: true, createdAt: true, priceCAD: true },
    }),
  ]);
  const per = costPerSegmentUSD();
  const out = new Map<string, CampaignStats>();
  for (const id of campaignIds) {
    const mine = msgs.filter((m) => m.campaignId === id);
    const s: CampaignStats = {
      recipients: mine.length,
      queued: mine.filter((m) => m.status === "queued").length,
      sent: mine.filter((m) => m.status === "sent" || m.status === "delivered").length,
      delivered: mine.filter((m) => m.status === "delivered").length,
      failed: mine.filter((m) => m.status === "failed").length,
      skipped: mine.filter((m) => m.status === "skipped").length,
      skippedByReason: {},
      optOuts: 0,
      bookings: 0,
      bookedValueCAD: 0,
      segments: 0,
      costUSD: 0,
    };
    for (const m of mine) if (m.status === "skipped" && m.skipReason) s.skippedByReason[m.skipReason] = (s.skippedByReason[m.skipReason] ?? 0) + 1;
    for (const m of mine) {
      if (!m.sentAt || m.status === "skipped" || m.status === "queued") continue;
      s.segments += m.segments;
      const end = m.sentAt.getTime() + ATTRIBUTION_DAYS * 86400000;
      if (optOuts.some((o) => o.phone === m.phone && o.createdAt >= m.sentAt! && o.createdAt.getTime() <= end)) s.optOuts++;
      const b = bookings.filter((x) => x.customerId === m.customerId && x.createdAt >= m.sentAt! && x.createdAt.getTime() <= end);
      if (b.length) {
        s.bookings += b.length;
        s.bookedValueCAD += b.reduce((t, x) => t + x.priceCAD, 0);
      }
    }
    s.costUSD = Math.round(s.segments * per * 100) / 100;
    out.set(id, s);
  }
  return out;
}

/** Per-recipient attribution for the results table. */
export async function recipientOutcomes(campaignId: string) {
  const msgs = await prisma.campaignMessage.findMany({
    where: { campaignId },
    orderBy: [{ isTest: "desc" }, { status: "asc" }, { name: "asc" }],
  });
  const custIds = [...new Set(msgs.map((m) => m.customerId).filter(Boolean) as string[])];
  const phones = [...new Set(msgs.map((m) => m.phone))];
  const [bookings, optOuts] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId: { in: custIds }, status: { not: "cancelled" } },
      include: { service: { select: { name: true } } },
    }),
    prisma.consentEvent.findMany({ where: { phone: { in: phones }, type: "withdrawn" } }),
  ]);
  return msgs.map((m) => {
    const end = m.sentAt ? m.sentAt.getTime() + ATTRIBUTION_DAYS * 86400000 : 0;
    const booked = m.sentAt
      ? bookings.filter((b) => b.customerId === m.customerId && b.createdAt >= m.sentAt! && b.createdAt.getTime() <= end)
      : [];
    const optOut = m.sentAt ? optOuts.find((o) => o.phone === m.phone && o.createdAt >= m.sentAt! && o.createdAt.getTime() <= end) : undefined;
    return {
      id: m.id,
      customerId: m.customerId,
      name: m.name,
      phone: m.phone,
      language: m.language,
      body: m.body,
      segments: m.segments,
      encoding: m.encoding,
      consentType: m.consentType,
      status: m.status,
      skipReason: m.skipReason,
      error: m.error,
      dryRun: m.dryRun,
      isTest: m.isTest,
      sentAt: m.sentAt?.toISOString() ?? null,
      deliveredAt: m.deliveredAt?.toISOString() ?? null,
      booked: booked.map((b) => ({ id: b.id, service: b.service.name, start: toZonedISO(b.start, SALON_TZ), priceCAD: b.priceCAD })),
      optedOutAt: optOut?.createdAt.toISOString() ?? null,
      optOutText: optOut?.wording ?? null,
    };
  });
}

export function serializeCampaign(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    bodies: parseBodies(c.bodies),
    audience: parseAudience(c.audience),
    includeImplied: c.includeImplied,
    status: c.status,
    requestedAt: c.requestedAt ? toZonedISO(c.requestedAt, SALON_TZ) : null,
    scheduledAt: c.scheduledAt ? toZonedISO(c.scheduledAt, SALON_TZ) : null,
    startedAt: c.startedAt ? toZonedISO(c.startedAt, SALON_TZ) : null,
    completedAt: c.completedAt ? toZonedISO(c.completedAt, SALON_TZ) : null,
    dryRun: c.dryRun,
    createdAt: toZonedISO(c.createdAt, SALON_TZ),
  };
}
