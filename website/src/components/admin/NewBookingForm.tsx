"use client";

import { parsePhoneNumberFromString } from "libphonenumber-js";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogService, CatalogStaff } from "@/lib/catalog";
import { dayLabel, time12 } from "@/lib/admin-format";
import { LANGUAGE_LABELS, type LanguageCode } from "@/lib/languages";
import { SALON_TZ } from "@/lib/salon";
import { toZonedISO } from "@/lib/time";

interface Slot {
  start: string;
  end: string;
  staffId: string;
  staffName: string;
}
interface Found {
  name: string;
  email: string | null;
  visitCount: number;
  preferredLanguage: LanguageCode;
  lastVisit: string | null;
}

export function NewBookingForm({
  services,
  staff,
  categories,
  initialDate,
  today,
  initialStart = null,
  initialStaffId,
  initialMinutes,
}: {
  services: CatalogService[];
  staff: CatalogStaff[];
  categories: string[];
  initialDate: string;
  today: string;
  /** A start picked on the calendar; kept even when it is not one of the listed open times. */
  initialStart?: string | null;
  initialStaffId?: string;
  /** Length picked on the calendar: the service closest to it is chosen. */
  initialMinutes?: number;
}) {
  const [source, setSource] = useState<"phone" | "walk-in" | "admin">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [lookup, setLookup] = useState<{ phone: string; found: Found | null } | null>(null);
  const [serviceId, setServiceId] = useState(() => {
    const offered = initialStaffId ? services.filter((s) => staff.find((x) => x.id === initialStaffId)?.serviceIds.includes(s.id)) : services;
    if (!initialMinutes || !offered.length) return offered[0]?.id ?? services[0]?.id ?? "";
    return [...offered].sort((a, b) => Math.abs(a.durationMin - initialMinutes) - Math.abs(b.durationMin - initialMinutes))[0].id;
  });
  const [staffId, setStaffId] = useState(initialStaffId ?? "any");
  const [date, setDate] = useState(initialDate);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState<string | null>(initialStart);
  // The calendar-picked start survives loading the open times for its own day.
  const [picked, setPicked] = useState<string | null>(initialStart);
  // Errors sit next to their field; "form" is for a failure that is not one field's.
  const [errors, setErrors] = useState<{ phone?: string; name?: string; time?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; when: string; staff: string; name: string } | null>(null);

  const service = services.find((s) => s.id === serviceId);
  const eligible = staff.filter((s) => s.serviceIds.includes(serviceId));
  const e164 = (() => {
    const p = parsePhoneNumberFromString(phone, "CA");
    return p && p.isValid() ? p.number : null;
  })();

  const found = lookup && lookup.phone === e164 ? lookup.found : null;

  // Look up the client as soon as the number is complete.
  useEffect(() => {
    if (!e164) return;
    let off = false;
    fetch(`/api/customers?phone=${encodeURIComponent(e164)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Found[]) => {
        if (off) return;
        const c = rows[0] ?? null;
        setLookup({ phone: e164, found: c });
        if (c) {
          setName((n) => n || c.name);
          setEmail((x) => x || c.email || "");
        }
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [e164]);

  useEffect(() => {
    if (!serviceId || !date) return;
    let off = false;
    const qs = new URLSearchParams({ serviceId, date });
    if (staffId !== "any") qs.set("staffId", staffId);
    fetch(`/api/availability?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        setSlots(d.slots ?? []);
        setStart((cur) => (cur && cur === picked && cur.slice(0, 10) === date ? cur : null));
      });
    return () => {
      off = true;
    };
  }, [serviceId, staffId, date, picked]);

  function walkInNow() {
    const now = new Date();
    const rounded = new Date(Math.floor(now.getTime() / 900000) * 900000);
    const now15 = toZonedISO(rounded, SALON_TZ);
    setSource("walk-in");
    setDate(today);
    setPicked(now15);
    setStart(now15);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!e164) errs.phone = "Enter a 10-digit phone number, like 604 555 0123.";
    if (!name.trim()) errs.name = "Add the client's name.";
    if (!start) errs.time = "Pick a time below, or use Start now for a walk-in.";
    setErrors(errs);
    const first = (["phone", "name", "time"] as const).find((k) => errs[k]);
    if (first) {
      document.getElementById(first === "time" ? "n-time-label" : `n-${first}`)?.focus();
      return;
    }
    setBusy(true);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId,
        staffId: staffId === "any" ? undefined : staffId,
        start,
        customer: { name: name.trim(), phone: e164, email: email.trim() || undefined },
        notes: notes.trim() || undefined,
        source,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 201) {
      setDone({ id: body.booking.id, when: `${dayLabel(body.booking.start.slice(0, 10))}, ${time12(body.booking.start)}`, staff: body.booking.staffName, name: body.booking.customer.name });
      return;
    }
    if (res.status === 409) {
      setErrors({ time: "That time is taken or blocked as time off. Pick another time." });
      document.getElementById("n-time-label")?.focus();
    } else setErrors({ form: `Could not create the booking. ${body.message ?? "Check the details and try again."}` });
  }

  if (done) {
    return (
      <div className="mt-8 rounded-xl bg-paper p-10 text-center ring-1 ring-line">
        <p className="text-sm text-ink-soft">Booked</p>
        <p className="display mt-3 text-[2.4rem]">{done.name}</p>
        <p className="mt-2 text-ink-soft">
          {done.when} with {done.staff}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={`/admin?date=${start?.slice(0, 10) ?? today}`} className="btn-primary">
            Open schedule
          </Link>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setDone(null);
              setPhone("");
              setName("");
              setEmail("");
              setNotes("");
              setStart(null);
              setLookup(null);
              setDate(today);
              setErrors({});
            }}
          >
            Another booking
          </button>
        </div>
      </div>
    );
  }

  const seg = (v: typeof source, label: string) => (
    <button
      type="button"
      onClick={() => setSource(v)}
      aria-pressed={source === v}
      className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-4 text-[0.95rem] transition-colors ${
        source === v ? "bg-primary font-medium text-paper" : "text-ink-soft hover:bg-paper hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  const errText = (id: string, msg?: string) =>
    msg ? (
      <p id={id} className="mt-1.5 text-sm font-medium text-alert">
        {msg}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="mt-8 grid gap-6 lg:grid-cols-2">
      <section className="space-y-5 rounded-xl bg-paper p-6 ring-1 ring-line">
        <div role="group" aria-label="How the booking came in" className="flex gap-1 rounded-lg bg-tile p-1">
          {seg("phone", "Phone call")}
          {seg("walk-in", "Walk-in")}
          {seg("admin", "Other")}
        </div>
        <div>
          <label className="label" htmlFor="n-phone">Phone</label>
          <input
            id="n-phone"
            type="tel"
            autoComplete="off"
            className="field !py-3.5 text-lg"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (errors.phone) setErrors((x) => ({ ...x, phone: undefined }));
            }}
            placeholder="604 555 0123"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? "n-phone-err" : undefined}
          />
          {errText("n-phone-err", errors.phone)}
          {found && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-primary-wash px-3 py-2 text-sm text-primary">
              Returning client: <strong>{found.name}</strong> · {found.visitCount} visit{found.visitCount === 1 ? "" : "s"}
              <span className="rounded-md bg-paper px-2 py-0.5 text-xs ring-1 ring-primary-line">
                {LANGUAGE_LABELS[found.preferredLanguage]?.native}
              </span>
            </div>
          )}
          {e164 && lookup?.phone === e164 && !found && <p className="mt-2 text-sm text-ink-soft">New client</p>}
        </div>
        <div>
          <label className="label" htmlFor="n-name">Name</label>
          <input
            id="n-name"
            className="field !py-3.5"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((x) => ({ ...x, name: undefined }));
            }}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "n-name-err" : undefined}
          />
          {errText("n-name-err", errors.name)}
        </div>
        <div>
          <label className="label" htmlFor="n-email">Email (optional)</label>
          <input id="n-email" type="email" className="field !py-3.5" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="n-notes">Notes</label>
          <textarea id="n-notes" rows={3} className="field resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>

      <section className="space-y-5 rounded-xl bg-paper p-6 ring-1 ring-line">
        <div>
          <label className="label" htmlFor="n-service">Service</label>
          <select
            id="n-service"
            className="field !py-3.5"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setStaffId("any");
            }}
          >
            {categories.map((c) => (
              <optgroup key={c} label={c}>
                {services
                  .filter((s) => s.category === c)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.durationMin} min · ${s.priceCAD}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div role="group" aria-labelledby="n-staff-label">
          <span id="n-staff-label" className="label">
            Stylist
          </span>
          <div className="flex flex-wrap gap-2">
            {[{ id: "any", name: "Anyone" }, ...eligible].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStaffId(s.id)}
                aria-pressed={staffId === s.id}
                className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-[0.95rem] ring-1 ${
                  staffId === s.id ? "bg-primary font-medium text-paper ring-primary" : "ring-line hover:ring-primary"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="label" htmlFor="n-date">Date</label>
            <input id="n-date" type="date" min={today} className="field !py-3" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button type="button" onClick={walkInNow} className="btn-ghost">
            Start now
          </button>
        </div>
        <div role="group" aria-labelledby="n-time-label" aria-describedby={errors.time ? "n-time-err" : undefined}>
          <span id="n-time-label" tabIndex={-1} className="label outline-none">
            Time {service ? `(${service.durationMin} min)` : ""}
          </span>
          {errText("n-time-err", errors.time)}
          {start && !slots?.some((s) => s.start === start) && (
            <p className="mb-2 rounded-xl bg-tile px-3 py-2 text-sm text-ink">
              {source === "walk-in" ? "Walk-in starting" : "Starting"} {time12(start)}
              {source !== "walk-in" && start === picked ? ", as picked on the calendar" : ""}
            </p>
          )}
          <p role="status" className="sr-only">
            {slots === null ? "Loading open times" : `${slots.length} open time${slots.length === 1 ? "" : "s"}`}
          </p>
          {slots === null ? (
            <div className="grid grid-cols-4 gap-2 p-1 sm:grid-cols-5" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} className="h-11 animate-pulse rounded-md bg-tile" />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <p className="rounded-xl border border-dashed border-edge p-4 text-sm text-ink-soft">No open times on this day. Try another date, or use Start now for a walk-in.</p>
          ) : (
            <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto p-1 sm:grid-cols-5">
              {slots.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => {
                    setStart(s.start);
                    setPicked(null);
                    if (errors.time) setErrors((x) => ({ ...x, time: undefined }));
                  }}
                  aria-pressed={start === s.start}
                  className={`min-h-11 rounded-md px-1 text-sm tabular-nums ring-1 ${start === s.start ? "bg-primary font-medium text-paper ring-primary" : "ring-line hover:ring-primary"}`}
                >
                  {time12(s.start).replace(" ", "")}
                </button>
              ))}
            </div>
          )}
        </div>
        {errors.form && (
          <p role="alert" className="rounded-md border-2 border-alert bg-paper px-3 py-2 text-sm font-medium text-alert">
            {errors.form}
          </p>
        )}
        <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn-primary w-full !py-4 !text-base">
          {busy ? "Booking..." : "Create booking"}
        </button>
      </section>
    </form>
  );
}
