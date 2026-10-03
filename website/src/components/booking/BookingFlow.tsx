"use client";

import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogService, CatalogStaff } from "@/lib/catalog";
import { fill } from "@/lib/i18n/dictionary";
import { categoryName, formatTime, LOCALE, roleName, serviceDesc, serviceName } from "@/lib/i18n/localize";
import { formatPhoneDisplay, fullAddress, salon, type Hours } from "@/lib/salon";
import { addDays, weekdayOf } from "@/lib/time";
import { Arrow, Sparkle } from "../art/Monogram";
import { useI18n } from "../LangProvider";

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
  initialServiceId?: string;
  initialStaffId?: string;
  cancellationHours: number;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { services, staff, categories, hours, today } = props;

  const [serviceId, setServiceId] = useState<string | undefined>(props.initialServiceId);
  const [staffId, setStaffId] = useState<string | undefined>(
    props.initialServiceId && props.initialStaffId ? props.initialStaffId : undefined,
  );
  const [pendingStaff] = useState<string | undefined>(props.initialStaffId);
  const [step, setStep] = useState(props.initialServiceId ? (staffId ? 2 : 1) : 0);
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

  const service = services.find((s) => s.id === serviceId);
  const stylist = staff.find((s) => s.id === staffId);
  const eligibleStaff = useMemo(() => staff.filter((s) => serviceId && s.serviceIds.includes(serviceId)), [staff, serviceId]);

  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);
  const isOpen = useCallback((d: string) => !!hours[weekdayOf(d)], [hours]);

  const go = (n: number) => {
    setStep(n);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

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

  // Entering the time step: jump to the first day with openings.
  useEffect(() => {
    if (step !== 2 || !serviceId || !staffId) return;
    let cancelled = false;
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
    go(keep ? 2 : 1);
  };
  const pickStaff = (id: string) => {
    setStaffId(id);
    go(2);
  };

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = t.book.errName;
    if (!phoneValid(form.phone)) errs.phone = t.book.errPhone;
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = t.book.errEmail;
    setErrors(errs);
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

  return (
    <div ref={topRef} className="scroll-mt-24">
      {/* Progress */}
      <ol className="mt-10 grid grid-cols-4 gap-2 sm:gap-4">
        {t.book.steps.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!done}
                onClick={() => go(i)}
                className="group w-full text-left disabled:cursor-default"
              >
                <span className={`block h-[3px] rounded-full transition-colors duration-500 ${done || active ? "bg-clay" : "bg-line"}`} />
                <span className={`mt-3 flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] ${active ? "text-ink" : done ? "text-ink-soft group-hover:text-clay" : "text-mute"}`}>
                  <span className="tabular-nums">0{i + 1}</span>
                  <span className="hidden sm:inline">{label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {banner && (
        <div role="alert" className="mt-8 rounded-2xl border border-clay/30 bg-clay/5 px-5 py-4 text-sm text-clay-deep">
          {banner}
        </div>
      )}

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          {step === 0 && (
            <section>
              <h2 className="display text-[2.4rem]">{t.book.serviceTitle}</h2>
              <div className="mt-8 space-y-10">
                {categories.map((c) => (
                  <div key={c}>
                    <p className="eyebrow !text-mute">{categoryName(t, c)}</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {services
                        .filter((s) => s.category === c)
                        .map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => pickService(s.id)}
                            className={`group flex flex-col rounded-2xl border p-5 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-clay hover:shadow-[0_18px_40px_-24px_rgba(122,59,31,0.45)] ${
                              serviceId === s.id ? "border-clay bg-paper" : "border-line bg-paper/60"
                            }`}
                          >
                            <span className="flex items-start justify-between gap-3">
                              <span className="font-medium leading-snug">{serviceName(t, s.id, s.name)}</span>
                              <span className="display shrink-0 text-[1.5rem] leading-none">{s.priceCAD > 0 ? `$${s.priceCAD}` : t.common.free}</span>
                            </span>
                            <span className="mt-2 line-clamp-2 text-[0.85rem] leading-relaxed text-ink-soft">{serviceDesc(t, s.id, s.description)}</span>
                            <span className="mt-4 flex items-center justify-between text-[0.7rem] uppercase tracking-[0.18em] text-mute">
                              {s.durationMin} {t.common.min}
                              <Arrow className="h-4 w-4 text-ink opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100" />
                            </span>
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {step === 1 && service && (
            <section>
              <h2 className="display text-[2.4rem]">{t.book.staffTitle}</h2>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => pickStaff("any")}
                  className={`group flex items-center gap-4 rounded-2xl border p-5 text-left transition hover:border-clay ${staffId === "any" ? "border-clay bg-paper" : "border-line bg-paper/60"}`}
                >
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-espresso text-champagne">
                    <Sparkle className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium">{t.book.noPref}</span>
                    <span className="mt-0.5 block text-sm text-ink-soft">{t.book.noPrefSub}</span>
                  </span>
                </button>
                {eligibleStaff.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickStaff(s.id)}
                    className={`group flex items-center gap-4 rounded-2xl border p-5 text-left transition hover:border-clay ${staffId === s.id ? "border-clay bg-paper" : "border-line bg-paper/60"}`}
                  >
                    <span
                      className="display grid h-14 w-14 shrink-0 place-items-center rounded-full text-[1.7rem] italic text-paper"
                      style={{ background: ["#a2532f", "#6f5a43", "#7c4a45", "#5f6a52"][i % 4] }}
                    >
                      {s.name.replace(/^Stylist\s+/i, "").charAt(0)}
                    </span>
                    <span>
                      <span className="block font-medium">{s.name}</span>
                      <span className="mt-0.5 block text-sm text-ink-soft">{roleName(t, s.role)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 2 && service && (
            <section>
              <h2 className="display text-[2.4rem]">{t.book.timeTitle}</h2>
              <div className="no-scrollbar -mx-5 mt-8 flex gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
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
                      className={`flex w-[4.4rem] shrink-0 flex-col items-center rounded-2xl border py-3 transition ${
                        sel
                          ? "border-ink bg-ink text-paper"
                          : open
                            ? "border-line bg-paper/60 hover:border-clay"
                            : "border-dashed border-line text-mute/60"
                      }`}
                    >
                      <span className="text-[0.62rem] uppercase tracking-[0.16em] opacity-70">
                        {d === today ? t.common.today : t.daysShort[weekdayOf(d)]}
                      </span>
                      <span className="display mt-1 text-[1.7rem] leading-none">{dd}</span>
                      <span className="mt-1 text-[0.62rem] uppercase tracking-[0.14em] opacity-70">
                        {monthFmt.format(new Date(Date.UTC(y, m - 1, dd)))}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-8 min-h-[220px]">
                {date && <p className="text-sm text-ink-soft">{longDate(date)}</p>}
                {loadingSlots && (
                  <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <span key={i} className="h-12 animate-pulse rounded-xl bg-sand/60" />
                    ))}
                  </div>
                )}
                {!loadingSlots && slots && slots.length === 0 && (
                  <p className="mt-6 rounded-2xl border border-dashed border-line p-6 text-ink-soft">
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
                      <div key={g.label} className="mt-6">
                        <p className="eyebrow !text-mute">{g.label}</p>
                        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {g.items.map((s) => {
                            const sel = slot?.start === s.start;
                            return (
                              <button
                                key={s.start}
                                type="button"
                                onClick={() => setSlot(s)}
                                className={`rounded-xl border px-2 py-3 text-[0.92rem] tabular-nums transition ${
                                  sel ? "border-clay bg-clay text-paper shadow-md" : "border-line bg-paper/70 hover:border-clay hover:text-clay"
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
              <div className="mt-10 flex items-center justify-between gap-4">
                <button type="button" onClick={() => go(1)} className="text-sm text-ink-soft link-u">
                  {t.common.back}
                </button>
                <button type="button" disabled={!slot} onClick={() => go(3)} className="btn-primary disabled:cursor-not-allowed disabled:opacity-40">
                  {slot ? t.common.continue : t.book.selectTime}
                  <Arrow className="h-4 w-4" />
                </button>
              </div>
            </section>
          )}

          {step === 3 && service && slot && (
            <section>
              <h2 className="display text-[2.4rem]">{t.book.detailsTitle}</h2>
              <form onSubmit={submit} noValidate className="mt-8 grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="b-name">{t.book.name}</label>
                  <input
                    id="b-name"
                    autoComplete="name"
                    className="field"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    aria-invalid={!!errors.name}
                  />
                  {errors.name && <p className="mt-1.5 text-sm text-clay">{errors.name}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="b-phone">{t.book.phone}</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[0.95rem] text-mute">+1</span>
                    <input
                      id="b-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="(604) 555-0123"
                      className="field !pl-10"
                      value={form.phone}
                      onChange={(e) => {
                        const v = e.target.value;
                        const formatted = v.startsWith("+") ? v : new AsYouType("CA").input(v);
                        setForm({ ...form, phone: v.length < form.phone.length ? v : formatted });
                      }}
                      aria-invalid={!!errors.phone}
                    />
                  </div>
                  {errors.phone ? (
                    <p className="mt-1.5 text-sm text-clay">{errors.phone}</p>
                  ) : (
                    <p className="mt-1.5 text-xs text-mute">{t.book.phoneHint}</p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="b-email">{t.book.email}</label>
                  <input
                    id="b-email"
                    type="email"
                    autoComplete="email"
                    className="field"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    aria-invalid={!!errors.email}
                  />
                  {errors.email && <p className="mt-1.5 text-sm text-clay">{errors.email}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="b-notes">{t.book.notes}</label>
                  <textarea
                    id="b-notes"
                    rows={3}
                    className="field resize-none"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="b-sms"
                    className={`flex cursor-pointer gap-3.5 rounded-xl border px-4 py-3.5 transition ${
                      smsOptIn ? "border-clay/60 bg-paper" : "border-line bg-paper/60 hover:border-ink/30"
                    }`}
                  >
                    <input
                      id="b-sms"
                      type="checkbox"
                      checked={smsOptIn}
                      onChange={(e) => setSmsOptIn(e.target.checked)}
                      className="mt-0.5 h-[1.1rem] w-[1.1rem] shrink-0 cursor-pointer accent-clay"
                    />
                    <span>
                      <span className="block text-[0.92rem] leading-snug text-ink">
                        {fill(t.book.smsOptIn, { salon: salon.name })}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-mute">
                        {fill(t.book.smsOptInFine, { salon: salon.name, address: fullAddress(), phone: formatPhoneDisplay(salon.phone) })}
                      </span>
                    </span>
                  </label>
                </div>
                <div className="flex items-center justify-between gap-4 sm:col-span-2">
                  <button type="button" onClick={() => go(2)} className="link-u text-sm text-ink-soft">
                    {t.common.back}
                  </button>
                  <button type="submit" disabled={submitting} className="btn-clay !px-8 !py-4 disabled:opacity-60">
                    {submitting ? `${t.book.confirming}...` : t.book.confirm}
                    {!submitting && <Arrow className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-mute sm:col-span-2">
                  {fill(t.contact.policy, { h: props.cancellationHours })}
                </p>
              </form>
            </section>
          )}
        </div>

        {/* Summary */}
        <aside className="lg:col-span-4">
          <div className="sticky top-28 overflow-hidden rounded-[24px] bg-espresso text-paper">
            <div className="relative p-7">
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-champagne">{t.book.summary}</p>
              <dl className="mt-6 space-y-5 text-sm">
                <SummaryRow
                  label={t.book.steps[0]}
                  value={service ? serviceName(t, service.id, service.name) : undefined}
                  sub={service ? `${service.durationMin} ${t.common.min}` : undefined}
                  onChange={step > 0 ? () => go(0) : undefined}
                  changeLabel={t.common.change}
                />
                <SummaryRow
                  label={t.book.steps[1]}
                  value={staffId === "any" ? (slot ? slot.staffName : t.book.noPref) : stylist?.name}
                  sub={staffId === "any" && slot ? t.book.noPref : undefined}
                  onChange={step > 1 ? () => go(1) : undefined}
                  changeLabel={t.common.change}
                />
                <SummaryRow
                  label={t.book.steps[2]}
                  value={slot && date ? longDate(date) : undefined}
                  sub={slot ? `${timeOf(slot.start)}${t.common.to}${timeOf(slot.end)}` : undefined}
                  onChange={step > 2 ? () => go(2) : undefined}
                  changeLabel={t.common.change}
                />
              </dl>
              <div className="mt-7 flex items-baseline justify-between border-t border-paper/15 pt-5">
                <span className="text-[0.68rem] uppercase tracking-[0.2em] text-paper/60">{t.book.total}</span>
                <span className="display text-[2.2rem]">{service ? (service.priceCAD > 0 ? `$${service.priceCAD}` : t.common.free) : "."}</span>
              </div>
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
  onChange,
  changeLabel,
}: {
  label: string;
  value?: string;
  sub?: string;
  onChange?: () => void;
  changeLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <dt className="text-[0.66rem] uppercase tracking-[0.2em] text-paper/50">{label}</dt>
        <dd className={`mt-1 ${value ? "text-paper" : "text-paper/30"}`}>{value ?? "..."}</dd>
        {sub && <dd className="text-xs text-paper/60">{sub}</dd>}
      </div>
      {onChange && (
        <button type="button" onClick={onChange} className="text-[0.68rem] uppercase tracking-[0.16em] text-champagne hover:text-paper">
          {changeLabel}
        </button>
      )}
    </div>
  );
}
