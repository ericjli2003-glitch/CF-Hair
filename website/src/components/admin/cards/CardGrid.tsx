"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CardView } from "@/lib/cards";
import { charCount, checkCardText, normalizeCardText, type TextIssue } from "@/lib/cards/text";
import { isLanguageCode, LANGUAGE_LABELS } from "@/lib/languages";
import { money, shortDate } from "../promo/ui";
import { CARD_STATUS_LABEL, CardStatusChip, MonthMeter, PROVIDER_LABEL } from "./ui";

type Item = CardView & { language: string };
interface Month {
  label: string;
  used: number;
  cap: number;
  price: number;
}

const INK = "#1d2a5c";
const HAND = "var(--font-caveat), 'Segoe Print', 'Bradley Hand', cursive";
const CJK_HAND: Record<string, string> = {
  "zh-CN": "'Kaiti SC', STKaiti, KaiTi, 'Noto Serif SC', serif",
  "zh-HK": "'Kaiti TC', BiauKai, DFKai-SB, 'Noto Serif TC', 'Noto Serif SC', serif",
  "ko-KR": "'Nanum Pen Script', 'Nanum Myeongjo', 'Noto Serif KR', serif",
};
const PAPER_NOISE = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .42 0 0 0 0 .36 0 0 0 0 .27 0 0 0 .07 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;
const PAPER_SHADOW = "0 1px 1px rgba(60,40,20,.08), 0 6px 14px rgba(60,40,20,.10), 0 22px 40px -18px rgba(60,40,20,.35)";
const RETURN_ADDRESS = ["CF Hair Salon", "2140-1163 Pinetree Way", "Coquitlam BC V3B 8A9"];

const FILTERS = ["all", "pending", "approved", "skipped", "sent", "failed"] as const;

function issuesFor(c: { message: string; messageAlt: string | null; maxChars: number }): TextIssue[] {
  return checkCardText({ message: normalizeCardText(c.message), messageAlt: c.messageAlt ? normalizeCardText(c.messageAlt) : null }, c.maxChars);
}

type Filter = (typeof FILTERS)[number];
const isFilter = (v: unknown): v is Filter => typeof v === "string" && (FILTERS as readonly string[]).includes(v);

