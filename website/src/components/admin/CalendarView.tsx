"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { BookingView } from "@/lib/bookings";
import type { TimeOffView } from "@/lib/time-off";
import { dayLabel, hhmm, phonePretty, SOURCE_LABEL, STATUS_LABEL, STATUS_STYLES, time12 } from "@/lib/admin-format";
import { rodTint } from "@/lib/rods";
import { hhmmToMin, weekdayOf } from "@/lib/time";
import { useModal } from "@/lib/use-modal";
import { CloseIcon } from "./icons";
import { StatusButtons } from "./StatusActions";
import { min12, TimeDraftDialog, TimeOffDialog, type TimeDraft } from "./TimeDialogs";

interface StaffInfo {
  id: string;
  name: string;
  role: string;
  color: string;
}

const ROW_PX = 22; // height of a 15-minute row
/** Press and hold this long on a phone before dragging selects time (a quick swipe still scrolls). */
const HOLD_MS = 350;

interface Selecting {
  key: string;
  day: string;
  staffId?: string;
  anchor: number;
  cur: number;
}

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
  timeOff?: TimeOffView[];
  /** Opens the time-off dialog on load (the header's Time off button). */
  openTimeOff?: boolean;
}) {
  const { view, days, staff, bookings, dayStartMin, dayEndMin } = props;
  const [selected, setSelected] = useState<BookingView | null>(() => bookings.find((b) => b.id === props.openBookingId) ?? null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);
  const colorOf = useMemo(() => new Map(staff.map((s) => [s.id, s.color])), [staff]);
  const timeOff = props.timeOff ?? [];
  const [draft, setDraft] = useState<TimeDraft | null>(() =>
    props.openTimeOff ? { day: days[0], startMin: Math.max(dayStartMin, Math.min(12 * 60, dayEndMin - 60)), endMin: Math.min(dayEndMin, Math.max(dayStartMin, 12 * 60) + 60), mode: "off" } : null,
  );
  const [offOpen, setOffOpen] = useState<TimeOffView | null>(null);

  // Drag to pick time: mouse drags at once; on a phone, press and hold first so a swipe still scrolls.
  const [sel, setSel] = useState<Selecting | null>(null);
  const selRef = useRef<Selecting | null>(null);
  const selEl = useRef<HTMLElement | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const minAt = useCallback(
    (el: HTMLElement, clientY: number) => {
      const rows = (dayEndMin - dayStartMin) / 15;
      const slot = Math.min(rows - 1, Math.max(0, Math.floor((clientY - el.getBoundingClientRect().top) / ROW_PX)));
      return dayStartMin + slot * 15;
    },
    [dayStartMin, dayEndMin],
  );
  const begin = (el: HTMLElement, c: { key: string; day: string; staffId?: string }, min: number) => {
    selEl.current = el;
    selRef.current = { key: c.key, day: c.day, staffId: c.staffId, anchor: min, cur: min };
    setSel(selRef.current);
  };
  const update = useCallback(
    (clientY: number) => {
      const s = selRef.current;
      if (!s || !selEl.current) return;
      const cur = minAt(selEl.current, clientY);
      if (cur === s.cur) return;
      selRef.current = { ...s, cur };
      setSel(selRef.current);
    },
    [minAt],
  );
  const finish = useCallback(() => {
    const s = selRef.current;
    selRef.current = null;
    selEl.current = null;
    setSel(null);
    if (!s) return;
    const a = Math.min(s.anchor, s.cur);
    // A click without dragging picks half an hour.
    const b = s.anchor === s.cur ? Math.min(dayEndMin, a + 30) : Math.max(s.anchor, s.cur) + 15;
    setDraft({ day: s.day, staffId: s.staffId, startMin: a, endMin: b });
  }, [dayEndMin]);
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };

  // touchmove has to be non-passive to stop the page scrolling while a selection is being dragged.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (selRef.current) {
        e.preventDefault();
        update(t.clientY);
      } else if (hold.current && Math.hypot(t.clientX - hold.current.x, t.clientY - hold.current.y) > 10) {
        cancelHold(); // a scroll, not a hold
      }
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [update]);

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
                off ? "bg-transparent text-ink-soft line-through ring-line" : "bg-paper ring-line hover:ring-primary"
              }`}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: off ? "transparent" : s.color, border: `1.5px solid ${s.color}` }} />
              {s.name}
              <span className="sr-only">{off ? ", hidden" : ", shown"}</span>
            </button>
          );
        })}
        <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2.5 px-1 text-[0.95rem] text-ink-soft">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="h-5 w-5 cursor-pointer accent-primary" />
          Show cancelled
        </label>
      </div>

      <p className="mt-3 text-sm text-ink-soft">
        Drag across empty time to add a booking or time off. On a phone, press and hold, then drag.
      </p>

      <div className="mt-3 overflow-x-auto rounded-xl bg-paper ring-1 ring-line">
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
                    {isToday && <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-paper">Today</span>}
                  </p>
                  <p className="text-sm text-ink-soft">{closed ? "Closed" : c.sub}</p>
                </div>
              );
            })}
          </div>

          {/* Grid */}
          <div ref={gridRef} className="relative grid pb-4" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(0, 1fr))`, height: height + 16 }}>
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
              const colOff = timeOff.filter(
                (t) =>
                  t.start.slice(0, 10) <= c.day &&
                  t.end.slice(0, 10) >= c.day &&
                  (t.staffId === null || view === "week" ? !(t.staffId && hidden.has(t.staffId)) : t.staffId === c.staffId),
              );
              const live = sel && sel.key === c.key ? { a: Math.min(sel.anchor, sel.cur), b: Math.max(sel.anchor, sel.cur) + 15 } : null;
              return (
                <div
                  key={c.key}
                  className={`relative cursor-cell touch-manipulation select-none border-l border-line [-webkit-touch-callout:none] ${isToday && view === "week" ? "bg-tile/40" : ""} ${closed ? "bg-[repeating-linear-gradient(135deg,transparent,transparent_8px,rgba(0,0,0,0.025)_8px,rgba(0,0,0,0.025)_16px)]" : ""}`}
                  onMouseDown={(e) => {
                    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    begin(el, c, minAt(el, e.clientY));
                    const move = (ev: MouseEvent) => update(ev.clientY);
                    const up = () => {
                      window.removeEventListener("mousemove", move);
                      window.removeEventListener("mouseup", up);
                      finish();
                    };
                    window.addEventListener("mousemove", move);
                    window.addEventListener("mouseup", up);
                  }}
                  onTouchStart={(e) => {
                    if (e.touches.length !== 1 || (e.target as HTMLElement).closest("button")) return cancelHold();
                    const t = e.touches[0];
                    const el = e.currentTarget;
                    cancelHold();
                    hold.current = {
                      x: t.clientX,
                      y: t.clientY,
                      timer: setTimeout(() => {
                        hold.current = null;
                        begin(el, c, minAt(el, t.clientY));
                        navigator.vibrate?.(15);
                      }, HOLD_MS),
                    };
                  }}
                  onTouchEnd={() => {
                    cancelHold();
                    if (selRef.current) finish();
                  }}
                  onTouchCancel={() => {
                    cancelHold();
                    selRef.current = null;
                    setSel(null);
                  }}
                  onContextMenu={(e) => {
                    if (selRef.current || hold.current) e.preventDefault();
                  }}
                >
                  {Array.from({ length: rows }).map((_, i) => (
                    <div
                      key={i}
                      className={`absolute inset-x-0 border-t ${i % 4 === 0 ? "border-line" : "border-line/40 border-dashed"}`}
                      style={{ top: i * ROW_PX }}
                    />
                  ))}
                  {isToday && props.nowMin >= dayStartMin && props.nowMin <= dayEndMin && (
                    <div className="absolute inset-x-0 z-20 flex items-center" style={{ top: ((props.nowMin - dayStartMin) / 15) * ROW_PX }}>
                      <span className="-ml-1 h-2 w-2 rounded-full bg-primary" />
                      <span className="h-px flex-1 bg-primary" />
                    </div>
                  )}
                  {colOff.map((t) => {
                    const from = t.start.slice(0, 10) < c.day ? dayStartMin : hhmmToMin(hhmm(t.start));
                    const to = t.end.slice(0, 10) > c.day ? dayEndMin : hhmmToMin(hhmm(t.end));
                    const a = Math.max(from, dayStartMin);
                    const b = Math.min(to, dayEndMin);
                    if (b <= a) return null;
                    const who = t.staffName ?? "Whole salon";
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setOffOpen(t)}
                        aria-haspopup="dialog"
                        aria-label={`Time off, ${who}, ${min12(a)} to ${min12(b)}${t.reason ? `, ${t.reason}` : ""}`}
                        className="absolute inset-x-1 z-[5] overflow-hidden rounded-md px-2 py-1 text-left text-[0.8rem] leading-tight text-ink-soft ring-1 ring-line hover:ring-ink-soft"
                        style={{
                          top: ((a - dayStartMin) / 15) * ROW_PX + 1,
                          height: Math.max(ROW_PX, ((b - a) / 15) * ROW_PX - 3),
                          background:
                            "repeating-linear-gradient(135deg, var(--color-tile), var(--color-tile) 6px, var(--color-paper) 6px, var(--color-paper) 12px)",
                          borderLeft: t.staffId ? `4px solid ${colorOf.get(t.staffId) ?? "var(--color-ink-soft)"}` : undefined,
                        }}
                      >
                        <span className="block truncate font-medium text-ink">{t.reason || "Time off"}</span>
                        {(view === "week" || !t.staffId) && ((b - a) / 15) * ROW_PX > ROW_PX * 1.7 && <span className="block truncate">{who}</span>}
                      </button>
                    );
                  })}
                  {live && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-1 z-40 rounded-md bg-primary/15 px-2 py-1 text-[0.8rem] font-medium text-primary ring-2 ring-primary"
                      style={{ top: ((live.a - dayStartMin) / 15) * ROW_PX + 1, height: ((live.b - live.a) / 15) * ROW_PX - 2 }}
                    >
                      {min12(live.a)} to {min12(live.b)}
                    </div>
                  )}
                  {colBookings.map((b) => {
                    const color = colorOf.get(b.staffId) ?? "var(--color-ink-soft)";
                    const l = lanes.get(b.id);
                    const width = l ? `calc(${100 / l.of}% - 6px)` : "calc(100% - 8px)";
                    const left = l ? `calc(${(100 / l.of) * l.lane}% + 3px)` : "4px";
                    const cancelled = b.status === "cancelled";
                    const h = blockHeight(b);
                    const tint = rodTint(props.categoryOf?.[b.serviceId] ?? "");
                    const status = STATUS_LABEL[b.status] ?? b.status;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelected(b)}
                        aria-haspopup="dialog"
                        aria-label={`${b.customer.name}, ${b.serviceName}, ${time12(b.start)} to ${time12(b.end)}, ${b.staffName}, ${status}`}
                        className={`absolute z-10 flex flex-col items-start justify-start overflow-hidden rounded-md px-2 py-1 text-left text-[0.8rem] leading-tight text-ink ring-1 ring-ink/10 transition-shadow hover:z-30 hover:shadow-md ${
                          cancelled || b.status === "no-show" ? "border border-dashed border-ink-soft" : ""
                        }`}
                        style={{
                          top: top(b.start) + 1,
                          height: h,
                          width,
                          left,
                          // The category tint as the fill (full while booked, faint once done);
                          // the stylist's colour on the left edge.
                          background:
                            b.status === "confirmed"
                              ? tint
                              : b.status === "completed"
                                ? `color-mix(in srgb, ${tint} 45%, var(--color-paper))`
                                : "var(--color-paper)",
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

      {draft && (
        <TimeDraftDialog
          draft={draft}
          staff={staff.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
          dayStartMin={dayStartMin}
          dayEndMin={dayEndMin}
          onClose={() => setDraft(null)}
        />
      )}
      {offOpen && <TimeOffDialog item={offOpen} onClose={() => setOffOpen(null)} />}

      {selected && (
        <BookingDrawer
          booking={selected}
          color={colorOf.get(selected.staffId) ?? "var(--color-ink-soft)"}
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
    <div ref={overlay} className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="h-full w-full max-w-md overflow-y-auto bg-paper p-6 shadow-2xl sm:p-7"
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
