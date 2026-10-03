import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { getBooking } from "@/lib/bookings";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/bookings/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const booking = await getBooking(id);
  if (!booking) throw new HttpError(404, "BOOKING_NOT_FOUND");
  return json({ booking });
});
