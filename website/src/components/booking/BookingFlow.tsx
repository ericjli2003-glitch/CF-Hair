"use client";

import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookingHref, parseBookingParams, stepForUrl, type BookingStart } from "@/lib/booking-params";
import type { CatalogService, CatalogStaff } from "@/lib/catalog";
import { fill } from "@/lib/i18n/dictionary";
import {
  categoryName,
  formatDuration,
  formatPrice,
  formatTime,
  LOCALE,
  roleName,
  serviceDesc,
  serviceName,
} from "@/lib/i18n/localize";
import { rodColour, rodText, rodTint } from "@/lib/rods";
import { formatPhoneDisplay, fullAddress, salon, type Hours } from "@/lib/salon";
import { addDays, weekdayOf } from "@/lib/time";
import { useI18n } from "../LangProvider";
import { Rod } from "../site/Rod";

interface Slot {
  start: string;
  end: string;
  staffId: string;
  staffName: string;
}

const DAYS_AHEAD = 35;

export function BookingFlow(props: {
  services: CatalogService[];
  staff: CatalogStaff[];
  categories: string[];
  hours: Hours;
  today: string;
  start: BookingStart;
  cancellationHours: number;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { services, staff, categories, hours, today, start } = props;

  const [serviceId, setServiceId] = useState<string | undefined>(start.serviceId);
  const [staffId, setStaffId] = useState<string | undefined>(start.staffId);
  const pendingStaff = start.pendingStaffId;
  const [step, setStep] = useState<number>(start.step);
  const [date, setDate] = useState<string | undefined>();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | undefined>();
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  // Promotional SMS opt-in: unchecked by default, never required (CASL express consent).
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState("");
  const topRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const service = services.find((s) => s.id === serviceId);
  const stylist = staff.find((s) => s.id === staffId);
  const eligibleStaff = useMemo(() => staff.filter((s) => serviceId && s.serviceIds.includes(serviceId)), [staff, serviceId]);

  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);
  const isOpen = useCallback((d: string) => !!hours[weekdayOf(d)], [hours]);

  // Every step gets its own address (pushed, not replaced), so the browser's Back
  // button steps back through the flow and a reload or shared link lands in the
  // same place. Next.js keeps its router in sync with native pushState.
  const go = (n: number, sid = serviceId, tid = staffId) => {
    moved.current = true;
    setStep(n);
    const href = bookingHref(n >= 1 ? sid : undefined, n === 1 ? undefined : tid, n === 3);
    try {
      if (window.location.pathname + window.location.search !== href) window.history.pushState(null, "", href);
    } catch {
      /* not essential */
    }
  };

  // Back and Forward: restore the step and choices from the address.
  const slotRef = useRef(slot);
  useEffect(() => {
    slotRef.current = slot;
  }, [slot]);
  useEffect(() => {
    const onPop = () => {
      const qs = new URLSearchParams(window.location.search);
      const at = parseBookingParams(Object.fromEntries(qs), services, staff);
      moved.current = true;
      setServiceId(at.serviceId);
      setStaffId(at.serviceId ? at.staffId : undefined);
      setStep(stepForUrl(at, qs, !!slotRef.current));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [services, staff]);

  // After a step change, bring the new step into view and move focus to its heading.
  useEffect(() => {
    if (!moved.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    topRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const fetchSlots = useCallback(
    async (d: string): Promise<Slot[]> => {
      if (!serviceId) return [];
      const qs = new URLSearchParams({ serviceId, date: d });
      if (staffId && staffId !== "any") qs.set("staffId", staffId);
      const res = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
      if (!res.ok) return [];
      return (await res.json()).slots as Slot[];
    },
    [serviceId, staffId],
  );

  const loadDate = useCallback(
    async (d: string) => {
      setDate(d);
      setSlot(undefined);
      setSlots(null);
      setLoadingSlots(true);
      const s = isOpen(d) ? await fetchSlots(d) : [];
      setSlots(s);
      setLoadingSlots(false);
    },
    [fetchSlots, isOpen],
  );

  // Entering the time step: jump to the first day with openings. Coming back to it
  // (from the details step, or with Back) keeps the chosen day, and the chosen
  // time if it is still open.
  const loadedFor = useRef<string | null>(null);
  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);
  useEffect(() => {
    if (step !== 2 || !serviceId || !staffId) return;
    let cancelled = false;
    const key = `${serviceId}|${staffId}`;
    const day = dateRef.current;
    if (loadedFor.current === key && day) {
      (async () => {
        const s = isOpen(day) ? await fetchSlots(day) : [];
        if (cancelled) return;
        setSlots(s);
        setSlot((cur) => (cur && s.some((x) => x.start === cur.start) ? cur : undefined));
      })();
      return () => {
        cancelled = true;
      };
    }
    loadedFor.current = key;
    (async () => {
      setLoadingSlots(true);
      setSlots(null);
      setSlot(undefined);
      for (const d of days.slice(0, 14)) {
        if (!isOpen(d)) continue;
        const s = await fetchSlots(d);
        if (cancelled) return;
        if (s.length) {
          setDate(d);
          setSlots(s);
          setLoadingSlots(false);
          return;
        }
      }
      if (!cancelled) {
        setDate(days[0]);
        setSlots([]);
        setLoadingSlots(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, serviceId, staffId, days, fetchSlots, isOpen]);

  const pickService = (id: string) => {
    setServiceId(id);
    const s = services.find((x) => x.id === id)!;
    // Keep a stylist chosen from the team page if they offer this service.
    const keep = pendingStaff && staff.find((x) => x.id === pendingStaff)?.serviceIds.includes(s.id);
    setStaffId(keep ? pendingStaff : undefined);
    go(keep ? 2 : 1, id, keep ? pendingStaff : undefined);
  };
  const pickStaff = (id: string) => {
    setStaffId(id);
    go(2, serviceId, id);
  };
  const backTo = (n: number) => (n === 0 ? go(0, undefined, pendingStaff) : go(n));

  const monthFmt = useMemo(() => new Intl.DateTimeFormat(LOCALE[lang], { month: "short", timeZone: "UTC" }), [lang]);
  const longDate = useCallback(
    (d: string) => {
      const [y, m, dd] = d.split("-").map(Number);
      return new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
        new Date(Date.UTC(y, m - 1, dd)),
      );
    },
    [lang],
  );
  const timeOf = (iso: string) => formatTime(iso.slice(11, 16), lang);

  const phoneValid = (p: string) => {
    const n = parsePhoneNumberFromString(p, "CA");
    return !!n && n.isValid();
  };

  const fieldError = (k: "name" | "phone" | "email", f = form): string | undefined => {
    if (k === "name") return f.name.trim() ? undefined : t.book.errName;
    if (k === "phone") return phoneValid(f.phone) ? undefined : t.book.errPhone;
    return f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) ? t.book.errEmail : undefined;
  };
  // Check a field when the visitor leaves it, once there is something to check
  // (or it already showed an error), so a fix clears the message straight away.
  const onBlurField = (k: "name" | "phone" | "email") => {
    if (!errors[k] && !form[k].trim()) return;
    const msg = fieldError(k);
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[k] = msg;
      else delete next[k];
      return next;
    });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const k of ["name", "phone", "email"] as const) {
      const msg = fieldError(k);
      if (msg) errs[k] = msg;
    }
    setErrors(errs);
    const first = ["name", "phone", "email"].find((k) => errs[k]);
    if (first) document.getElementById(`b-${first}`)?.focus();
    if (Object.keys(errs).length || !service || !slot) return;
    setSubmitting(true);
    setBanner("");
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          staffId: staffId === "any" ? undefined : staffId,
          start: slot.start,
          customer: { name: form.name.trim(), phone: form.phone, email: form.email.trim() || undefined },
          notes: form.notes.trim() || undefined,
          source: "web",
          siteLang: lang,
          smsOptIn,
          smsOptInLang: lang,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        router.push(`/book/confirmed/${body.booking.id}`);
        return;
      }
      if (res.status === 409 || body.error === "START_IN_PAST") {
        setBanner(t.book.errTaken);
        setSubmitting(false);
        if (date) await loadDate(date);
        go(2);
        return;
      }
      if (body.error === "INVALID_PHONE") setErrors({ phone: t.book.errPhone });
      else setBanner(t.book.errGeneric);
    } catch {
      setBanner(t.book.errGeneric);
    }
    setSubmitting(false);
  }

  const morning = (slots ?? []).filter((s) => Number(s.start.slice(11, 13)) < 12);
  const afternoon = (slots ?? []).filter((s) => Number(s.start.slice(11, 13)) >= 12);
  const total = t.book.steps.length;

  const stepHeading = (children: React.ReactNode) => (
    <h2 ref={headingRef} tabIndex={-1} className="display text-[1.75rem] outline-none sm:text-[2rem]">
      <span className="sr-only">{fill(t.book.stepOf, { n: step + 1, total })}: </span>
      {children}
    </h2>
  );
  const backButton = (to: number) => (
    <button type="button" onClick={() => backTo(to)} className="s-btn-line">
      {t.common.back}
    </button>
  );

  return (
    <div ref={topRef} className="scroll-mt-4">
      {/* Steps: a real sequence, so they are numbered. */}
      <ol className="mt-6 flex gap-1.5 sm:grid sm:grid-cols-4 sm:gap-3">
        {t.book.steps.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className={`min-w-0 ${active ? "flex-1" : "w-12 shrink-0 sm:w-auto"}`}>
              <button
                type="button"
                disabled={!done}
                onClick={() => backTo(i)}
                aria-current={active ? "step" : undefined}
                aria-label={`${fill(t.book.stepOf, { n: i + 1, total })}: ${label}`}
                className={`flex min-h-11 w-full min-w-0 items-center gap-2 rounded-t-md border-b-[3px] py-2 text-left text-[0.95rem] ${
                  active ? "border-primary font-semibold" : done ? "border-primary/40 hover:border-primary" : "border-rule text-slate"
                } disabled:cursor-default`}
              >
                <span
                  className={`nums grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.85rem] font-semibold ${
                    active ? "bg-primary text-white" : done ? "border-[1.5px] border-primary" : "border-[1.5px] border-edge"
                  }`}
                >
                  {i + 1}
                </span>
                <span aria-hidden="true" className={`truncate ${active ? "" : "hidden sm:inline"}`}>
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {banner && (
        <div role="alert" className="mt-6 rounded-md border-2 border-alert bg-board px-4 py-3 font-medium text-alert">
          {banner}
        </div>
      )}

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-10">
        <div key={step} className="min-w-0 animate-step">
          {step === 0 && (
            <section>
              {stepHeading(t.book.serviceTitle)}
              <div className="mt-6 overflow-hidden rounded-xl bg-board">
                {categories.map((c) => (
                  <div key={c}>
                    <h3 style={{ background: rodColour(c), color: rodText(c) }} className="px-4 py-2.5 font-cond text-[1.3rem] font-semibold leading-none sm:px-5">
                      {categoryName(t, c)}
                    </h3>
                    <ul>
                      {services
                        .filter((s) => s.category === c)
                        .map((s) => (
                          <li key={s.id} className="border-b border-rule last:border-b-0">
                            <button
                              type="button"
                              onClick={() => pickService(s.id)}
                              aria-current={serviceId === s.id ? "true" : undefined}
                              style={{ ["--rod" as string]: rodTint(c) }}
                              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-left hover:bg-[color-mix(in_srgb,var(--rod)_60%,var(--color-board))] sm:grid-cols-[minmax(0,1fr)_6.5rem_4rem] sm:px-5 ${
                                serviceId === s.id ? "bg-[var(--rod)]" : ""
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block text-[1.05rem] font-medium leading-snug">{serviceName(t, s.id, s.name)}</span>
                                <span className="mt-0.5 block text-[0.88rem] leading-snug text-slate">{serviceDesc(t, s.id, s.description)}</span>
                                <span className="nums mt-1 block text-[0.88rem] text-slate sm:hidden">{formatDuration(t, s.durationMin)}</span>
                              </span>
                              <span className="nums hidden text-[0.95rem] text-slate sm:block">{formatDuration(t, s.durationMin)}</span>
                              <span className="nums text-right font-cond text-[1.35rem] font-semibold leading-none">{formatPrice(t, s.priceCAD)}</span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {step === 1 && service && (
            <section>
              {stepHeading(t.book.staffTitle)}
              <ul className="mt-6 overflow-hidden rounded-xl bg-board">
                {[{ id: "any", name: t.book.noPref, sub: t.book.noPrefSub }, ...eligibleStaff.map((s) => ({ id: s.id, name: s.name, sub: roleName(t, s.role) }))].map(
                  (s) => (
                    <li key={s.id} className="border-b border-rule last:border-b-0">
                      <button
                        type="button"
                        onClick={() => pickStaff(s.id)}
                        aria-current={staffId === s.id ? "true" : undefined}
                        className={`flex w-full min-h-16 flex-col justify-center px-4 py-3 text-left hover:bg-tile sm:px-5 ${staffId === s.id ? "bg-primary-wash" : ""}`}
                      >
                        <span className="text-[1.05rem] font-medium">{s.name}</span>
                        <span className="text-[0.92rem] text-slate">{s.sub}</span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
              <div className="mt-6">
                {backButton(0)}
              </div>
            </section>
          )}

          {step === 2 && service && (
            <section>
              {stepHeading(t.book.timeTitle)}
              <div className="no-scrollbar scroll-hint -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
                {days.map((d) => {
                  const open = isOpen(d);
                  const sel = d === date;
                  const [y, m, dd] = d.split("-").map(Number);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={!open}
                      onClick={() => loadDate(d)}
                      aria-pressed={sel}
                      aria-label={`${longDate(d)}${open ? "" : `, ${t.common.closed}`}`}
                      className={`flex w-[4.25rem] shrink-0 flex-col items-center rounded-md border-[1.5px] py-2.5 ${
                        sel
                          ? "border-primary bg-primary text-white"
                          : open
                            ? "border-transparent bg-board hover:border-primary"
                            : "border-dashed border-edge text-slate"
                      }`}
                    >
                      <span className="text-[0.82rem]">{d === today ? t.common.today : t.daysShort[weekdayOf(d)]}</span>
                      <span className="nums mt-0.5 font-cond text-[1.6rem] font-semibold leading-none">{dd}</span>
                      <span className="mt-0.5 text-[0.82rem]">{monthFmt.format(new Date(Date.UTC(y, m - 1, dd)))}</span>
                    </button>
                  );
                })}
              </div>

              <p role="status" className="sr-only">
                {loadingSlots
                  ? t.book.loadingSlots
                  : slots && date
                    ? slots.length
                      ? fill(t.book.slotsFound, { n: slots.length, date: longDate(date) })
                      : `${longDate(date)}. ${isOpen(date) ? t.book.noSlots : t.book.closedDay}`
                    : ""}
              </p>
              <div className="mt-6 min-h-[220px]" aria-busy={loadingSlots}>
                {date && <p className="font-medium">{longDate(date)}</p>}
                {loadingSlots && (
                  <div aria-hidden="true" className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <span key={i} className="h-12 animate-pulse rounded-md bg-white/70" />
                    ))}
                  </div>
                )}
                {!loadingSlots && slots && slots.length === 0 && (
                  <p className="mt-4 rounded-md border-[1.5px] border-dashed border-edge p-5">
                    {date && !isOpen(date) ? t.book.closedDay : t.book.noSlots}
                  </p>
                )}
                {!loadingSlots &&
                  slots &&
                  [
                    { label: t.book.morning, items: morning },
                    { label: t.book.afternoon, items: afternoon },
                  ]
                    .filter((g) => g.items.length)
                    .map((g) => (
                      <div key={g.label} className="mt-5">
                        <h3 className="text-[0.95rem] text-slate">{g.label}</h3>
                        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {g.items.map((s) => {
                            const sel = slot?.start === s.start;
                            return (
                              <button
                                key={s.start}
                                type="button"
                                onClick={() => {
                                  setSlot(s);
                                  setBanner("");
                                }}
                                aria-pressed={sel}
                                className={`nums min-h-12 rounded-md border-[1.5px] px-2 text-[1rem] font-medium ${
                                  sel ? "border-primary bg-primary text-white" : "border-transparent bg-board hover:border-primary"
                                }`}
                              >
                                {timeOf(s.start)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
              </div>
              <div className="mt-8 flex items-center justify-between gap-3">
                {backButton(1)}
                <button type="button" disabled={!slot} onClick={() => go(3)} className="s-btn">
                  {slot ? t.common.continue : t.book.selectTime}
                </button>
              </div>
            </section>
          )}

          {step === 3 && service && slot && (
            <section>
              {stepHeading(t.book.detailsTitle)}
              <form onSubmit={submit} noValidate className="mt-6 grid gap-5 rounded-xl bg-board p-4 sm:grid-cols-2 sm:p-6">
                <div className="sm:col-span-2">
                  <label className="s-label" htmlFor="b-name">{t.book.name}</label>
                  <input
                    id="b-name"
                    autoComplete="name"
                    className="s-field"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    onBlur={() => onBlurField("name")}
                    required
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? "b-name-err" : undefined}
                  />
                  {errors.name && <p id="b-name-err" className="mt-1.5 text-[0.92rem] font-medium text-alert">{errors.name}</p>}
                </div>
                <div>
                  <label className="s-label" htmlFor="b-phone">{t.book.phone}</label>
                  <div className="relative">
                    <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate">
                      +1
                    </span>
                    <input
                      id="b-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="(604) 555-0123"
                      className="s-field !pl-10"
                      value={form.phone}
                      onChange={(e) => {
                        const v = e.target.value;
                        const formatted = v.startsWith("+") ? v : new AsYouType("CA").input(v);
                        setForm({ ...form, phone: v.length < form.phone.length ? v : formatted });
                      }}
                      onBlur={() => onBlurField("phone")}
                      required
                      aria-invalid={!!errors.phone}
                      aria-describedby="b-phone-hint"
                    />
                  </div>
                  {errors.phone ? (
                    <p id="b-phone-hint" className="mt-1.5 text-[0.92rem] font-medium text-alert">{errors.phone}</p>
                  ) : (
                    <p id="b-phone-hint" className="mt-1.5 text-[0.88rem] text-slate">{t.book.phoneHint}</p>
                  )}
                </div>
                <div>
                  <label className="s-label" htmlFor="b-email">{t.book.email}</label>
                  <input
                    id="b-email"
                    type="email"
                    autoComplete="email"
                    className="s-field"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    onBlur={() => onBlurField("email")}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? "b-email-err" : undefined}
                  />
                  {errors.email && <p id="b-email-err" className="mt-1.5 text-[0.92rem] font-medium text-alert">{errors.email}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label className="s-label" htmlFor="b-notes">{t.book.notes}</label>
                  <textarea
                    id="b-notes"
                    rows={3}
                    className="s-field resize-y"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="b-sms"
                    className={`flex cursor-pointer gap-3 rounded-md border-[1.5px] px-4 py-3.5 ${
                      smsOptIn ? "border-primary bg-primary-wash" : "border-edge bg-board hover:border-primary"
                    }`}
                  >
                    <input
                      id="b-sms"
                      type="checkbox"
                      checked={smsOptIn}
                      onChange={(e) => setSmsOptIn(e.target.checked)}
                      aria-describedby="b-sms-fine"
                      className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-primary"
                    />
                    <span>
                      <span className="block leading-snug">{fill(t.book.smsOptIn, { salon: salon.name })}</span>
                      <span id="b-sms-fine" className="mt-1.5 block text-[0.88rem] leading-relaxed text-slate">
                        {fill(t.book.smsOptInFine, { salon: salon.name, address: fullAddress(), phone: formatPhoneDisplay(salon.phone) })}
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex items-center justify-between gap-3 sm:col-span-2">
                  {backButton(2)}
                  <button type="submit" disabled={submitting} aria-busy={submitting || undefined} className="s-btn min-h-12 px-6">
                    {submitting ? t.book.confirming : t.book.confirm}
                  </button>
                </div>
                <p className="text-[0.88rem] leading-relaxed text-slate sm:col-span-2">{fill(t.contact.policy, { h: props.cancellationHours })}</p>
              </form>
            </section>
          )}
        </div>

        <aside aria-labelledby="summary-title" className={`lg:pt-[3.25rem] ${service ? "" : "hidden"}`}>
          <div className="rounded-xl bg-board p-5 lg:sticky lg:top-6">
            <h2 id="summary-title" className="font-cond text-[1.35rem] font-semibold leading-none">
              {t.book.summary}
            </h2>
            <dl className="mt-4 divide-y divide-rule border-y border-rule">
              <SummaryRow
                label={t.book.steps[0]}
                value={service ? serviceName(t, service.id, service.name) : undefined}
                sub={service ? formatDuration(t, service.durationMin) : undefined}
                marker={service ? <Rod category={service.category} className="!h-3 !w-8" /> : undefined}
                onChange={step > 0 ? () => backTo(0) : undefined}
                changeLabel={t.common.change}
                empty={t.book.notChosen}
              />
              <SummaryRow
                label={t.book.steps[1]}
                value={staffId === "any" ? (slot ? slot.staffName : t.book.noPref) : stylist?.name}
                sub={staffId === "any" && slot ? t.book.noPref : undefined}
                onChange={step > 1 ? () => backTo(1) : undefined}
                changeLabel={t.common.change}
                empty={t.book.notChosen}
              />
              <SummaryRow
                label={t.book.steps[2]}
                value={slot && date ? longDate(date) : undefined}
                sub={slot ? `${timeOf(slot.start)}${t.common.to}${timeOf(slot.end)}` : undefined}
                onChange={step > 2 ? () => backTo(2) : undefined}
                changeLabel={t.common.change}
                empty={t.book.notChosen}
              />
            </dl>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="font-medium">{t.book.total}</span>
              <span className="nums font-cond text-[1.75rem] font-semibold leading-none">{service ? formatPrice(t, service.priceCAD) : ""}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  sub,
  marker,
  onChange,
  changeLabel,
  empty,
}: {
  label: string;
  value?: string;
  sub?: string;
  marker?: React.ReactNode;
  onChange?: () => void;
  changeLabel: string;
  empty: string;
}) {
  // dt and dd sit directly in the row (valid dl structure); the grid puts the
  // Change button to the right.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 py-3">
      <dt className="col-start-1 text-[0.88rem] text-slate">{label}</dt>
      <dd className={`col-start-1 mt-0.5 flex min-w-0 items-center gap-2 ${value ? "font-medium" : "text-slate"}`}>
        {marker}
        {value ?? empty}
      </dd>
      {sub && <dd className="nums col-start-1 text-[0.92rem] text-slate">{sub}</dd>}
      {onChange && (
        <dd className="col-start-2 row-span-3 row-start-1 -my-1 self-center">
          <button type="button" onClick={onChange} className="s-link inline-flex min-h-11 min-w-11 items-center justify-end text-[0.92rem]">
            {changeLabel}
            <span className="sr-only"> {label}</span>
          </button>
        </dd>
      )}
    </div>
  );
}
