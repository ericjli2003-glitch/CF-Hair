import { HttpError, handle } from "@/lib/api";
import { getBooking } from "@/lib/bookings";
import { isLang } from "@/lib/i18n/dictionary";
import { getLang } from "@/lib/i18n/server";
import { bookingToIcs } from "@/lib/ics";

export const dynamic = "force-dynamic";

/** Calendar file in the language given by ?lang= (en, zh, hk, ko), else the site language cookie. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/bookings/[id]/ics">) => {
  const { id } = await ctx.params;
  const booking = await getBooking(id);
  if (!booking) throw new HttpError(404, "BOOKING_NOT_FOUND");
  const q = new URL(req.url).searchParams.get("lang");
  const lang = isLang(q) ? q : await getLang();
  return new Response(bookingToIcs(booking, lang), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="cf-hair-${booking.start.slice(0, 10)}.ics"`,
    },
  });
});
