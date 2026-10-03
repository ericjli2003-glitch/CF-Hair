import { NewBookingForm } from "@/components/admin/NewBookingForm";
import { getCatalog } from "@/lib/catalog";
import { SALON_TZ } from "@/lib/salon";
import { dateKeyOf, isDateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function NewBookingPage(props: PageProps<"/admin/new">) {
  const sp = await props.searchParams;
  const { services, staff, categories } = await getCatalog();
  const today = dateKeyOf(new Date(), SALON_TZ);
  const date = typeof sp.date === "string" && isDateKey(sp.date) && sp.date >= today ? sp.date : today;
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="display text-[2.8rem] leading-none">New booking</h1>
      <p className="mt-2 text-ink-soft">For phone calls and walk-ins. The client gets the same confirmation as an online booking.</p>
      <NewBookingForm services={services} staff={staff} categories={categories} initialDate={date} today={today} />
    </div>
  );
}
