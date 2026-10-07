import { prisma } from "./db";
import { HttpError } from "./api";
import { isAligned, type BusyBlock } from "./availability";
import { SALON_TZ } from "./salon";
import { parseStart, toZonedISO } from "./time";

export interface TimeOffView {
  id: string;
  /** null: the whole salon. */
  staffId: string | null;
  staffName: string | null;
  start: string;
  end: string;
  reason: string | null;
}

const MAX_DAYS = 31;

function view(r: { id: string; staffId: string | null; start: Date; end: Date; reason: string | null; staff?: { name: string } | null }): TimeOffView {
  return {
    id: r.id,
    staffId: r.staffId,
    staffName: r.staff?.name ?? null,
    start: toZonedISO(r.start, SALON_TZ),
    end: toZonedISO(r.end, SALON_TZ),
    reason: r.reason,
  };
}

/** Time off overlapping [from, to). */
export async function listTimeOff(from: Date, to: Date): Promise<TimeOffView[]> {
  const rows = await prisma.timeOff.findMany({
    where: { start: { lt: to }, end: { gt: from } },
    include: { staff: { select: { name: true } } },
    orderBy: { start: "asc" },
  });
  return rows.map(view);
}

/** Time off as busy blocks for these stylists (whole-salon time off applies to each). */
export async function timeOffBusy(staffIds: string[], from: Date, to: Date): Promise<BusyBlock[]> {
  if (!staffIds.length) return [];
  const rows = await prisma.timeOff.findMany({
    where: { start: { lt: to }, end: { gt: from }, OR: [{ staffId: null }, { staffId: { in: staffIds } }] },
    select: { id: true, staffId: true, start: true, end: true },
  });
  return rows.flatMap((r) =>
    (r.staffId ? [r.staffId] : staffIds).map((staffId) => ({ id: `off:${r.id}`, staffId, start: r.start, end: r.end })),
  );
}

export async function createTimeOff(body: Record<string, unknown>): Promise<{ timeOff: TimeOffView; overlappingBookings: number }> {
  const start = parseStart(body.start, SALON_TZ);
  const end = parseStart(body.end, SALON_TZ);
  if (!start || !end) throw new HttpError(400, "INVALID_TIME", "start and end must be ISO 8601 date-times");
  if (!isAligned(start) || !isAligned(end)) throw new HttpError(400, "INVALID_TIME", "start and end must be on 15-minute boundaries");
  if (end <= start) throw new HttpError(400, "INVALID_TIME", "end must be after start");
  if (end.getTime() - start.getTime() > MAX_DAYS * 86400000) throw new HttpError(400, "INVALID_TIME", `time off can be at most ${MAX_DAYS} days`);

  const rawStaff = body.staffId;
  const staffId = typeof rawStaff === "string" && rawStaff && rawStaff !== "all" ? rawStaff : null;
  if (staffId && !(await prisma.staff.findUnique({ where: { id: staffId } }))) throw new HttpError(404, "STAFF_NOT_FOUND");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 120) || null : null;

  const row = await prisma.timeOff.create({
    data: { staffId, start, end, reason },
    include: { staff: { select: { name: true } } },
  });
  // Bookings already in that time stay booked; the owner is told how many so they can move them.
  const overlappingBookings = await prisma.booking.count({
    where: { status: "confirmed", start: { lt: end }, end: { gt: start }, ...(staffId ? { staffId } : {}) },
  });
  return { timeOff: view(row), overlappingBookings };
}

export async function deleteTimeOff(id: string): Promise<void> {
  const r = await prisma.timeOff.deleteMany({ where: { id } });
  if (!r.count) throw new HttpError(404, "TIME_OFF_NOT_FOUND");
}
