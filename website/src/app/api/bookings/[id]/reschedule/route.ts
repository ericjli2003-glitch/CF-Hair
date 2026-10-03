import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { rescheduleBooking } from "@/lib/bookings";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/bookings/[id]/reschedule">) => {
  const who = await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  return json({ booking: await rescheduleBooking(id, body, { privileged: who === "admin" }) });
});
