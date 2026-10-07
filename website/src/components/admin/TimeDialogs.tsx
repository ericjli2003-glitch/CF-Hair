"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { dayLabel, hhmm } from "@/lib/admin-format";
import { SALON_TZ } from "@/lib/salon";
import type { TimeOffView } from "@/lib/time-off";
import { hhmmToMin, minToHHMM, zonedTime } from "@/lib/time";
import { useModal } from "@/lib/use-modal";
import { CloseIcon } from "./icons";

export interface StaffChoice {
  id: string;
  name: string;
  color: string;
}

/** A stretch of time picked on the calendar (by dragging, or the Time off button). */
export interface TimeDraft {
  day: string;
  /** The stylist column it was picked in (day view); absent in week view. */
  staffId?: string;
  startMin: number;
  endMin: number;
  /** Which tab to open on. */
  mode?: "booking" | "off";
}

export function min12(min: number): string {
  const h = Math.floor(min / 60);
  return `${h % 12 || 12}:${String(min % 60).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

function useLockScroll() {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const overlay = useRef<HTMLDivElement>(null);
  useModal(overlay, true, onClose);
  useLockScroll();
  return (
    <div ref={overlay} className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-paper p-6 shadow-2xl sm:rounded-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="display text-[1.9rem] leading-tight">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-md ring-1 ring-line hover:bg-tile" aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * What to do with a picked stretch of time: open the booking form with it filled in, or block it
 * as time off for one stylist or the whole salon.
 */
export function TimeDraftDialog({
  draft,
  staff,
  dayStartMin,
  dayEndMin,
  onClose,
}: {
  draft: TimeDraft;
  staff: StaffChoice[];
  dayStartMin: number;
  dayEndMin: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"booking" | "off">(draft.mode ?? "booking");
  const [startMin, setStartMin] = useState(draft.startMin);
  const [endMin, setEndMin] = useState(draft.endMin);
  const [bookStaff, setBookStaff] = useState(draft.staffId ?? "any");
  const [offStaff, setOffStaff] = useState(draft.staffId ?? "all");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<number | null>(null);

  const times: number[] = [];
  for (let m = dayStartMin; m <= dayEndMin; m += 15) times.push(m);
  const minutes = endMin - startMin;
  const valid = minutes > 0;

  const bookHref = (() => {
    const q = new URLSearchParams({ date: draft.day, time: minToHHMM(startMin), minutes: String(minutes) });
    if (bookStaff !== "any") q.set("staff", bookStaff);
    return `/admin/new?${q}`;
  })();

  async function blockTime() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/time-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staffId: offStaff === "all" ? null : offStaff,
        start: zonedTime(draft.day, startMin, SALON_TZ).toISOString(),
        end: zonedTime(draft.day, endMin, SALON_TZ).toISOString(),
        reason: reason.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status !== 201) {
      setError(`Could not save the time off. ${body.message ?? "Try again."}`);
      return;
    }
    router.refresh();
    if (body.overlappingBookings > 0) setOverlap(body.overlappingBookings);
    else onClose();
  }

  const title = `${dayLabel(draft.day, { weekday: "short", month: "short", day: "numeric" })}, ${min12(startMin)} to ${min12(endMin)}`;

  if (overlap !== null) {
    return (
      <Sheet title="Time off saved" onClose={onClose}>
        <p className="mt-4 text-[0.95rem]">
          {overlap === 1 ? "1 booking is" : `${overlap} bookings are`} already in this time. {overlap === 1 ? "It stays" : "They stay"} booked, so
          move or cancel {overlap === 1 ? "it" : "them"} if needed. New online and phone bookings can no longer use this time.
        </p>
        <button type="button" data-autofocus onClick={onClose} className="btn-primary mt-6 w-full">
          Done
        </button>
      </Sheet>
    );
  }

  const seg = (v: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(v)}
      aria-pressed={mode === v}
      className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-4 text-[0.95rem] transition-colors ${
        mode === v ? "bg-primary font-medium text-paper" : "text-ink-soft hover:bg-paper hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  const staffPicker = (value: string, set: (v: string) => void, first: { id: string; name: string }) => (
    <div role="group" aria-label="Stylist" className="flex flex-wrap gap-2">
      {[{ ...first, color: "" }, ...staff].map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => set(s.id)}
          aria-pressed={value === s.id}
          className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3.5 text-[0.95rem] ring-1 ${
            value === s.id ? "bg-primary font-medium text-paper ring-primary" : "ring-line hover:ring-primary"
          }`}
        >
          {s.color && (
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${value === s.id ? "ring-2 ring-paper" : ""}`} style={{ background: s.color }} />
          )}
          {s.name}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet title={title} onClose={onClose}>
      <div role="group" aria-label="What to add" className="mt-5 flex gap-1 rounded-lg bg-tile p-1">
        {seg("booking", "Booking")}
        {seg("off", "Time off")}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="td-start">From</label>
          <select id="td-start" className="field !py-3" value={startMin} onChange={(e) => setStartMin(Number(e.target.value))}>
            {times.slice(0, -1).map((m) => (
              <option key={m} value={m}>{min12(m)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="td-end">To</label>
          <select id="td-end" className="field !py-3" value={endMin} onChange={(e) => setEndMin(Number(e.target.value))}>
            {times.slice(1).map((m) => (
              <option key={m} value={m}>{min12(m)}</option>
            ))}
          </select>
        </div>
      </div>
      {!valid && <p className="mt-2 text-sm font-medium text-alert">The end has to be after the start.</p>}

      {mode === "booking" ? (
        <div className="mt-5 space-y-5">
          <div>
            <span className="label">Stylist</span>
            {staffPicker(bookStaff, setBookStaff, { id: "any", name: "Anyone" })}
          </div>
          <p className="text-sm text-ink-soft">Next you add the client and service. The service&apos;s length decides the end time.</p>
          {valid ? (
            <Link href={bookHref} data-autofocus className="btn-primary flex w-full justify-center">
              Continue to booking
            </Link>
          ) : (
            <button type="button" disabled className="btn-primary w-full">Continue to booking</button>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div>
            <span className="label">Who is out</span>
            {staffPicker(offStaff, setOffStaff, { id: "all", name: "Whole salon" })}
          </div>
          <div>
            <label className="label" htmlFor="td-reason">Reason (optional)</label>
            <input
              id="td-reason"
              className="field !py-3"
              value={reason}
              maxLength={120}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lunch, holiday, appointment"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md border-2 border-alert px-3 py-2 text-sm font-medium text-alert">
              {error}
            </p>
          )}
          <button type="button" onClick={blockTime} disabled={busy || !valid} aria-busy={busy || undefined} className="btn-primary w-full">
            {busy ? "Saving..." : "Block this time"}
          </button>
          <p className="text-sm text-ink-soft">Online booking and the phone agent will not offer this time.</p>
        </div>
      )}
    </Sheet>
  );
}

/** Details of a time-off block, with a way to remove it. */
export function TimeOffDialog({ item, onClose }: { item: TimeOffView; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sameDay = item.start.slice(0, 10) === item.end.slice(0, 10);
  const fmt = (iso: string) => min12(hhmmToMin(hhmm(iso)));
  const when = sameDay
    ? `${dayLabel(item.start.slice(0, 10), { weekday: "long", month: "long", day: "numeric" })}, ${fmt(item.start)} to ${fmt(item.end)}`
    : `${dayLabel(item.start.slice(0, 10))}, ${fmt(item.start)} to ${dayLabel(item.end.slice(0, 10))}, ${fmt(item.end)}`;

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/time-off/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok && res.status !== 404) {
      setError("Could not remove it. Try again.");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Sheet title={item.reason || "Time off"} onClose={onClose}>
      <dl className="mt-5 divide-y divide-line rounded-xl text-[0.95rem] ring-1 ring-line">
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-ink-soft">When</dt>
          <dd className="text-right">{when}</dd>
        </div>
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="text-ink-soft">Who</dt>
          <dd className="text-right">{item.staffName ?? "Whole salon"}</dd>
        </div>
      </dl>
      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-alert">
          {error}
        </p>
      )}
      <button type="button" data-autofocus onClick={remove} disabled={busy} aria-busy={busy || undefined} className="btn-ghost mt-6 w-full">
        {busy ? "Removing..." : "Remove time off"}
      </button>
    </Sheet>
  );
}
