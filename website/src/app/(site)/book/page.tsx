import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { getCatalog } from "@/lib/catalog";
import { getI18n } from "@/lib/i18n/server";
import { salon, SALON_TZ } from "@/lib/salon";
import { dateKeyOf } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book online" };

export default async function BookPage(props: PageProps<"/book">) {
  const sp = await props.searchParams;
  const { t } = await getI18n();
  const { services, staff, categories } = await getCatalog();
  const initialService = typeof sp.service === "string" && services.some((s) => s.id === sp.service) ? sp.service : undefined;
  const initialStaff = typeof sp.staff === "string" && staff.some((s) => s.id === sp.staff) ? sp.staff : undefined;

  return (
    <div className="container-x pb-24 pt-10 md:pt-14">
      <p className="eyebrow">{t.book.eyebrow}</p>
      <h1 className="display mt-4 text-[clamp(2.8rem,7vw,5rem)]">{t.book.title}</h1>
      <BookingFlow
        services={services}
        staff={staff}
        categories={categories}
        hours={salon.hours}
        today={dateKeyOf(new Date(), SALON_TZ)}
        initialServiceId={initialService}
        initialStaffId={initialStaff}
        cancellationHours={salon.policies.cancellationHours}
      />
    </div>
  );
}