export function CardGrid({
  batchId,
  initialCards,
  month: initialMonth,
  initialFilter,
}: {
  batchId: string;
  initialCards: Item[];
  month: Month;
  /** From ?status= in the address, so a reload or a shared link keeps the filter. */
  initialFilter?: string;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initialCards);
  const [used, setUsed] = useState(initialMonth.used);
  const [filter, setFilterState] = useState<Filter>(isFilter(initialFilter) ? initialFilter : "all");
  const setFilter = (f: Filter) => {
    setFilterState(f);
    const url = new URL(window.location.href);
    if (f === "all") url.searchParams.delete("status");
    else url.searchParams.set("status", f);
    window.history.replaceState(window.history.state, "", url);
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [capHit, setCapHit] = useState<{ left: number; ready: number } | null>(null);
  const month = { ...initialMonth, used };
  const left = Math.max(0, month.cap - used);

  const counts = useMemo(() => {
    const n: Record<string, number> = { all: cards.length, pending: 0, approved: 0, skipped: 0, sent: 0, failed: 0 };
    for (const c of cards) n[c.status] = (n[c.status] ?? 0) + 1;
    return n;
  }, [cards]);
  const ready = cards.filter((c) => c.status === "pending" && issuesFor(c).length === 0);
  const needsFix = cards.filter((c) => c.status === "pending").length - ready.length;
  const overCap = ready.length > left;
  const shown = filter === "all" ? cards : cards.filter((c) => c.status === filter);

  function replace(card: CardView) {
    setCards((list) => list.map((c) => (c.id === card.id ? { ...c, ...card, mock: c.mock } : c)));
  }

  async function patch(card: Item, body: Record<string, unknown>): Promise<boolean> {
    setBusy(card.id);
    setErrors((e) => ({ ...e, [card.id]: "" }));
    const res = await fetch(`/api/cards/${card.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      if (data.error === "MONTHLY_CAP") {
        setCapHit({ left: data.left ?? 0, ready: ready.length });
        setErrors((e) => ({ ...e, [card.id]: `This month's limit of ${data.cap} cards is reached.` }));
      } else {
        setErrors((e) => ({ ...e, [card.id]: data.message ?? "Could not save. Try again." }));
      }
      return false;
    }
    const was = card.status === "approved";
    const now = data.card.status === "approved";
    if (was !== now) setUsed((u) => u + (now ? 1 : -1));
    replace(data.card);
    router.refresh();
    return true;
  }

  async function approveAll(limit?: number) {
    setBusy("all");
    const res = await fetch(`/api/cards/batches/${batchId}/approve-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(limit === undefined ? {} : { limit }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.error === "MONTHLY_CAP") {
      setCapHit({ left: data.left ?? 0, ready: data.ready ?? ready.length });
      setBusy(null);
      return;
    }
    const fresh = await fetch(`/api/cards?batchId=${batchId}`).then((r) => r.json());
    setCards((list) => list.map((c) => ({ ...c, ...(fresh.cards as CardView[]).find((f) => f.id === c.id), mock: c.mock })));
    if (res.ok) setUsed(data.used);
    setCapHit(null);
    setBusy(null);
    router.refresh();
  }

  return (
    <>
      <div className="sticky top-[var(--admin-nav-h,4rem)] z-30 -mx-4 mt-6 border-y border-line bg-tile/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div role="group" aria-label="Show cards" className="flex flex-wrap gap-1.5">
            {FILTERS.filter((f) => f === "all" || f === "pending" || counts[f] > 0).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-3.5 text-[0.95rem] ring-1 ${
                  filter === f ? "bg-ink font-medium text-paper ring-ink" : "bg-paper text-ink-soft ring-line hover:text-ink hover:ring-ink"
                }`}
              >
                {f === "all" ? "All" : CARD_STATUS_LABEL[f]}
                <span className={`nums ${filter === f ? "text-paper/80" : "text-ink-soft"}`}>{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="min-w-[14rem] flex-1">
            <MonthMeter compact label={`${month.label}: ${used} of ${month.cap} approved or mailed`} used={used} cap={month.cap} price={month.price} />
          </div>
          {counts.pending > 0 && (
            <button
              type="button"
              disabled={!ready.length || busy === "all"}
              onClick={() => approveAll()}
              className="btn-primary disabled:opacity-40"
            >
              {busy === "all" ? "Approving..." : `Approve all remaining${ready.length ? ` (${ready.length})` : ""}`}
            </button>
          )}
        </div>
      </div>

      {(capHit || (overCap && ready.length > 0)) && (
        <div role="status" className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl bg-amber-50 px-5 py-4 text-amber-950 ring-1 ring-amber-300">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-amber-950">
              {left === 0 ? `This month's limit of ${month.cap} cards is reached.` : `Only ${left} more card${left === 1 ? "" : "s"} fit this month's limit of ${month.cap}.`}
            </p>
            <p className="mt-0.5 text-sm">
              {ready.length} card{ready.length === 1 ? " is" : "s are"} ready to approve, about {money(ready.length * month.price)} CAD.{" "}
              {left === 0 ? "They stay waiting until next month, or raise the limit." : "Approve some now and the rest next month, or raise the limit."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {left > 0 && (
              <button type="button" onClick={() => approveAll(left)} disabled={busy === "all"} className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm text-paper hover:bg-ink-hover disabled:opacity-50">
                Approve the first {left}
              </button>
            )}
            <Link href="/admin/cards#card-settings" className="inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 text-sm text-ink ring-1 ring-ink hover:bg-tile">
              Change the limit
            </Link>
          </div>
        </div>
      )}

      {needsFix > 0 && (
        <p className="mt-4 text-sm text-ink-soft">
          {needsFix} card{needsFix === 1 ? " needs" : "s need"} a fix before approval (too long or punctuation the pen cannot write). &ldquo;Approve all&rdquo; leaves {needsFix === 1 ? "it" : "them"} waiting.
        </p>
      )}

      {shown.length === 0 ? (
        <p className="mt-8 rounded-xl bg-paper p-10 text-center text-ink-soft ring-1 ring-line">
          {filter === "pending" ? "Nothing waiting in this batch. Every card has been approved or skipped." : "No cards here."}
        </p>
      ) : (
        <ul className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((c, i) => (
            <CardItem
              key={c.id}
              card={c}
              tilt={i % 2 ? 0.5 : -0.6}
              busy={busy === c.id || busy === "all"}
              error={errors[c.id]}
              editing={editing === c.id}
              onEdit={() => setEditing(c.id)}
              onCancel={() => setEditing(null)}
              onSave={async (message, messageAlt) => {
                const ok = await patch(c, { message, ...(c.messageAlt !== null || messageAlt ? { messageAlt: messageAlt || null } : {}) });
                if (ok) setEditing(null);
              }}
              onStatus={(status) => patch(c, { status })}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function Chip({ children, tone = "plain", lang }: { children: React.ReactNode; tone?: "plain" | "alt" | "mock"; lang?: string }) {
  const cls =
    tone === "alt"
      ? "bg-[#fbefed] text-[#8c1d1d] ring-[#e7c2bd]"
      : tone === "mock"
        ? "bg-[#fbedc9] text-[#7a5200] ring-[#ecd395]"
        : "bg-paper text-ink-soft ring-line";
  return (
    <span lang={lang} className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs ring-1 ${cls}`}>
      {children}
    </span>
  );
}

function Meter({ n, max, label }: { n: number; max: number; label?: string }) {
  const over = n > max;
  return (
    <span className={`flex items-center gap-2 text-xs tabular-nums ${over ? "text-rose-700" : "text-ink-soft"}`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-sand">
        <span className={`block h-full rounded-full ${over ? "bg-rose-600" : "bg-ink"}`} style={{ width: `${Math.min(100, (n / max) * 100)}%` }} />
      </span>
      {label ? `${label} ` : ""}
      {n} / {max}
    </span>
  );
}

function CardItem(props: {
  card: Item;
  tilt: number;
  busy: boolean;
  error?: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (message: string, messageAlt: string) => void;
  onStatus: (status: "pending" | "approved" | "skipped") => void;
}) {
  const { card: c, editing } = props;
  const [draft, setDraft] = useState(c.message);
  const [draftAlt, setDraftAlt] = useState(c.messageAlt ?? "");
  // Which action is in flight, so only that button says so.
  const [acting, setActing] = useState<"pending" | "approved" | "skipped" | null>(null);
  const act = (status: "pending" | "approved" | "skipped") => {
    setActing(status);
    props.onStatus(status);
  };
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // The editor grows with the text, so the whole card stays readable while typing.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft, editing]);
  const lang = isLanguageCode(c.language) ? LANGUAGE_LABELS[c.language] : null;
  const altLang = c.altLanguage && isLanguageCode(c.altLanguage) ? LANGUAGE_LABELS[c.altLanguage] : null;
  const stored = issuesFor(c);
  const live = editing ? checkCardText({ message: normalizeCardText(draft), messageAlt: draftAlt ? normalizeCardText(draftAlt) : null }, c.maxChars) : stored;
  const n = charCount(editing ? normalizeCardText(draft) : c.message);
  const nAlt = charCount(editing ? normalizeCardText(draftAlt) : (c.messageAlt ?? ""));
  const done = c.status === "sent";
  const dim = c.status === "skipped";
  const a = c.mailingAddress;

  return (
    <li className={`flex flex-col rounded-xl bg-paper p-4 ring-1 transition sm:p-5 ${editing ? "ring-2 ring-ink" : "ring-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-medium leading-tight">
            {c.customerId ? (
              <Link href={`/admin/customers/${c.customerId}`} className="hover:underline">
                {c.name}
              </Link>
            ) : (
              c.name
            )}
          </p>
        </div>
        <CardStatusChip status={c.status} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {c.lastServiceName && <Chip>{c.lastServiceName}</Chip>}
        {c.stylistName && <Chip>{c.stylistName}</Chip>}
        {lang && <Chip tone={altLang ? "alt" : "plain"}>{altLang ? `${altLang.label} line by hand` : lang.label}</Chip>}
        {c.mock && <Chip tone="mock">Sample text</Chip>}
      </div>

      {/* The desk: the inside of the card and its envelope, as on the proof sheet. */}
      <div className={`relative mt-4 rounded-xl bg-tile px-4 pb-5 pt-4 ${dim ? "opacity-55 grayscale-[.4]" : ""}`}>
        <div
          className="relative rounded-[2px] bg-[#fbf8f1] px-5 pb-8 pt-5"
          style={{ boxShadow: PAPER_SHADOW, backgroundImage: PAPER_NOISE, transform: editing ? "none" : `rotate(${props.tilt}deg)` }}
        >
          {editing ? (
            <div className="space-y-2">
              <label className="sr-only" htmlFor={`msg-${c.id}`}>
                Message
              </label>
              <textarea
                id={`msg-${c.id}`}
                ref={boxRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                autoFocus
                className="w-full resize-none overflow-hidden rounded-md border border-dashed border-[#b9c0d8] bg-white/60 px-2 py-1.5 text-[1.3rem] leading-[1.32] focus:border-[#1d2a5c]"
                style={{ fontFamily: HAND, color: INK }}
              />
              {c.altLanguage && (
                <>
                  <label className="text-xs text-mute" htmlFor={`alt-${c.id}`}>
                    {altLang?.native} line, written by hand at the salon
                  </label>
                  <textarea
                    id={`alt-${c.id}`}
                    lang={c.altLanguage}
                    value={draftAlt}
                    onChange={(e) => setDraftAlt(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-md border border-dashed border-[#b9c0d8] bg-white/60 px-2 py-1.5 text-[1rem] leading-relaxed focus:border-[#1d2a5c]"
                    style={{ fontFamily: CJK_HAND[c.altLanguage], color: "#24306a" }}
                  />
                </>
              )}
            </div>
          ) : (
            <>
              <p className="whitespace-pre-line text-[1.32rem] leading-[1.3]" style={{ fontFamily: HAND, color: INK, textShadow: "0 0 .5px rgba(29,42,92,.5)" }}>
                {c.message}
              </p>
              {c.messageAlt && c.altLanguage && (
                <p lang={c.altLanguage} className="mt-3 whitespace-pre-line text-[1rem] leading-relaxed" style={{ fontFamily: CJK_HAND[c.altLanguage], color: "#24306a" }}>
                  {c.messageAlt}
                </p>
              )}
            </>
          )}
          {c.mock && !editing && (
            <span className="absolute bottom-2 left-3 rounded-[3px] bg-[#fbedc9] px-1.5 py-px text-sm font-semibold text-[#8a5a00]">Sample text</span>
          )}
          {altLang && !editing && <span className="absolute bottom-2 right-3 text-xs text-[#a3352f]/80">{altLang.native}: added by hand</span>}
        </div>

        {a && (
          <div
            className="relative -mb-1 ml-auto mt-[-0.4rem] w-[88%] rounded-[2px] bg-[#fcfaf6] px-4 pb-4 pt-3"
            style={{ boxShadow: PAPER_SHADOW, backgroundImage: PAPER_NOISE, transform: `rotate(${-props.tilt * 1.4}deg)` }}
            aria-label="Envelope"
          >
            <div className="flex items-start justify-between">
              <p className="text-[0.85rem] leading-[1.1]" style={{ fontFamily: HAND, color: INK }}>
                {RETURN_ADDRESS.map((l) => (
                  <span key={l} className="block">
                    {l}
                  </span>
                ))}
              </p>
              <span className="grid h-9 w-7 rotate-2 place-items-center rounded-[2px] bg-[#3f5843] text-[0.42rem] text-[#e3eadf] ring-2 ring-[#f3efe6]">Post</span>
            </div>
            <p className="ml-[22%] mt-3 text-[1.18rem] leading-[1.12]" style={{ fontFamily: HAND, color: INK }}>
              <span className="block">{c.name}</span>
              <span className="block">{a.line1}</span>
              {a.line2 && <span className="block">{a.line2}</span>}
              <span className="block">
                {a.city} {a.province} {a.postalCode}
              </span>
            </p>
          </div>
        )}
      </div>

      {editing && live.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm font-medium text-alert" aria-live="polite">
          {live.map((i) => (
            <li key={i.field + i.code}>{i.message}</li>
          ))}
        </ul>
      )}
      {!editing && stored.length > 0 && c.status === "pending" && (
        <ul id={`issues-${c.id}`} className="mt-3 space-y-1 text-sm font-medium text-alert">
          {stored.map((i) => (
            <li key={i.field + i.code}>{i.message}</li>
          ))}
        </ul>
      )}
      {props.error && (
        <p role="alert" className="mt-3 text-sm font-medium text-alert">
          {props.error}
        </p>
      )}

      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-line pt-3">
          <Meter n={n} max={c.maxChars} />
          {c.altLanguage && <Meter n={nAlt} max={c.maxChars} label={altLang?.short} />}
        </div>

        {c.status === "sent" && (
          <p className="mt-3 text-sm text-ink-soft">
            Mailed by {PROVIDER_LABEL[c.provider ?? ""] ?? c.provider} on {c.sentAt ? shortDate(c.sentAt, true) : "?"}
            {c.providerOrderId ? `, order ${c.providerOrderId}` : ""}
            {c.costCAD != null ? `, ${money(c.costCAD)}` : ""}
          </p>
        )}
        {c.status === "failed" && (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">
            Not mailed: {c.error}
            <span className="block text-xs text-rose-700/80">
              {PROVIDER_LABEL[c.provider ?? ""] ?? c.provider ?? "Provider"}
              {c.failedAt ? `, ${shortDate(c.failedAt, true)}` : ""}. Approve it again to retry, or skip it.
            </span>
          </p>
        )}

        {!done && (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {editing ? (
              <>
                <button type="button" onClick={props.onCancel} className="inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm ring-1 ring-line hover:ring-ink">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={props.busy || live.length > 0}
                  onClick={() => props.onSave(draft, draftAlt)}
                  aria-busy={props.busy || undefined}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-paper hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {props.busy ? "Saving..." : "Save text"}
                </button>
              </>
            ) : (
              <>
                {c.status !== "skipped" && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(c.message);
                      setDraftAlt(c.messageAlt ?? "");
                      props.onEdit();
                    }}
                    className="mr-auto inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 text-sm ring-1 ring-line hover:ring-ink"
                  >
                    Edit
                    <span className="sr-only"> card for {c.name}</span>
                  </button>
                )}
                {c.status === "pending" || c.status === "failed" ? (
                  <>
                    <button
                      type="button"
                      disabled={props.busy}
                      aria-busy={(props.busy && acting === "skipped") || undefined}
                      onClick={() => act("skipped")}
                      className="inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 text-sm text-ink-soft ring-1 ring-line hover:text-ink hover:ring-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {props.busy && acting === "skipped" ? "Skipping..." : "Skip"}
                      <span className="sr-only">, card for {c.name}</span>
                    </button>
                    <button
                      type="button"
                      disabled={props.busy || stored.length > 0}
                      aria-busy={(props.busy && acting === "approved") || undefined}
                      aria-describedby={stored.length ? `issues-${c.id}` : undefined}
                      onClick={() => act("approved")}
                      className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 text-sm font-medium text-paper hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {props.busy && acting === "approved" ? "Approving..." : c.status === "failed" ? "Approve again" : "Approve"}
                      <span className="sr-only">, card for {c.name}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={props.busy}
                    aria-busy={(props.busy && acting === "pending") || undefined}
                    onClick={() => act("pending")}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-white px-4 text-sm text-ink-soft ring-1 ring-line hover:text-ink hover:ring-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {props.busy && acting === "pending" ? "Saving..." : c.status === "approved" ? "Undo approval" : "Undo skip"}
                    <span className="sr-only">, card for {c.name}</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
