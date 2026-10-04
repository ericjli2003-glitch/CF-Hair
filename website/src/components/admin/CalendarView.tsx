"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { BookingView } from "@/lib/bookings";
import { dayLabel, hhmm, phonePretty, SOURCE_LABEL, STATUS_LABEL, STATUS_STYLES, time12 } from "@/lib/admin-format";
import { rodColour } from "@/lib/rods";
import { hhmmToMin, weekdayOf } from "@/lib/time";
import { useModal } from "@/lib/use-modal";
import { CloseIcon } from "./icons";
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
  /** Opens this booking's drawer on load (links from the Calls tab). */
  openBookingId?: string;
  /** Service id to category, so a block wears its category's rod colour. */
  categoryOf?: Record<string, string>;
}) {
  const { view, days, staff, bookings, dayStartMin, dayEndMin } = props;
  const [selected, setSelected] = useState<BookingView | null>(() => bookings.find((b) => b.id === props.openBookingId) ?? null);
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
              aria-pressed={!off}
              className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3.5 text-[0.95rem] ring-1 transition-colors ${
                off ? "bg-transparent text-ink-soft line-through ring-line" : "bg-paper ring-line hover:ring-ink"
              }`}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: off ? "transparent" : s.color, border: `1.5px solid ${s.color}` }} />
              {s.name}
              <span className="sr-only">{off ? ", hidden" : ", shown"}</span>
            </button>
          );
        })}
        <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2.5 px-1 text-[0.95rem] text-ink-soft">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="h-5 w-5 cursor-pointer accent-black" />
          Show cancelled
        </label>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl bg-paper ring-1 ring-line">
        <div className="min-w-[640px]">
          {/* Column headers */}
          <div className="sticky top-0 z-10 grid border-b border-line bg-paper" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(0, 1fr))` }}>
            <div />
            {columns.map((c) => {
              const isToday = c.day === props.today && view === "week";
              const closed = props.closedDays.includes(weekdayOf(c.day));
              const s = staff.find((x) => x.id === c.staffId);
              return (
                <div key={c.key} className={`border-l border-line px-3 py-3 ${isToday ? "bg-tile/60" : ""}`}>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {s && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />}
                    {c.title}
                    {isToday && <span className="rounded-md bg-ink px-2 py-0.5 text-xs font-medium text-paper">Today</span>}
                  </p>
                  <p className="text-sm text-ink-soft">{closed ? "Closed" : c.sub}</p>
                </div>
              );
            })}
          </div>

          {/* Grid */}
          <div className="relative grid pb-4" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(0, 1fr))`, height: height + 16 }}>
            <div className="relative">
              {hours.map((m) => (
                <span key={m} className={`absolute right-2 text-xs ${m === dayStartMin ? "translate-y-0.5" : "-translate-y-1/2"} tabular-nums text-mute`} style={{ top: ((m - dayStartMin) / 15) * ROW_PX }}>
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
                <div key={c.key} className={`relative border-l border-line ${isToday && view === "week" ? "bg-tile/40" : ""} ${closed ? "bg-[repeating-linear-gradient(135deg,transparent,transparent_8px,rgba(0,0,0,0.025)_8px,rgba(0,0,0,0.025)_16px)]" : ""}`}>
                  {Array.from({ length: rows }).map((_, i) => (
                    <div
                      key={i}
                      className={`absolute inset-x-0 border-t ${i % 4 === 0 ? "border-line" : "border-line/40 border-dashed"}`}
                      style={{ top: i * ROW_PX }}
                    />
                  ))}
                  {isToday && props.nowMin >= dayStartMin && props.nowMin <= dayEndMin && (
                    <div className="absolute inset-x-0 z-20 flex items-center" style={{ top: ((props.nowMin - dayStartMin) / 15) * ROW_PX }}>
                      <span className="-ml-1 h-2 w-2 rounded-full bg-ink" />
                      <span className="h-px flex-1 bg-ink" />
                    </div>
                  )}
                  {colBookings.map((b) => {
                    const color = colorOf.get(b.staffId) ?? "#3d4a45";
                    const l = lanes.get(b.id);
                    const width = l ? `calc(${100 / l.of}% - 6px)` : "calc(100% - 8px)";
                    const left = l ? `calc(${(100 / l.of) * l.lane}% + 3px)` : "4px";
                    const cancelled = b.status === "cancelled";
                    const h = blockHeight(b);
                    const rod = rodColour(props.categoryOf?.[b.serviceId] ?? "");
                    const status = STATUS_LABEL[b.status] ?? b.status;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelected(b)}
                        aria-haspopup="dialog"
                        aria-label={`${b.customer.name}, ${b.serviceName}, ${time12(b.start)} to ${time12(b.end)}, ${b.staffName}, ${status}`}
                        className={`absolute z-10 flex flex-col items-start justify-start overflow-hidden rounded-md px-2 py-1 text-left text-[0.8rem] leading-tight text-ink ring-1 ring-black/10 transition-shadow hover:z-30 hover:shadow-md ${
                          cancelled || b.status === "no-show" ? "border border-dashed border-ink-soft" : ""
                        }`}
                        style={{
                          top: top(b.start) + 1,
                          height: h,
                          width,
                          left,
                          // Category rod colour as the fill (strong while booked, faint once done);
                          // the stylist's colour on the left edge.
                          background:
                            b.status === "confirmed"
                              ? `color-mix(in srgb, ${rod} 45%, white)`
                              : b.status === "completed"
                                ? `color-mix(in srgb, ${rod} 18%, white)`
                                : "#fff",
                          borderLeft: `4px solid ${color}`,
                        }}
                      >
                        <span className="flex w-full min-w-0 items-baseline gap-1.5">
                          <span className={`truncate font-semibold ${cancelled ? "line-through" : ""}`}>{b.customer.name}</span>
                          {b.status !== "confirmed" && <span className="ml-auto shrink-0 text-[0.75rem] font-medium text-ink-soft">{status}</span>}
                        </span>
                        {h > ROW_PX * 1.7 && <span className="block w-full truncate text-ink-soft">{b.serviceName}</span>}
                        {h > ROW_PX * 2.6 && <span className="nums mt-0.5 block truncate text-[0.75rem] text-ink-soft">{time12(b.start)}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {bookings.length === 0 && (
        <p className="mt-4 text-center text-[0.95rem] text-ink-soft">
          No bookings in this period.{" "}
          <Link href={`/admin/new?date=${days[0]}`} className="underline underline-offset-4">
            Add one
          </Link>
        </p>
      )}

      {selected && (
        <BookingDrawer
          booking={selected}
          color={colorOf.get(selected.staffId) ?? "#3d4a45"}
          today={props.today}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** Booking details as a modal side sheet: Escape or the close button dismisses it, focus moves in and back. */
function BookingDrawer({ booking: b, color, onClose, today }: { booking: BookingView; color: string; onClose: () => void; today: string }) {
  const isPast = b.start.slice(0, 10) <= today;
  const titleId = useId();
  const overlay = useRef<HTMLDivElement>(null);
  // Modal: the page behind is inert, Tab wraps inside, Escape closes, focus
  // returns to the booking block that opened it.
  useModal(overlay, true, onClose);
  // Hold the page still while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <div ref={overlay} className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <span className={`rounded-md px-3 py-1 text-sm ring-1 ${STATUS_STYLES[b.status]}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
          <button data-autofocus type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-md ring-1 ring-line hover:bg-tile" aria-label="Close booking details">
            <CloseIcon />
          </button>
        </div>
        <h2 id={titleId} className="display mt-5 text-[2.4rem] leading-none">
          {b.customer.name}
        </h2>
        <a href={`tel:${b.customer.phone}`} className="nums mt-2 inline-flex min-h-11 items-center text-ink-soft underline underline-offset-4">
          {phonePretty(b.customer.phone)}
        </a>
        {b.customer.email && <p className="text-sm text-ink-soft">{b.customer.email}</p>}

        <dl className="mt-6 divide-y divide-line rounded-xl bg-paper text-[0.95rem] ring-1 ring-line">
          {[
            ["When", `${dayLabel(b.start.slice(0, 10), { weekday: "long", month: "long", day: "numeric" })}, ${time12(b.start)} to ${time12(b.end)}`],
            ["Service", `${b.serviceName} (${b.durationMin} min)`],
            ["Stylist", b.staffName],
            ["Price", b.priceCAD ? `$${b.priceCAD}` : "Free"],
            ["Booked via", SOURCE_LABEL[b.source] ?? b.source],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="flex items-center gap-2 text-right">
                {k === "Stylist" && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {b.notes && (
          <div className="mt-4 rounded-xl bg-tile p-4 text-[0.95rem]">
            <h3 className="text-sm font-medium text-ink-soft">Notes</h3>
            <p className="mt-1">{b.notes}</p>
          </div>
        )}
        <div className="mt-7">
          <h3 className="mb-3 text-sm font-medium text-ink-soft">Update status</h3>
          <StatusButtons id={b.id} status={b.status} isPast={isPast} onDone={onClose} />
        </div>
        <Link href={`/admin/customers?q=${encodeURIComponent(b.customer.phone)}`} className="mt-6 inline-flex min-h-11 items-center text-[0.95rem] underline underline-offset-4 hover:decoration-2">
          View client history
        </Link>
      </div>
    </div>
  );
}
