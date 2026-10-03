import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./api";
import {
  blocksFor,
  computeSlots,
  dayWindow,
  isAligned,
  isStaffFree,
  qualifiedStaff,
  rankStaff,
  type BusyBlock,
  type StaffLite,
} from "./availability";
import { upsertCustomer } from "./customers";
import { toE164 } from "./phone";
import { salon, SALON_TZ, formatPhoneDisplay } from "./salon";
import { sendSms } from "./sms";
import { addDays, dateKeyOf, isDateKey, parseStart, toZonedISO, zonedTime } from "./time";

export const BOOKING_SOURCES = ["web", "phone", "walk-in", "admin"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
export const BOOKING_STATUSES = ["confirmed", "cancelled", "completed", "no-show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const bookingInclude = {
  service: true,
  staff: true,
  customer: true,
} satisfies Prisma.BookingInclude;
type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export interface BookingView {
  id: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  start: string;
  end: string;
  status: BookingStatus;
  customer: { name: string; phone: string; email: string | null };
  source: BookingSource;
  notes: string | null;
  createdAt: string;
  priceCAD: number;
  durationMin: number;
  customerId: string;
}

export function serializeBooking(b: BookingRow): BookingView {
  return {
    id: b.id,
    serviceId: b.serviceId,
    serviceName: b.service.name,
    staffId: b.staffId,
    staffName: b.staff.name,
    start: toZonedISO(b.start, SALON_TZ),
    end: toZonedISO(b.end, SALON_TZ),
    status: b.status as BookingStatus,
    customer: { name: b.customer.name, phone: b.customer.phone, email: b.customer.email },
    source: b.source as BookingSource,
    notes: b.notes,
    createdAt: toZonedISO(b.createdAt, SALON_TZ),
    priceCAD: b.priceCAD,
    durationMin: Math.round((b.end.getTime() - b.start.getTime()) / 60000),
    customerId: b.customerId,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function loadStaff(): Promise<StaffLite[]> {
  const rows = await prisma.staff.findMany({
    where: { active: true },
    include: { services: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((s) => ({ id: s.id, name: s.name, serviceIds: s.services.map((x) => x.serviceId) }));
}

async function loadBusy(staffIds: string[], from: Date, to: Date): Promise<BusyBlock[]> {
  const rows = await prisma.booking.findMany({
    where: { staffId: { in: staffIds }, status: { not: "cancelled" }, start: { lt: to }, end: { gt: from } },
    select: { id: true, staffId: true, start: true, end: true },
  });
  return rows;
}

function dayBounds(dateKey: string): { from: Date; to: Date } {
  return { from: zonedTime(dateKey, 0, SALON_TZ), to: zonedTime(addDays(dateKey, 1), 0, SALON_TZ) };
}

async function getService(serviceId: unknown) {
  if (typeof serviceId !== "string") throw new HttpError(400, "INVALID_SERVICE", "serviceId is required");
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.active) throw new HttpError(404, "SERVICE_NOT_FOUND");
  return service;
}

export async function getAvailability(params: {
  serviceId: unknown;
  date: unknown;
  staffId?: unknown;
  now?: Date;
}) {
  const service = await getService(params.serviceId);
  if (!isDateKey(params.date)) throw new HttpError(400, "INVALID_DATE", "date must be YYYY-MM-DD");
  const date = params.date;
  const staffId = typeof params.staffId === "string" && params.staffId && params.staffId !== "any" ? params.staffId : undefined;
  const staff = await loadStaff();
  if (staffId && !staff.some((s) => s.id === staffId)) throw new HttpError(404, "STAFF_NOT_FOUND");
  const { from, to } = dayBounds(date);
  const busy = await loadBusy(qualifiedStaff(staff, service.id).map((s) => s.id), from, to);
  const slots = computeSlots({
    date,
    serviceId: service.id,
    durationMin: service.durationMin,
    staff,
    bookings: busy,
    hours: salon.hours,
    tz: SALON_TZ,
    now: params.now ?? new Date(),
    staffId,
  });
  return {
    date,
    slots: slots.map((s) => ({
      start: toZonedISO(s.start, SALON_TZ),
      end: toZonedISO(s.end, SALON_TZ),
      staffId: s.staffId,
      staffName: s.staffName,
    })),
  };
}

interface TimeChoice {
  start: Date;
  end: Date;
  candidates: StaffLite[];
}

/** Validates a requested time and returns the stylists who could take it, best first. */
async function resolveTime(opts: {
  serviceId: string;
  durationMin: number;
  start: unknown;
  staffId?: unknown;
  privileged: boolean;
  now: Date;
  excludeBookingId?: string;
  preferStaffId?: string;
}): Promise<TimeChoice> {
  const start = opts.start instanceof Date ? opts.start : parseStart(opts.start, SALON_TZ);
  if (!start) throw new HttpError(400, "INVALID_START", "start must be an ISO 8601 date-time");
  if (!isAligned(start)) throw new HttpError(400, "INVALID_START", "start must be on a 15-minute boundary");
  const end = new Date(start.getTime() + opts.durationMin * 60000);

  const staff = await loadStaff();
  let candidates = qualifiedStaff(staff, opts.serviceId);
  if (opts.staffId !== undefined && opts.staffId !== null && opts.staffId !== "" && opts.staffId !== "any") {
    if (typeof opts.staffId !== "string" || !staff.some((s) => s.id === opts.staffId)) {
      throw new HttpError(404, "STAFF_NOT_FOUND");
    }
    candidates = candidates.filter((s) => s.id === opts.staffId);
    if (!candidates.length) throw new HttpError(400, "STAFF_NOT_QUALIFIED", "That stylist does not offer this service");
  }
  if (!candidates.length) throw new HttpError(400, "NO_STAFF", "No stylist offers this service");

  if (!opts.privileged) {
    if (start.getTime() <= opts.now.getTime()) throw new HttpError(400, "START_IN_PAST");
    const win = dayWindow(dateKeyOf(start, SALON_TZ), salon.hours, SALON_TZ);
    if (!win || start < win.open || end > win.close) {
      throw new HttpError(400, "OUTSIDE_HOURS", "That time is outside opening hours");
    }
  }

  const { from, to } = dayBounds(dateKeyOf(start, SALON_TZ));
  const busy = await loadBusy(
    candidates.map((s) => s.id),
    new Date(Math.min(from.getTime(), start.getTime())),
    new Date(Math.max(to.getTime(), end.getTime())),
  );
  let ranked = rankStaff(candidates, busy, opts.excludeBookingId);
  if (opts.preferStaffId) {
    ranked = [...ranked.filter((s) => s.id === opts.preferStaffId), ...ranked.filter((s) => s.id !== opts.preferStaffId)];
  }
  const free = ranked.filter((s) => isStaffFree(s.id, start, end, busy, opts.excludeBookingId));
  if (!free.length) throw new HttpError(409, "SLOT_TAKEN", "That time is no longer available");
  return { start, end, candidates: free };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createBooking(
  body: Record<string, unknown>,
  opts: { privileged?: boolean; now?: Date; notify?: boolean } = {},
): Promise<BookingView> {
  const now = opts.now ?? new Date();
  const source = (body.source ?? "web") as BookingSource;
  if (!BOOKING_SOURCES.includes(source)) throw new HttpError(400, "INVALID_SOURCE");

  const cust = (body.customer ?? {}) as Record<string, unknown>;
  const name = typeof cust.name === "string" ? cust.name.trim() : "";
  if (!name || name.length > 120) throw new HttpError(400, "INVALID_CUSTOMER", "customer.name is required");
  const phone = toE164(cust.phone);
  if (!phone) throw new HttpError(400, "INVALID_PHONE", "customer.phone must be a valid phone number");
  const email = typeof cust.email === "string" && cust.email.trim() ? cust.email.trim().toLowerCase() : null;
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, "INVALID_EMAIL");
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null;

  const service = await getService(body.serviceId);
  const choice = await resolveTime({
    serviceId: service.id,
    durationMin: service.durationMin,
    start: body.start,
    staffId: body.staffId,
    privileged: !!opts.privileged,
    now,
  });

  const customer = await upsertCustomer(prisma, { phone, name, email });

  for (const staff of choice.candidates) {
    const id = `bk_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    try {
      await prisma.$transaction([
        prisma.booking.create({
          data: {
            id,
            serviceId: service.id,
            staffId: staff.id,
            customerId: customer.id,
            start: choice.start,
            end: choice.end,
            status: "confirmed",
            source,
            notes,
            priceCAD: service.priceCAD,
          },
        }),
        prisma.slotLock.createMany({
          data: blocksFor(choice.start, choice.end).map((slotStart) => ({ staffId: staff.id, slotStart, bookingId: id })),
        }),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) continue; // someone else got this stylist first; try the next one
      throw e;
    }
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
    const view = serializeBooking(row);
    if (opts.notify !== false) void sendSms(phone, confirmationText(view));
    return view;
  }
  throw new HttpError(409, "SLOT_TAKEN", "That time is no longer available");
}

function confirmationText(b: BookingView): string {
  const d = new Date(b.start);
  const when = d.toLocaleString("en-CA", {
    timeZone: SALON_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${salon.name}: you're booked for ${b.serviceName} with ${b.staffName} on ${when}. Questions or changes: ${formatPhoneDisplay(salon.phone)}.`;
}

export async function getBooking(id: string): Promise<BookingView | null> {
  const row = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  return row ? serializeBooking(row) : null;
}

export async function setBookingStatus(id: string, status: BookingStatus): Promise<BookingView> {
  if (!BOOKING_STATUSES.includes(status)) throw new HttpError(400, "INVALID_STATUS");
  const row = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND");
  if (row.status === status) return serializeBooking(row);

  if (status === "cancelled") {
    await prisma.$transaction([
      prisma.booking.update({ where: { id }, data: { status } }),
      prisma.slotLock.deleteMany({ where: { bookingId: id } }),
    ]);
  } else if (row.status === "cancelled") {
    // Reinstating: the time must still be free.
    try {
      await prisma.$transaction([
        prisma.booking.update({ where: { id }, data: { status } }),
        prisma.slotLock.createMany({
          data: blocksFor(row.start, row.end).map((slotStart) => ({ staffId: row.staffId, slotStart, bookingId: id })),
        }),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, "SLOT_TAKEN", "That time has since been booked");
      throw e;
    }
  } else {
    await prisma.booking.update({ where: { id }, data: { status } });
  }
  return (await getBooking(id))!;
}

export async function cancelBooking(id: string): Promise<BookingView> {
  const row = await prisma.booking.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND");
  if (row.status === "completed" || row.status === "no-show") {
    throw new HttpError(409, "NOT_CANCELLABLE", `Booking is already ${row.status}`);
  }
  return setBookingStatus(id, "cancelled");
}

export async function rescheduleBooking(
  id: string,
  body: Record<string, unknown>,
  opts: { privileged?: boolean; now?: Date } = {},
): Promise<BookingView> {
  const now = opts.now ?? new Date();
  const row = await prisma.booking.findUnique({ where: { id }, include: { service: true } });
  if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND");
  if (row.status !== "confirmed") throw new HttpError(409, "NOT_RESCHEDULABLE", `Booking is ${row.status}`);

  const choice = await resolveTime({
    serviceId: row.serviceId,
    durationMin: row.service.durationMin,
    start: body.start,
    staffId: body.staffId,
    privileged: !!opts.privileged,
    now,
    excludeBookingId: id,
    preferStaffId: row.staffId,
  });

  for (const staff of choice.candidates) {
    try {
      await prisma.$transaction([
        prisma.slotLock.deleteMany({ where: { bookingId: id } }),
        prisma.booking.update({ where: { id }, data: { start: choice.start, end: choice.end, staffId: staff.id } }),
        prisma.slotLock.createMany({
          data: blocksFor(choice.start, choice.end).map((slotStart) => ({ staffId: staff.id, slotStart, bookingId: id })),
        }),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
    return (await getBooking(id))!;
  }
  throw new HttpError(409, "SLOT_TAKEN", "That time is no longer available");
}

export async function lookupUpcoming(phoneInput: unknown, now = new Date()) {
  const phone = toE164(phoneInput);
  if (!phone) throw new HttpError(400, "INVALID_PHONE");
  const customer = await prisma.customer.findUnique({ where: { phone } });
  if (!customer) return { phone, customer: null, bookings: [] as BookingView[] };
  const rows = await prisma.booking.findMany({
    where: { customerId: customer.id, status: "confirmed", end: { gt: now } },
    include: bookingInclude,
    orderBy: { start: "asc" },
  });
  return {
    phone,
    customer: { id: customer.id, name: customer.name, preferredLanguage: customer.preferredLanguage },
    bookings: rows.map(serializeBooking),
  };
}

export async function listBookings(from: Date, to: Date): Promise<BookingView[]> {
  const rows = await prisma.booking.findMany({
    where: { start: { lt: to }, end: { gt: from } },
    include: bookingInclude,
    orderBy: { start: "asc" },
  });
  return rows.map(serializeBooking);
}
