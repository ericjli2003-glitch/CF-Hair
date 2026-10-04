import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { parseBookingParams } from "@/lib/booking-params";
import { getCatalog } from "@/lib/catalog";
import { getI18n } from "@/lib/i18n/server";
import { salon, SALON_TZ } from "@/lib/salon";
import { dateKeyOf } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book a time" };

export default async function BookPage(props: PageProps<"/book">) {
  const sp = await props.searchParams;
  const { t } = await getI18n();
  const { services, staff, categories } = await getCatalog();
  // ?service=<id> (from a price board row) skips step 1; ?staff=<id> comes from the team page.
  const start = parseBookingParams(sp, services, staff);

  return (
    <div className="frame pb-16 pt-4 md:pt-8">
      <h1 className="display text-[clamp(2.25rem,5vw,3.25rem)]">{t.book.title}</h1>
      <BookingFlow
        services={services}
        staff={staff}
        categories={categories}
        hours={salon.hours}
        today={dateKeyOf(new Date(), SALON_TZ)}
        start={start}
        cancellationHours={salon.policies.cancellationHours}
      />
    </div>
  );
}
