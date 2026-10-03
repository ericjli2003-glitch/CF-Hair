import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { setBookingStatus, type BookingStatus } from "@/lib/bookings";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/bookings/[id]/status">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!body || typeof body.status !== "string") throw new HttpError(400, "INVALID_STATUS");
  return json({ booking: await setBookingStatus(id, body.status as BookingStatus) });
});
