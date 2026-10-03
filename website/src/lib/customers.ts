import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from "./languages";
import { SALON_TZ } from "./salon";
import { dateKeyOf, toZonedISO } from "./time";

type Db = PrismaClient | Prisma.TransactionClient;

export interface MailingAddress {
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export function parseTags(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseAddress(raw: string | null | undefined): MailingAddress | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as MailingAddress) : null;
  } catch {
    return null;
  }
}

/**
 * Creates or updates the customer for a phone number (E.164). New customers inherit
 * the language remembered by the phone agent, and the caller profile is linked.
 */
export async function upsertCustomer(
  db: Db,
  input: { phone: string; name: string; email?: string | null },
) {
  const existing = await db.customer.findUnique({ where: { phone: input.phone } });
  if (existing) {
    return db.customer.update({
      where: { id: existing.id },
      data: { name: input.name || existing.name, email: input.email || existing.email },
    });
  }
  const caller = await db.callerProfile.findUnique({ where: { phone: input.phone } });
  const customer = await db.customer.create({
    data: {
      phone: input.phone,
      name: input.name,
      email: input.email || null,
      preferredLanguage: caller?.preferredLanguage ?? DEFAULT_LANGUAGE,
    },
  });
  if (caller && !caller.customerId) {
    await db.callerProfile.update({ where: { phone: caller.phone }, data: { customerId: customer.id } });
  }
  return customer;
}

/** Sets the preferred language on both the customer and the caller profile for a phone. */
export async function setPreferredLanguageByPhone(phone: string, lang: LanguageCode) {
  await prisma.$transaction([
    prisma.customer.updateMany({ where: { phone }, data: { preferredLanguage: lang } }),
    prisma.callerProfile.updateMany({ where: { phone }, data: { preferredLanguage: lang } }),
  ]);
}

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  mailingAddress: MailingAddress | null;
  firstVisit: string | null;
  lastVisit: string | null;
  visitCount: number;
  favouriteStaffId: string | null;
  birthday: string | null;
  preferredLanguage: LanguageCode;
  lastServiceId: string | null;
  lastServiceName: string | null;
  nextBookingAt: string | null;
  referredBy: string | null;
  tags: string[];
  upcomingCount: number;
  noShowCount: number;
  createdAt: string;
}

function daysUntilBirthday(birthday: string, todayKey: string): number | null {
  const m = birthday.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(todayKey.slice(0, 4));
  for (const y of [year, year + 1]) {
    const key = `${y}-${m[1]}-${m[2]}`;
    const diff = (Date.parse(key) - Date.parse(todayKey)) / 86400000;
    if (diff >= 0) return diff;
  }
  return null;
}

export async function listCustomers(
  filters: { since?: Date | null; tag?: string | null; phone?: string | null; q?: string | null } = {},
  now = new Date(),
): Promise<CustomerSummary[]> {
  const rows = await prisma.customer.findMany({
    where: filters.phone ? { phone: filters.phone } : undefined,
    include: {
      bookings: {
        select: { start: true, end: true, status: true, staffId: true, serviceId: true, service: { select: { name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
  const todayKey = dateKeyOf(now, SALON_TZ);
  const lapsedBefore = new Date(now.getTime() - 90 * 86400000);

  const out: CustomerSummary[] = rows.map((c) => {
    const visits = c.bookings.filter((b) => b.status === "completed").sort((a, b) => +a.start - +b.start);
    const upcoming = c.bookings.filter((b) => b.status === "confirmed" && b.start > now).sort((a, b) => +a.start - +b.start);
    // Most recent completed visit, or a confirmed booking that has already started.
    const lastService = c.bookings
      .filter((b) => b.status === "completed" || (b.status === "confirmed" && b.start <= now))
      .sort((a, b) => +b.start - +a.start)[0];
    const pool = visits.length ? visits : c.bookings.filter((b) => b.status !== "cancelled");
    const counts = new Map<string, number>();
    for (const b of pool) counts.set(b.staffId, (counts.get(b.staffId) ?? 0) + 1);
    let fav: string | null = null;
    let best = 0;
    for (const [k, v] of counts) if (v > best) [fav, best] = [k, v];

    const tags = new Set(parseTags(c.tags));
    const last = visits.at(-1)?.start ?? null;
    if (visits.length === 1) tags.add("new");
    if (visits.length >= 4) tags.add("regular");
    if (last && last < lapsedBefore && upcoming.length === 0) tags.add("lapsed");
    if (upcoming.length) tags.add("upcoming");
    if (c.birthday) {
      const d = daysUntilBirthday(c.birthday, todayKey);
      if (d !== null && d <= 30) tags.add("birthday-soon");
    }
    const lang = isLanguageCode(c.preferredLanguage) ? c.preferredLanguage : DEFAULT_LANGUAGE;
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      mailingAddress: parseAddress(c.mailingAddress),
      firstVisit: visits[0] ? toZonedISO(visits[0].start, SALON_TZ) : null,
      lastVisit: last ? toZonedISO(last, SALON_TZ) : null,
      visitCount: visits.length,
      favouriteStaffId: fav,
      birthday: c.birthday,
      preferredLanguage: lang,
      lastServiceId: lastService?.serviceId ?? null,
      lastServiceName: lastService?.service.name ?? null,
      nextBookingAt: upcoming[0] ? toZonedISO(upcoming[0].start, SALON_TZ) : null,
      referredBy: c.referredBy,
      tags: [...tags],
      upcomingCount: upcoming.length,
      noShowCount: c.bookings.filter((b) => b.status === "no-show").length,
      createdAt: c.createdAt.toISOString(),
    };
  });

  return out.filter((c) => {
    if (filters.since && (!c.lastVisit || new Date(c.lastVisit) < filters.since)) return false;
    if (filters.tag && !c.tags.includes(filters.tag)) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!c.name.toLowerCase().includes(q) && !c.phone.includes(q.replace(/\D/g, "") || "\u0000")) return false;
    }
    return true;
  });
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function customersToCsv(rows: CustomerSummary[], staffNames: Map<string, string>): string {
  const header = [
    "name", "phone", "email", "preferredLanguage", "birthday", "address_line1", "address_line2", "city",
    "province", "postalCode", "country", "firstVisit", "lastVisit", "visitCount", "favouriteStylist",
    "lastServiceId", "lastServiceName", "nextBookingAt", "referredBy", "tags",
  ];
  const lines = [header.join(",")];
  for (const c of rows) {
    const a = c.mailingAddress;
    lines.push(
      [
        c.name, c.phone, c.email, c.preferredLanguage, c.birthday, a?.line1, a?.line2, a?.city, a?.province,
        a?.postalCode, a?.country, c.firstVisit?.slice(0, 10), c.lastVisit?.slice(0, 10), c.visitCount,
        c.favouriteStaffId ? staffNames.get(c.favouriteStaffId) ?? c.favouriteStaffId : "", c.lastServiceId,
        c.lastServiceName, c.nextBookingAt, c.referredBy, c.tags.join(" "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

