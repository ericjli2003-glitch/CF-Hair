import type { NextRequest } from "next/server";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { isAdminSession, requireAdminOrAgent } from "@/lib/auth";
import { createBooking, listBookings } from "@/lib/bookings";
import { SALON_TZ } from "@/lib/salon";
import { addDays, dateKeyOf, isDateKey, zonedTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  // The owner (admin session) may book walk-ins starting now or outside regular hours.
  const privileged = await isAdminSession();
  const booking = await createBooking(body, { privileged });
  return json({ booking }, 201);
});

/** (admin) List bookings overlapping [from, to). Dates are YYYY-MM-DD in salon time. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const p = req.nextUrl.searchParams;
  const today = dateKeyOf(new Date(), SALON_TZ);
  const from = isDateKey(p.get("from")) ? p.get("from")! : today;
  const to = isDateKey(p.get("to")) ? p.get("to")! : addDays(from, 7);
  const bookings = await listBookings(zonedTime(from, 0, SALON_TZ), zonedTime(addDays(to, 0), 0, SALON_TZ));
  return json({ from, to, bookings });
});
