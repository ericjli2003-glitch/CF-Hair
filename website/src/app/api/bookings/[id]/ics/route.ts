import { HttpError, handle } from "@/lib/api";
import { getBooking } from "@/lib/bookings";
import { bookingToIcs } from "@/lib/ics";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/bookings/[id]/ics">) => {
  const { id } = await ctx.params;
  const booking = await getBooking(id);
  if (!booking) throw new HttpError(404, "BOOKING_NOT_FOUND");
  return new Response(bookingToIcs(booking), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="cf-hair-${booking.start.slice(0, 10)}.ics"`,
    },
  });
});
