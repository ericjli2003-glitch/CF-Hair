// Transactional notices: booking confirmations and reminders. These are not
// commercial messages under CASL, so they never depend on promotional consent and
// never carry promotional content. They go out from the transactional sender
// (TWILIO_TXN_*), never the promo sender, so a STOP to promotions does not stop them.
// If the client replied STOP to the transactional number itself, the carrier blocks
// those texts, so we skip SMS and fall back to email when we have one.
import { prisma } from "./db";
import { salon, SALON_TZ, formatPhoneDisplay } from "./salon";
import { publicBaseUrl, twilioSend, txnMode } from "./sms/twilio";
import { toZonedISO } from "./time";

/** @deprecated kept for older imports; transactional SMS is configured per sender now. */
export function smsEnabled(): boolean {
  return txnMode() === "live";
}

export interface NoticeTarget {
  bookingId?: string;
  phone: string;
  email?: string | null;
  name: string;
}

export interface NoticeResult {
  channel: "sms" | "email" | "none";
  status: "sent" | "dry_run" | "skipped" | "failed";
  reason?: string;
}

function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Minimal email via Resend's HTTP API when RESEND_API_KEY and EMAIL_FROM are set; otherwise logged as a dry run. */
export async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; dryRun: boolean; error?: string }> {
  if (!emailConfigured()) return { ok: true, dryRun: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? { ok: true, dryRun: false } : { ok: false, dryRun: false, error: `email ${res.status}` };
  } catch (e) {
    return { ok: false, dryRun: false, error: (e as Error).message };
  }
}

async function log(kind: string, channel: NoticeResult["channel"], to: string, body: string, status: NoticeResult["status"], reason?: string, bookingId?: string, subject?: string) {
  await prisma.notification.create({ data: { kind, channel, to, body, status, reason: reason ?? null, bookingId: bookingId ?? null, subject: subject ?? null } });
}

/** Marks a phone as opted out of the transactional sender (STOP reply, or Twilio error 21610). */
export async function markTxnOptedOut(phone: string, opts: { wording?: string | null; source: string; actor: "customer" | "system"; detail?: Record<string, unknown> }) {
  const customer = await prisma.customer.findUnique({ where: { phone }, select: { id: true } });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.smsConsent.upsert({
      where: { phone },
      create: { phone, customerId: customer?.id ?? null, status: "none", txnOptedOutAt: now },
      update: { txnOptedOutAt: now },
    });
    await tx.consentEvent.create({
      data: {
        phone, customerId: customer?.id ?? null, type: "txn_opted_out", source: opts.source, actor: opts.actor,
        wording: opts.wording ?? null, detail: opts.detail ? JSON.stringify(opts.detail) : null,
      },
    });
  });
}

export async function clearTxnOptOut(phone: string, opts: { wording?: string | null; detail?: Record<string, unknown> }) {
  const row = await prisma.smsConsent.findUnique({ where: { phone } });
  if (!row?.txnOptedOutAt) return;
  await prisma.$transaction([
    prisma.smsConsent.update({ where: { phone }, data: { txnOptedOutAt: null } }),
    prisma.consentEvent.create({
      data: {
        phone, customerId: row.customerId, type: "txn_resubscribed", source: "keyword", actor: "customer",
        wording: opts.wording ?? null, detail: opts.detail ? JSON.stringify(opts.detail) : null,
      },
    }),
  ]);
}

/**
 * Sends a confirmation or reminder. Text from the transactional sender unless the
 * client opted out of that sender; then email if we have one.
 */
export async function sendNotice(
  kind: "confirmation" | "reminder",
  target: NoticeTarget,
  sms: string,
  email: { subject: string; text: string },
): Promise<NoticeResult> {
  const row = await prisma.smsConsent.findUnique({ where: { phone: target.phone }, select: { txnOptedOutAt: true } });
  const viaEmail = async (reason: string): Promise<NoticeResult> => {
    if (!target.email) {
      await log(kind, "none", target.phone, sms, "skipped", `${reason}; no email on file`, target.bookingId);
      return { channel: "none", status: "skipped", reason };
    }
    const r = await sendEmail(target.email, email.subject, email.text);
    const status = r.dryRun ? "dry_run" : r.ok ? "sent" : "failed";
    await log(kind, "email", target.email, email.text, status, r.error ?? reason, target.bookingId, email.subject);
    return { channel: "email", status, reason };
  };

  if (row?.txnOptedOutAt) return viaEmail("txn_opted_out");
  if (txnMode() === "outbox") {
    await log(kind, "sms", target.phone, sms, "dry_run", "not_configured", target.bookingId);
    return { channel: "sms", status: "dry_run" };
  }
  const base = publicBaseUrl();
  const r = await twilioSend("transactional", target.phone, sms, { statusCallback: base ? `${base}/api/sms/status` : undefined });
  if (r.ok) {
    await log(kind, "sms", target.phone, sms, "sent", undefined, target.bookingId);
    return { channel: "sms", status: "sent" };
  }
  await log(kind, "sms", target.phone, sms, "failed", r.error, target.bookingId);
  if (r.error?.startsWith("21610")) {
    // The client replied STOP to the transactional number at some point: stay in sync and use email.
    await markTxnOptedOut(target.phone, { source: "system", actor: "system", detail: { twilioError: r.error } });
    return viaEmail("txn_opted_out");
  }
  return { channel: "sms", status: "failed", reason: r.error };
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: SALON_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function confirmationText(b: { serviceName: string; staffName: string; start: string }): string {
  return `${salon.name}: you're booked for ${b.serviceName} with ${b.staffName} on ${when(b.start)}. Questions or changes: ${formatPhoneDisplay(salon.phone)}.`;
}

export function reminderText(b: { serviceName: string; staffName: string; start: string }): string {
  return `${salon.name}: reminder of your ${b.serviceName} with ${b.staffName} on ${when(b.start)}. To change it, call ${formatPhoneDisplay(salon.phone)}.`;
}

export const REMINDER_LEAD_HOURS = { min: 18, max: 30 };

/**
 * Sends reminders for confirmed bookings starting 18 to 30 hours from now that have
 * not had one, and were booked at least 12 hours ahead. Run from the cron endpoint.
 */
export async function sendDueReminders(now = new Date()): Promise<{ sent: number; email: number; skipped: number }> {
  const rows = await prisma.booking.findMany({
    where: {
      status: "confirmed",
      reminderSentAt: null,
      start: { gte: new Date(now.getTime() + REMINDER_LEAD_HOURS.min * 3600000), lte: new Date(now.getTime() + REMINDER_LEAD_HOURS.max * 3600000) },
    },
    include: { service: true, staff: true, customer: true },
  });
  const out = { sent: 0, email: 0, skipped: 0 };
  for (const b of rows) {
    if (b.start.getTime() - b.createdAt.getTime() < 12 * 3600000) continue;
    const view = { serviceName: b.service.name, staffName: b.staff.name, start: toZonedISO(b.start, SALON_TZ) };
    const text = reminderText(view);
    const r = await sendNotice(
      "reminder",
      { bookingId: b.id, phone: b.customer.phone, email: b.customer.email, name: b.customer.name },
      text,
      { subject: `Reminder: ${b.service.name} at ${salon.name}`, text: `Hi ${b.customer.name},\n\n${text}\n\n${salon.name}` },
    );
    await prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: now } });
    if (r.channel === "email") out.email++;
    else if (r.status === "skipped") out.skipped++;
    else out.sent++;
  }
  return out;
}
