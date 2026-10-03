"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LanguageCode } from "@/lib/languages";
import { phonePretty } from "@/lib/admin-format";
import { Bubble, PROMO_LANGS, dateTime, money } from "./ui";

type Bodies = Record<LanguageCode, string>;
type AudienceType = "all" | "recent" | "lapsed" | "stylist" | "category" | "birthday";
interface Audience {
  type: AudienceType;
  days?: number;
  minDays?: number;
  maxDays?: number;
  staffId?: string;
  category?: string;
}

interface Preview {
  previews: { language: LanguageCode; text: string; custom: boolean; info: { encoding: string; units: number; segments: number; perSegment: number; remaining: number; nonGsm: string[] } }[];
  audience: {
    matched: number;
    eligibleCount: number;
    skipped: Record<string, number>;
    byLanguage: Record<LanguageCode, number>;
    byConsent: { express: number; implied: number };
    sample: { name: string; language: LanguageCode; basis: string }[];
  };
  segmentsTotal: number;
  estimatedCostUSD: number;
  costPerSegmentUSD: number;
  sendWindow: { now: string; inWindow: boolean; nextAllowed: string };
}

const SKIP_TEXT: Record<string, string> = {
  no_consent: "no consent on file",
  withdrawn: "opted out (STOP)",
  implied_excluded: "implied consent only",
  implied_expired: "implied consent expired",
  frequency_cap: "hit the frequency cap",
  invalid_phone: "invalid number",
  duplicate: "duplicate number",
};

const AUDIENCES: { type: AudienceType; title: string; sub: string }[] = [
  { type: "all", title: "All clients", sub: "Everyone who can receive promotions" },
  { type: "recent", title: "Recent visitors", sub: "Visited in the last N days" },
  { type: "lapsed", title: "Lapsed clients", sub: "Last visit 60 to 120 days ago, nothing booked" },
  { type: "stylist", title: "By usual stylist", sub: "Clients who mostly see one stylist" },
  { type: "category", title: "By service", sub: "Has had a service in a category" },
  { type: "birthday", title: "Birthday this month", sub: "Clients with a birthday this month" },
];

export interface ComposerProps {
  campaignId?: string;
  initial?: { name: string; bodies: Partial<Bodies>; audience: Audience; includeImplied: boolean; scheduledAt?: string | null };
  staff: { id: string; name: string }[];
  categories: string[];
  drafting: boolean;
  ownerPhone: string | null;
  mode: "live" | "outbox" | "blocked";
  cap: { max: number; days: number };
}

function localInput(iso: string): string {
  return iso.slice(0, 16);
}

