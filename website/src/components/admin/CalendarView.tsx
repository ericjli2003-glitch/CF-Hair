"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BookingView } from "@/lib/bookings";
import { dayLabel, hhmm, phonePretty, SOURCE_LABEL, STATUS_STYLES, time12 } from "@/lib/admin-format";
import { hhmmToMin, weekdayOf } from "@/lib/time";
import { StatusButtons } from "./StatusActions";

interface StaffInfo {
  id: string;
  name: string;
  role: string;
  color: string;
}

const ROW_PX = 22; // height of a 15-minute row

export function CalendarView(props: {
  view: "day" | "week";
  days: string[];
  today: string;
  nowMin: number;
  staff: StaffInfo[];
  bookings: BookingView[];
  dayStartMin: number;
  dayEndMin: number;
  closedDays: string[];
}) {
  const { view, days, staff, bookings, dayStartMin, dayEndMin } = props;
  const [selected, setSelected] = useState<BookingView | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);
  const colorOf = useMemo(() => new Map(staff.map((s) => [s.id, s.color])), [staff]);

  const rows = (dayEndMin - dayStartMin) / 15;
  const height = rows * ROW_PX;
  const hours: number[] = [];
  for (let m = dayStartMin; m <= dayEndMin; m += 60) hours.push(m);

  const visible = bookings.filter((b) => (showCancelled || b.status !== "cancelled") && !hidden.has(b.staffId));

  // Columns: day view = one per stylist; week view = one per day.
  const columns =
    view === "day"
      ? staff.filter((s) => !hidden.has(s.id)).map((s) => ({ key: s.id, title: s.name, sub: s.role, day: days[0], staffId: s.id }))
      : days.map((d) => ({ key: d, title: dayLabel(d, { weekday: "short" }), sub: dayLabel(d, { month: "short", day: "numeric" }), day: d, staffId: undefined as string | undefined }));

  const top = (iso: string) => ((Math.max(hhmmToMin(hhmm(iso)), dayStartMin) - dayStartMin) / 15) * ROW_PX;
  const blockHeight = (b: BookingView) => Math.max(ROW_PX * 1.6, (b.durationMin / 15) * ROW_PX - 3);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        {staff.map((s) => {
          const off = hidden.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                const n = new Set(hidden);
                if (off) n.delete(s.id);
                else n.add(s.id);
                setHidden(n);
              }}
              className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-sm ring-1 transition ${off ? "bg-transparent text-mute ring-line" : "bg-paper ring-line"}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: off ? "transparent" : s.color, border: `1.5px solid ${s.color}` }} />
              {s.name}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="h-4 w-4 accent-[#a2532f]" />
          Show cancelled
        </label>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl bg-paper ring-1 ring-line">
        <div className="min-w-[640px]">
          {/* Column headers */}
          <div className="sticky top-0 z-10 grid border-b border-line bg-paper" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(0, 1fr))` }}>
            <div />
            {columns.map((c) => {
              const isToday = c.day === props.today && view === "week";
              const closed = props.closedDays.includes(weekdayOf(c.day));
              const s = staff.find((x) => x.id === c.staffId);
              return (
                <div key={c.key} className={`border-l border-line px-3 py-3 ${isToday ? "bg-clay/5" : ""}`}>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {s && <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />}
                    {c.title}
                    {isToday && <span className="rounded-full bg-clay px-2 py-0.5 text-[0.6rem] uppercase tracking-wider text-paper">Today</span>}
                  </p>
                  <p className="text-xs text-mute">{closed ? "Closed" : c.sub}</p>
                </div>
              );
            })}
          </div>

          {/* Grid */}
          <div className="relative grid pb-4" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(0, 1fr))`, height: height + 16 }}>
            <div className="relative">
              {hours.map((m) => (
                <span key={m} className={`absolute right-2 text-[0.7rem] ${m === dayStartMin ? "translate-y-0.5" : "-translate-y-1/2"} tabular-nums text-mute`} style={{ top: ((m - dayStartMin) / 15) * ROW_PX }}>
                  {`${(Math.floor(m / 60) % 12) || 12}${m / 60 >= 12 ? "pm" : "am"}`}
                </span>
              ))}
            </div>
            {columns.map((c) => {
              const colBookings = visible.filter((b) => b.start.slice(0, 10) === c.day && (!c.staffId || b.staffId === c.staffId));
              const isToday = c.day === props.today;
              // In week view, stack overlapping bookings for different stylists side by side.
              const lanes = new Map<string, { lane: number; of: number }>();
              if (view === "week") {
                const sorted = [...colBookings].sort((a, b) => a.start.localeCompare(b.start));
                const groups: BookingView[][] = [];
                for (const b of sorted) {
                  const g = groups.at(-1);
                  if (g && g.some((x) => x.end > b.start)) g.push(b);
                  else groups.push([b]);
                }
                for (const g of groups) {
                  const laneEnds: string[] = [];
                  const assigned = g.map((b) => {
                    let lane = laneEnds.findIndex((e) => e <= b.start);
                    if (lane === -1) {
                      lane = laneEnds.length;
                      laneEnds.push(b.end);
                    } else laneEnds[lane] = b.end;
                    return { b, lane };
                  });
                  for (const a of assigned) lanes.set(a.b.id, { lane: a.lane, of: laneEnds.length });
                }
              }
              const closed = props.closedDays.includes(weekdayOf(c.day));
              return (
                <div key={c.key} className={`relative border-l border-line ${isToday && view === "week" ? "bg-clay/[0.03]" : ""} ${closed ? "bg-[repeating-linear-gradient(135deg,transparent,transparent_8px,rgba(0,0,0,0.025)_8px,rgba(0,0,0,0.025)_16px)]" : ""}`}>
                  {Array.from({ length: rows }).map((_, i) => (
                    <div
                      key={i}
                      className={`absolute inset-x-0 border-t ${i % 4 === 0 ? "border-line" : "border-line/40 border-dashed"}`}
                      style={{ top: i * ROW_PX }}
                    />
                  ))}
                  {isToday && props.nowMin >= dayStartMin && props.nowMin <= dayEndMin && (
                    <div className="absolute inset-x-0 z-20 flex items-center" style={{ top: ((props.nowMin - dayStartMin) / 15) * ROW_PX }}>
                      <span className="-ml-1 h-2 w-2 rounded-full bg-clay" />
                      <span className="h-px flex-1 bg-clay" />
                    </div>
                  )}
                  {colBookings.map((b) => {
                    const color = colorOf.get(b.staffId) ?? "#888";
                    const l = lanes.get(b.id);
                    const width = l ? `calc(${100 / l.of}% - 6px)` : "calc(100% - 8px)";
                    const left = l ? `calc(${(100 / l.of) * l.lane}% + 3px)` : "4px";
                    const cancelled = b.status === "cancelled";
                    const h = blockHeight(b);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelected(b)}
                        className={`absolute z-10 flex flex-col items-start justify-start overflow-hidden rounded-lg px-2 py-1 text-left text-[0.75rem] leading-tight shadow-sm transition hover:z-30 hover:shadow-md ${cancelled ? "opacity-50" : ""}`}
                        style={{
                          top: top(b.start) + 1,
                          height: h,
                          width,
                          left,
                          background: b.status === "confirmed" ? `${color}2e` : b.status === "no-show" ? "#fde8ea" : "#efebe5",
                          borderLeft: `3px solid ${color}`,
                          color: "#1d1915",
                        }}
                      >
                        <span className={`block truncate font-medium ${cancelled ? "line-through" : ""}`}>{b.customer.name}</span>
                        {h > ROW_PX * 1.7 && <span className="block truncate text-ink-soft">{b.serviceName}</span>}
                        {h > ROW_PX * 2.6 && (
                          <span className="mt-0.5 block truncate text-[0.68rem] text-mute">
                            {time12(b.start)}
                            {b.status !== "confirmed" ? ` · ${b.status}` : ""}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {bookings.length === 0 && <p className="mt-4 text-center text-sm text-mute">No bookings in this period.</p>}

      {selected && <BookingDrawer booking={selected} color={colorOf.get(selected.staffId) ?? "#888"} today={props.today} onClose={() => setSelected(null)} />}
    </div>
  );
}

function BookingDrawer({ booking: b, color, onClose, today }: { booking: BookingView; color: string; onClose: () => void; today: string }) {
  const isPast = b.start.slice(0, 10) <= today;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto bg-[#fbf8f3] p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <span className={`rounded-full px-3 py-1 text-xs capitalize ring-1 ${STATUS_STYLES[b.status]}`}>{b.status}</span>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full ring-1 ring-line hover:bg-sand" aria-label="Close">
            ✕
          </button>
        </div>
        <h2 className="display mt-5 text-[2.4rem] leading-none">{b.customer.name}</h2>
        <a href={`tel:${b.customer.phone}`} className="mt-2 inline-block text-ink-soft underline-offset-4 hover:underline">
          {phonePretty(b.customer.phone)}
        </a>
        {b.customer.email && <p className="text-sm text-mute">{b.customer.email}</p>}

        <dl className="mt-7 divide-y divide-line rounded-2xl bg-paper text-sm ring-1 ring-line">
          {[
            ["When", `${dayLabel(b.start.slice(0, 10), { weekday: "long", month: "long", day: "numeric" })}, ${time12(b.start)} to ${time12(b.end)}`],
            ["Service", `${b.serviceName} (${b.durationMin} min)`],
            ["Stylist", b.staffName],
            ["Price", b.priceCAD ? `$${b.priceCAD}` : "Free"],
            ["Booked via", SOURCE_LABEL[b.source] ?? b.source],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-mute">{k}</dt>
              <dd className="flex items-center gap-2 text-right">
                {k === "Stylist" && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {b.notes && (
          <div className="mt-4 rounded-2xl bg-sand/50 p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-mute">Notes</p>
            <p className="mt-1">{b.notes}</p>
          </div>
        )}
        <div className="mt-7">
          <p className="mb-3 text-xs uppercase tracking-[0.14em] text-mute">Update status</p>
          <StatusButtons id={b.id} status={b.status} isPast={isPast} onDone={onClose} />
        </div>
        <Link href={`/admin/customers?q=${encodeURIComponent(b.customer.phone)}`} className="mt-8 inline-block text-sm text-clay underline-offset-4 hover:underline">
          View client history
        </Link>
      </aside>
    </div>
  );
}
