import { NewBookingForm } from "@/components/admin/NewBookingForm";
import { getCatalog } from "@/lib/catalog";
import { SALON_TZ } from "@/lib/salon";
import { dateKeyOf, hhmmToMin, isDateKey, toZonedISO, zonedTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function NewBookingPage(props: PageProps<"/admin/new">) {
  const sp = await props.searchParams;
  const { services, staff, categories } = await getCatalog();
  const today = dateKeyOf(new Date(), SALON_TZ);
  const date = typeof sp.date === "string" && isDateKey(sp.date) && sp.date >= today ? sp.date : today;
  // Filled in when the owner dragged out a time on the calendar.
  const time = typeof sp.time === "string" && /^\d{2}:\d{2}$/.test(sp.time) && hhmmToMin(sp.time) % 15 === 0 ? sp.time : null;
  const initialStart = time && date === sp.date ? toZonedISO(zonedTime(date, hhmmToMin(time), SALON_TZ), SALON_TZ) : null;
  const initialStaffId = typeof sp.staff === "string" && staff.some((s) => s.id === sp.staff) ? sp.staff : undefined;
  const minutes = typeof sp.minutes === "string" ? Number.parseInt(sp.minutes, 10) : NaN;
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="display text-[2.8rem] leading-none">New booking</h1>
      <p className="mt-2 text-ink-soft">For phone calls and walk-ins. The client gets the same confirmation as an online booking.</p>
      <NewBookingForm
        services={services}
        staff={staff}
        categories={categories}
        initialDate={date}
        today={today}
        initialStart={initialStart}
        initialStaffId={initialStaffId}
        initialMinutes={Number.isFinite(minutes) && minutes > 0 ? minutes : undefined}
      />
    </div>
  );
}