export function Composer(props: ComposerProps) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState(props.campaignId);
  const [name, setName] = useState(props.initial?.name ?? "");
  const [bodies, setBodies] = useState<Bodies>({
    "en-US": props.initial?.bodies["en-US"] ?? "",
    "zh-CN": props.initial?.bodies["zh-CN"] ?? "",
    "zh-HK": props.initial?.bodies["zh-HK"] ?? "",
    "ko-KR": props.initial?.bodies["ko-KR"] ?? "",
  });
  const [editLang, setEditLang] = useState<LanguageCode>("en-US");
  const [viewLang, setViewLang] = useState<LanguageCode>("en-US");
  const [audience, setAudience] = useState<Audience>(props.initial?.audience ?? { type: "all" });
  const [includeImplied, setIncludeImplied] = useState(props.initial?.includeImplied ?? false);
  const [when, setWhen] = useState<"now" | "later">(props.initial?.scheduledAt ? "later" : "now");
  const [at, setAt] = useState(props.initial?.scheduledAt ? localInput(props.initial.scheduledAt) : "");
  const [fetchedPreview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test" | "send">("");
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const reqId = useRef(0);

  const payload = useMemo(
    () => ({
      name: name.trim() || "Untitled campaign",
      bodies: Object.fromEntries(Object.entries(bodies).filter(([, v]) => v.trim())),
      audience,
      includeImplied,
    }),
    [name, bodies, audience, includeImplied],
  );

  const hasText = !!bodies["en-US"].trim();
  const preview = hasText ? fetchedPreview : null;

  useEffect(() => {
    if (!hasText) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await fetch("/api/campaigns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (id !== reqId.current) return;
      setLoading(false);
      if (res?.ok) setPreview(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [payload, hasText]);

  const view = preview?.previews.find((p) => p.language === viewLang);
  const enInfo = preview?.previews.find((p) => p.language === "en-US")?.info;
  const eligible = preview?.audience.eligibleCount ?? 0;
  const scheduledLocal = when === "later" && at ? at : null;
  const quietWarning = (() => {
    if (!scheduledLocal) return preview && !preview.sendWindow.inWindow ? `Quiet hours now. It will go out at ${dateTime(preview.sendWindow.nextAllowed)}.` : null;
    const hh = Number(scheduledLocal.slice(11, 13));
    if (hh < 9) return "Before 9:00 am. It will go out at 9:00 am that day.";
    if (hh >= 20) return "After 8:00 pm. It will go out at 9:00 am the next day.";
    return null;
  })();

  async function save(): Promise<string | null> {
    setNote(null);
    const res = await fetch(campaignId ? `/api/campaigns/${campaignId}` : "/api/campaigns", {
      method: campaignId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, bodies: { ...payload.bodies, "en-US": bodies["en-US"] } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote({ kind: "err", text: body.message ?? body.error ?? "Could not save" });
      return null;
    }
    setCampaignId(body.campaign.id);
    return body.campaign.id as string;
  }

  async function onSave() {
    setBusy("save");
    const id = await save();
    setBusy("");
    if (id) {
      setNote({ kind: "ok", text: "Draft saved." });
      if (!props.campaignId) router.replace(`/admin/promotions/${id}/edit`);
    }
  }

  async function onTest() {
    setBusy("test");
    const id = await save();
    if (!id) return setBusy("");
    const res = await fetch(`/api/campaigns/${id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: viewLang }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) return setNote({ kind: "err", text: body.message ?? body.error ?? "Test failed" });
    const m = body.message;
    setNote({
      kind: m.status === "failed" ? "err" : "ok",
      text:
        m.status === "failed"
          ? `Test failed: ${m.error}`
          : `Test ${m.dryRun ? "recorded in the outbox" : "sent"} to ${phonePretty(m.phone)} (${PROMO_LANGS.find((l) => l.code === m.language)?.label}).`,
    });
  }

  async function onSend() {
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setBusy("send");
    const id = await save();
    if (!id) return setBusy("");
    const res = await fetch(`/api/campaigns/${id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at: scheduledLocal }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) return setNote({ kind: "err", text: body.message ?? body.error ?? "Could not send" });
    router.push(`/admin/promotions/${id}`);
    router.refresh();
  }

  async function onDraft() {
    if (!brief.trim()) return;
    setDrafting(true);
    setNote(null);
    const res = await fetch("/api/campaigns/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    const body = await res.json().catch(() => ({}));
    setDrafting(false);
    if (!res.ok) return setNote({ kind: "err", text: body.message ?? body.error ?? "Drafting failed" });
    setBodies(body.bodies);
    if (!name.trim()) setName(body.name);
    setNote({ kind: "ok", text: "Drafted in four languages. Read each one before sending." });
  }

  const sectionHead = (n: string, title: string, sub?: string) => (
    <div className="mb-5">
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-clay">{n}</p>
      <h2 className="display mt-1 text-[1.9rem] leading-none">{title}</h2>
      {sub && <p className="mt-1.5 text-sm text-ink-soft">{sub}</p>}
    </div>
  );

  const active = PROMO_LANGS.find((l) => l.code === editLang)!;

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-7">
        {/* 01 Message */}
        <section className="rounded-3xl bg-paper p-6 ring-1 ring-line sm:p-7">
          {sectionHead("01", "Message", "Short and specific works best. The salon name and \"Reply STOP to opt out\" are added for you.")}
          <label className="label" htmlFor="c-name">Campaign name (only you see this)</label>
          <input id="c-name" className="field !py-3" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Autumn colour week" />

          {props.drafting && (
            <div className="mt-5 rounded-2xl bg-[#f3eee7] p-4">
              <label className="label !mb-2" htmlFor="c-brief">Draft with Claude</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="c-brief"
                  className="field !bg-white !py-2.5"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onDraft())}
                  placeholder="One line, e.g. 15% off perms Mon to Thu until Oct 31"
                />
                <button type="button" onClick={onDraft} disabled={drafting || !brief.trim()} className="shrink-0 rounded-xl bg-ink px-4 py-2.5 text-sm text-paper hover:bg-clay disabled:opacity-50">
                  {drafting ? "Writing..." : "Draft 4 languages"}
                </button>
              </div>
              <p className="mt-2 text-xs text-mute">Writes English, 简体中文, 繁體中文 and 한국어 versions. Only facts from your brief are used.</p>
            </div>
          )}

          <div className="mt-5 flex items-end justify-between gap-3">
            <div className="flex rounded-full bg-[#f3eee7] p-1" role="tablist" aria-label="Message language">
              {PROMO_LANGS.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="tab"
                  aria-selected={editLang === l.code}
                  onClick={() => {
                    setEditLang(l.code);
                    setViewLang(l.code);
                  }}
                  className={`relative rounded-full px-3.5 py-2 text-sm transition ${editLang === l.code ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
                >
                  {l.code === "en-US" ? "English" : l.script}
                  {l.code !== "en-US" && bodies[l.code].trim() && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-clay" />}
                </button>
              ))}
            </div>
            <span className="hidden text-xs text-mute sm:inline">{editLang === "en-US" ? "Required" : "Optional"}</span>
          </div>
          <textarea
            lang={editLang}
            rows={4}
            className="field mt-3 resize-none text-[1rem] leading-relaxed"
            value={bodies[editLang]}
            onChange={(e) => setBodies({ ...bodies, [editLang]: e.target.value })}
            placeholder={
              editLang === "en-US"
                ? "e.g. Autumn colour week: 15% off full colour and balayage until Oct 31. Book at cfhair.ca or call us."
                : `Optional. Clients who prefer ${active.label} get the English text if this is empty.`
            }
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-mute">
            <span>
              {editLang === "en-US"
                ? enInfo && enInfo.encoding === "UCS-2"
                  ? `Special characters (${enInfo.nonGsm.slice(0, 4).join(" ")}) switch English to 70 characters per segment.`
                  : "Plain characters keep English at 160 per segment."
                : "Chinese and Korean use 70 characters per segment."}
            </span>
            {view && editLang === viewLang && (
              <span className={view.info.segments > 1 ? "text-clay-deep" : ""}>
                {view.info.units} / {view.info.perSegment * Math.max(1, view.info.segments)} with footer · {view.info.segments} segment{view.info.segments === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </section>

        {/* 02 Audience */}
        <section className="rounded-3xl bg-paper p-6 ring-1 ring-line sm:p-7">
          {sectionHead("02", "Audience", "Only clients who agreed to promotional texts are included. Opted-out clients are never sent anything.")}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {AUDIENCES.map((a) => {
              const on = audience.type === a.type;
              return (
                <button
                  key={a.type}
                  type="button"
                  onClick={() =>
                    setAudience(
                      a.type === "recent"
                        ? { type: a.type, days: audience.days ?? 90 }
                        : a.type === "lapsed"
                          ? { type: a.type, minDays: 60, maxDays: 120 }
                          : a.type === "stylist"
                            ? { type: a.type, staffId: audience.staffId ?? props.staff[0]?.id }
                            : a.type === "category"
                              ? { type: a.type, category: audience.category ?? props.categories[0] }
                              : { type: a.type },
                    )
                  }
                  className={`rounded-2xl px-4 py-3.5 text-left ring-1 transition ${on ? "bg-ink text-paper ring-ink" : "bg-white/60 ring-line hover:ring-ink/40"}`}
                >
                  <span className="block text-[0.95rem] font-medium">{a.title}</span>
                  <span className={`mt-0.5 block text-xs ${on ? "text-paper/70" : "text-mute"}`}>{a.sub}</span>
                </button>
              );
            })}
          </div>

          {audience.type === "recent" && (
            <div className="mt-4 flex items-center gap-3 text-sm">
              <label htmlFor="c-days">Visited in the last</label>
              <input
                id="c-days"
                type="number"
                min={7}
                max={730}
                className="field !w-24 !py-2 text-center"
                value={audience.days ?? 90}
                onChange={(e) => setAudience({ ...audience, days: Number(e.target.value) || 90 })}
              />
              <span>days</span>
            </div>
          )}
          {audience.type === "stylist" && (
            <div className="mt-4 flex flex-wrap gap-2">
              {props.staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setAudience({ ...audience, staffId: s.id })}
                  className={`rounded-full px-4 py-2 text-sm ring-1 ${audience.staffId === s.id ? "bg-clay text-paper ring-clay" : "ring-line"}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {audience.type === "category" && (
            <div className="mt-4 flex flex-wrap gap-2">
              {props.categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAudience({ ...audience, category: c })}
                  className={`rounded-full px-4 py-2 text-sm ring-1 ${audience.category === c ? "bg-clay text-paper ring-clay" : "ring-line"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className={`mt-5 rounded-2xl p-4 ring-1 transition ${includeImplied ? "bg-amber-50/70 ring-amber-200" : "bg-[#f3eee7] ring-transparent"}`}>
            <label className="flex cursor-pointer items-start gap-3">
              <span className="relative mt-0.5 inline-flex shrink-0">
                <input type="checkbox" className="peer sr-only" checked={includeImplied} onChange={(e) => setIncludeImplied(e.target.checked)} />
                <span className="h-6 w-11 rounded-full bg-stone-300 transition peer-checked:bg-clay" />
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
              </span>
              <span>
                <span className="block text-[0.95rem] font-medium">Include implied consent (visited in the last 2 years)</span>
                <span className="mt-1 block text-[0.8rem] leading-relaxed text-ink-soft">
                  Canada&apos;s anti-spam law (CASL) treats a paid visit as an existing business relationship: you may text that client for 2 years from
                  the visit, even if they never ticked a box. The expiry is worked out from each client&apos;s last paid visit, so lapsed relationships drop
                  out automatically. Off by default: express opt-ins are always the safer list. Clients who replied STOP are never included.
                </span>
              </span>
            </label>
          </div>
        </section>

        {/* 03 Send */}
        <section className="rounded-3xl bg-paper p-6 ring-1 ring-line sm:p-7">
          {sectionHead("03", "Send", `No promotional texts before 9:00 am or after 8:00 pm. Each client gets at most ${props.cap.max} promotions per ${props.cap.days} days.`)}
          <div className="flex rounded-full bg-[#f3eee7] p-1 sm:w-80">
            {(["now", "later"] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWhen(w)}
                className={`flex-1 rounded-full px-4 py-2.5 text-sm transition ${when === w ? "bg-ink text-paper" : "text-ink-soft"}`}
              >
                {w === "now" ? "Send now" : "Schedule"}
              </button>
            ))}
          </div>
          {when === "later" && (
            <div className="mt-4 max-w-xs">
              <label className="label" htmlFor="c-at">Date and time (Vancouver)</label>
              <input id="c-at" type="datetime-local" className="field !py-3" value={at} onChange={(e) => setAt(e.target.value)} />
            </div>
          )}
          {quietWarning && <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200">{quietWarning}</p>}
          {props.mode === "outbox" && (
            <p className="mt-3 rounded-xl bg-[#f3eee7] px-3 py-2 text-sm text-ink-soft">
              Outbox mode: Twilio is not connected, so texts are recorded exactly as they would be sent, and nothing leaves the salon.
            </p>
          )}
          {props.mode === "blocked" && (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">
              Set a separate promotions number (TWILIO_PROMO_MESSAGING_SERVICE_SID or TWILIO_PROMO_FROM) before sending. Appointment texts use their own number so a STOP here never blocks reminders.
            </p>
          )}
          {note && (
            <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${note.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-700"}`}>{note.text}</p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSend}
              disabled={!!busy || !bodies["en-US"].trim() || eligible === 0 || props.mode === "blocked" || (when === "later" && !at)}
              className={`btn-clay !px-6 !py-3.5 !normal-case !tracking-normal !text-[0.95rem] disabled:opacity-50 ${confirming ? "!bg-ink" : ""}`}
            >
              {busy === "send"
                ? "Working..."
                : confirming
                  ? `Confirm: ${when === "now" ? "send" : "schedule"} to ${eligible} client${eligible === 1 ? "" : "s"}`
                  : when === "now"
                    ? `Send to ${eligible} client${eligible === 1 ? "" : "s"}`
                    : `Schedule for ${eligible} client${eligible === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={onTest}
              disabled={!!busy || !bodies["en-US"].trim() || !props.ownerPhone || props.mode === "blocked"}
              className="rounded-full px-5 py-3 text-sm ring-1 ring-line hover:ring-ink disabled:opacity-50"
              title={props.ownerPhone ? "" : "Set the owner's phone on the Promotions page"}
            >
              {busy === "test" ? "Sending test..." : props.ownerPhone ? `Send test to ${phonePretty(props.ownerPhone)}` : "Send test (set owner phone)"}
            </button>
            <button type="button" onClick={onSave} disabled={!!busy || !bodies["en-US"].trim()} className="rounded-full px-5 py-3 text-sm text-ink-soft hover:text-ink disabled:opacity-50">
              {busy === "save" ? "Saving..." : "Save draft"}
            </button>
            {confirming && (
              <button type="button" onClick={() => setConfirming(false)} className="text-sm text-mute hover:text-ink">
                Cancel
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Preview */}
      <aside className="lg:col-span-5">
        <div className="space-y-4 lg:sticky lg:top-24">
          <div className="rounded-3xl bg-espresso p-6 text-paper">
            <div className="flex items-center justify-between">
              <p className="text-[0.7rem] uppercase tracking-[0.22em] text-champagne">Live preview</p>
              <div className="flex rounded-full bg-white/10 p-0.5">
                {PROMO_LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setViewLang(l.code)}
                    aria-label={`Preview ${l.label}`}
                    className={`grid h-8 min-w-8 place-items-center rounded-full px-2 text-xs transition ${viewLang === l.code ? "bg-paper text-ink" : "text-paper/70 hover:text-paper"}`}
                  >
                    {l.tab}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 rounded-[1.6rem] bg-[#f8f4ee] p-4 pb-5">
              <p className="text-center text-[0.68rem] text-mute">Text message · {PROMO_LANGS.find((l) => l.code === viewLang)?.label}</p>
              <div className="mt-3 min-h-[5.5rem]">
                {view ? <Bubble text={view.text} lang={viewLang} /> : <p className="pt-6 text-center text-sm text-mute">Start typing the English message.</p>}
              </div>
              {view && !view.custom && viewLang !== "en-US" && (
                <p className="mt-3 text-center text-[0.7rem] text-mute">No {PROMO_LANGS.find((l) => l.code === viewLang)?.script} version: these clients get English.</p>
              )}
            </div>
            {view && (
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white/5 px-2 py-2.5">
                  <p className="display text-[1.6rem] leading-none">{view.info.segments}</p>
                  <p className="mt-1 text-[0.65rem] uppercase tracking-[0.14em] text-paper/60">segment{view.info.segments === 1 ? "" : "s"}</p>
                </div>
                <div className="rounded-xl bg-white/5 px-2 py-2.5">
                  <p className="display text-[1.6rem] leading-none tabular-nums">{view.info.units}</p>
                  <p className="mt-1 text-[0.65rem] uppercase tracking-[0.14em] text-paper/60">of {view.info.segments > 1 ? `${view.info.perSegment} x ${view.info.segments}` : view.info.perSegment}</p>
                </div>
                <div className="rounded-xl bg-white/5 px-2 py-2.5">
                  <p className="pt-1 text-sm font-medium">{view.info.encoding}</p>
                  <p className="mt-1.5 text-[0.65rem] uppercase tracking-[0.14em] text-paper/60">encoding</p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl bg-paper p-6 ring-1 ring-line">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[0.7rem] uppercase tracking-[0.16em] text-mute">Will receive it</p>
                <p className={`display mt-1 text-[3rem] leading-none tabular-nums transition ${loading ? "opacity-40" : ""}`}>{preview ? eligible : "0"}</p>
              </div>
              <div className="text-right">
                <p className="text-[0.7rem] uppercase tracking-[0.16em] text-mute">Estimated cost</p>
                <p className="display mt-1 text-[1.9rem] leading-none tabular-nums">{money(preview?.estimatedCostUSD ?? 0)}</p>
                <p className="mt-1 text-[0.7rem] text-mute">USD · {preview?.segmentsTotal ?? 0} segments x {money(preview?.costPerSegmentUSD ?? 0.0163, 4)}</p>
              </div>
            </div>
            {preview && (
              <>
                <div className="mt-5 flex gap-2 text-xs">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800 ring-1 ring-emerald-200">{preview.audience.byConsent.express} opted in</span>
                  {includeImplied && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-900 ring-1 ring-amber-200">{preview.audience.byConsent.implied} implied</span>
                  )}
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600 ring-1 ring-stone-200">{preview.audience.matched} match the audience</span>
                </div>
                <table className="mt-4 w-full text-sm">
                  <tbody>
                    {PROMO_LANGS.map((l) => {
                      const n = preview.audience.byLanguage[l.code] ?? 0;
                      const seg = preview.previews.find((p) => p.language === l.code)?.info.segments ?? 1;
                      return (
                        <tr key={l.code} className="border-t border-line/70">
                          <td className="py-2">
                            {l.label} <span className="text-mute">{l.code === "en-US" ? "" : l.script}</span>
                          </td>
                          <td className="py-2 text-right tabular-nums">{n}</td>
                          <td className="py-2 text-right text-xs text-mute">{seg} seg</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {Object.keys(preview.audience.skipped).length > 0 && (
                  <div className="mt-4 rounded-2xl bg-[#f3eee7] p-3.5 text-[0.8rem] text-ink-soft">
                    <p className="font-medium text-ink">Not included</p>
                    <ul className="mt-1.5 space-y-0.5">
                      {Object.entries(preview.audience.skipped)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => (
                          <li key={k} className="flex justify-between gap-3">
                            <span>{SKIP_TEXT[k] ?? k}</span>
                            <span className="tabular-nums">{v}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            <Link href="/admin/customers" className="mt-4 inline-block text-xs text-mute hover:text-ink">
              Record a client&apos;s consent on their client page
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
