import Link from "next/link";
import { CalendarView } from "@/components/admin/CalendarView";
import { listBookings } from "@/lib/bookings";
import { prisma } from "@/lib/db";
import { dayLabel, staffColor } from "@/lib/admin-format";
import { DAY_KEYS, salon, SALON_TZ } from "@/lib/salon";
import { addDays, dateKeyOf, hhmmToMin, isDateKey, weekdayOf, zonedTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SchedulePage(props: PageProps<"/admin">) {
  const sp = await props.searchParams;
  const today = dateKeyOf(new Date(), SALON_TZ);
  const view = sp.view === "week" ? "week" : "day";
  const date = typeof sp.date === "string" && isDateKey(sp.date) ? sp.date : today;
  // Weeks start on Monday.
  const weekStart = addDays(date, -((DAY_KEYS.indexOf(weekdayOf(date)) + 7) % 7));
  const from = view === "week" ? weekStart : date;
  const to = addDays(from, view === "week" ? 7 : 1);

  const [bookings, staffRows, newMessages] = await Promise.all([
    listBookings(zonedTime(from, 0, SALON_TZ), zonedTime(to, 0, SALON_TZ)),
    prisma.staff.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.message.count({ where: { status: "new" } }),
  ]);
  const staff = staffRows.map((s, i) => ({ id: s.id, name: s.name, role: s.role, color: staffColor(i) }));

  const opens = DAY_KEYS.map((d) => salon.hours[d]).filter(Boolean).map((h) => hhmmToMin(h!.open));
  const closes = DAY_KEYS.map((d) => salon.hours[d]).filter(Boolean).map((h) => hhmmToMin(h!.close));
  const dayStartMin = opens.length ? Math.min(...opens) : 9 * 60;
  const dayEndMin = closes.length ? Math.max(...closes) : 18 * 60;

  const active = bookings.filter((b) => b.status !== "cancelled");
  const dayBookings = bookings.filter((b) => b.start.slice(0, 10) === date && b.status !== "cancelled");
  const revenue = (view === "week" ? active : dayBookings).filter((b) => b.status !== "no-show").reduce((s, b) => s + b.priceCAD, 0);
  const prev = addDays(date, view === "week" ? -7 : -1);
  const next = addDays(date, view === "week" ? 7 : 1);
  const q = (d: string, v = view) => `/admin?view=${v}&date=${d}`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-mute">{view === "week" ? "Week" : date === today ? "Today" : "Schedule"}</p>
          <h1 className="display mt-1 text-[2.4rem] leading-none sm:text-[2.8rem]">
            {view === "week"
              ? `${dayLabel(from, { month: "short", day: "numeric" })} to ${dayLabel(addDays(to, -1), { month: "short", day: "numeric" })}`
              : dayLabel(date, { weekday: "long", month: "long", day: "numeric" })}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-paper p-1 ring-1 ring-line">
            {(["day", "week"] as const).map((v) => (
              <Link
                key={v}
                href={q(date, v)}
                className={`rounded-full px-4 py-2 text-sm capitalize ${view === v ? "bg-ink text-paper" : "text-ink-soft"}`}
              >
                {v}
              </Link>
            ))}
          </div>
          <div className="flex items-center rounded-full bg-paper p-1 ring-1 ring-line">
            <Link href={q(prev)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-sand" aria-label="Previous">
              ‹
            </Link>
            <Link href={q(today)} className="rounded-full px-3 py-2 text-sm hover:bg-sand">
              Today
            </Link>
            <Link href={q(next)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-sand" aria-label="Next">
              ›
            </Link>
          </div>
          <Link href={`/admin/new?date=${date}`} className="btn-clay !px-5 !py-2.5 !normal-case !tracking-normal !text-sm">
            + New booking
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={view === "week" ? "Appointments this week" : "Appointments"} value={String(view === "week" ? active.length : dayBookings.length)} />
        <Stat label={view === "week" ? "Booked value this week" : "Booked value"} value={`$${revenue.toLocaleString("en-CA")}`} />
        <Stat
          label="Booked online or by phone agent"
          value={String((view === "week" ? active : dayBookings).filter((b) => b.source === "web" || b.source === "phone").length)}
        />
        <Link href="/admin/messages" className="block">
          <Stat label="New callback messages" value={String(newMessages)} accent={newMessages > 0} />
        </Link>
      </div>

      <CalendarView
        view={view}
        days={view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(from, i)) : [date]}
        today={today}
        nowMin={(() => {
          const n = new Date();
          const p = new Intl.DateTimeFormat("en-CA", { timeZone: SALON_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(n);
          return hhmmToMin(p);
        })()}
        staff={staff}
        bookings={bookings}
        dayStartMin={dayStartMin}
        dayEndMin={dayEndMin}
        closedDays={DAY_KEYS.filter((d) => !salon.hours[d])}
        openBookingId={typeof sp.booking === "string" ? sp.booking : undefined}
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ring-1 ${accent ? "bg-clay text-paper ring-clay" : "bg-paper ring-line"}`}>
      <p className={`text-[0.7rem] uppercase tracking-[0.14em] ${accent ? "text-paper/75" : "text-mute"}`}>{label}</p>
      <p className="display mt-1 text-[2rem] leading-none">{value}</p>
    </div>
  );
}
