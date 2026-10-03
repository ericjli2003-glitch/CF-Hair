import Link from "next/link";
import { BookingsTable } from "@/components/admin/BookingsTable";
import { listBookings, type BookingView } from "@/lib/bookings";
import { SALON_TZ } from "@/lib/salon";
import { addDays, dateKeyOf, zonedTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "today", label: "Today" },
  { key: "past", label: "Past 30 days" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;

export default async function BookingsPage(props: PageProps<"/admin/bookings">) {
  const sp = await props.searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.filter)?.key ?? "upcoming") as (typeof FILTERS)[number]["key"];
  const now = new Date();
  const today = dateKeyOf(now, SALON_TZ);
  const z = (d: string) => zonedTime(d, 0, SALON_TZ);

  let rows: BookingView[];
  if (filter === "today") rows = await listBookings(z(today), z(addDays(today, 1)));
  else if (filter === "upcoming") rows = (await listBookings(now, z(addDays(today, 90)))).filter((b) => b.status === "confirmed");
  else if (filter === "past") rows = (await listBookings(z(addDays(today, -30)), now)).reverse();
  else if (filter === "cancelled") rows = (await listBookings(z(addDays(today, -180)), z(addDays(today, 180)))).filter((b) => b.status === "cancelled");
  else rows = (await listBookings(z(addDays(today, -180)), z(addDays(today, 180)))).reverse();

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="display text-[2.8rem] leading-none">Bookings</h1>
        <Link href="/admin/new" className="btn-clay !px-5 !py-2.5 !normal-case !tracking-normal !text-sm">
          + New booking
        </Link>
      </div>
      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/bookings?filter=${f.key}`}
            className={`shrink-0 rounded-full px-4 py-2 text-sm ring-1 ${filter === f.key ? "bg-ink text-paper ring-ink" : "bg-paper text-ink-soft ring-line"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <BookingsTable rows={rows} today={today} />
    </div>
  );
}
