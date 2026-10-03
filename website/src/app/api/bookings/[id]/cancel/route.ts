import { handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { cancelBooking } from "@/lib/bookings";

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/bookings/[id]/cancel">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  return json({ booking: await cancelBooking(id) });
});
