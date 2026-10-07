import type { NextRequest } from "next/server";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { SALON_TZ } from "@/lib/salon";
import { createTimeOff, listTimeOff } from "@/lib/time-off";
import { addDays, dateKeyOf, isDateKey, zonedTime } from "@/lib/time";

export const dynamic = "force-dynamic";

/** (admin) Block time for a stylist, or the whole salon with no staffId. */
export const POST = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  return json(await createTimeOff(body), 201);
});

/** (admin) Time off overlapping [from, to). Dates are YYYY-MM-DD in salon time. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const p = req.nextUrl.searchParams;
  const from = isDateKey(p.get("from")) ? p.get("from")! : dateKeyOf(new Date(), SALON_TZ);
  const to = isDateKey(p.get("to")) ? p.get("to")! : addDays(from, 7);
  return json({ from, to, timeOff: await listTimeOff(zonedTime(from, 0, SALON_TZ), zonedTime(to, 0, SALON_TZ)) });
});
