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
        <Link href="/admin/new" className="btn-primary">
          New booking
        </Link>
      </div>
      <nav aria-label="Filter bookings" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <li key={f.key}>
              <Link
                href={`/admin/bookings?filter=${f.key}`}
                aria-current={filter === f.key ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-md px-4 text-[0.95rem] ring-1 ${
                  filter === f.key ? "bg-primary font-medium text-paper ring-primary" : "bg-paper text-ink-soft ring-line hover:text-ink hover:ring-primary"
                }`}
              >
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <BookingsTable rows={rows} today={today} />
    </div>
  );
}
