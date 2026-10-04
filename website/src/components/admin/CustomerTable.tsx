"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CustomerSummary } from "@/lib/customers";
import { dayLabel, phonePretty } from "@/lib/admin-format";
import { LANGUAGE_CODES, LANGUAGE_LABELS, type LanguageCode } from "@/lib/languages";
import { ConsentChip } from "./promo/ui";

const LANG_STYLE: Record<LanguageCode, string> = {
  "en-US": "bg-tile text-slate ring-rule",
  "zh-CN": "bg-red-50 text-red-800 ring-red-200",
  "zh-HK": "bg-amber-50 text-amber-900 ring-amber-200",
  "ko-KR": "bg-sky-50 text-sky-900 ring-sky-200",
};

export function CustomerTable({
  rows,
  staff,
  tags,
  q,
  tag,
  consent,
}: {
  consent: Record<string, { status: string; expiresAt: string | null; txnOptedOut: boolean }>;
  rows: CustomerSummary[];
  staff: { id: string; name: string }[];
  tags: string[];
  q: string;
  tag: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);
  const [langs, setLangs] = useState<Record<string, LanguageCode>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.name ?? "";

  const nav = (next: { q?: string; tag?: string }) => {
    const p = new URLSearchParams();
    const nq = next.q ?? search;
    const nt = next.tag ?? tag;
    if (nq) p.set("q", nq);
    if (nt) p.set("tag", nt);
    router.push(`/admin/customers${p.size ? `?${p}` : ""}`);
  };

  async function setLang(id: string, lang: LanguageCode) {
    setLangs((l) => ({ ...l, [id]: lang }));
    setSaving(id);
    await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredLanguage: lang }),
    });
    setSaving(null);
    router.refresh();
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            nav({ q: search });
          }}
          role="search"
          className="flex min-w-[240px] flex-1 gap-2"
        >
          <label htmlFor="client-search" className="sr-only">
            Search clients by name or phone
          </label>
          <input id="client-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className="field" />
          <button className="btn-primary">Search</button>
        </form>
        <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-2">
          {["", ...tags].map((t) => (
            <button
              key={t || "all"}
              type="button"
              onClick={() => nav({ tag: t })}
              aria-pressed={tag === t}
              className={`shrink-0 inline-flex min-h-11 items-center justify-center rounded-md px-3.5 text-sm ring-1 ${tag === t ? "bg-ink text-paper ring-ink" : "bg-paper text-ink-soft ring-line"}`}
            >
              {t || "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl bg-paper ring-1 ring-line">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-line bg-tile text-sm text-ink-soft">
            <tr>
              <th className="px-5 py-3 font-medium">Client</th>
              <th className="px-3 py-3 font-medium">Language</th>
              <th className="px-3 py-3 font-medium">Promo texts</th>
              <th className="px-3 py-3 text-right font-medium">Visits</th>
              <th className="px-3 py-3 font-medium">Last visit</th>
              <th className="px-3 py-3 font-medium">Last service / next</th>
              <th className="px-3 py-3 font-medium">Usual stylist</th>
              <th className="px-3 py-3 font-medium">Birthday</th>
              <th className="px-5 py-3 font-medium">Tags &amp; referral</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const lang = langs[c.id] ?? c.preferredLanguage;
              return (
                <tr key={c.id} className="border-b border-line/70 last:border-0 hover:bg-tile/50">
                  <td className="px-5 py-3.5">
                    <Link href={`/admin/customers/${c.id}`} className="flex min-h-8 items-center font-medium underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                    <a href={`tel:${c.phone}`} className="nums inline-flex min-h-8 items-center text-ink-soft underline-offset-4 hover:underline">{phonePretty(c.phone)}</a>
                    {c.email && <p className="text-xs text-mute">{c.email}</p>}
                    {c.mailingAddress && (
                      <p className="text-xs text-mute">
                        {c.mailingAddress.line2 ? `${c.mailingAddress.line2}, ` : ""}
                        {c.mailingAddress.line1}, {c.mailingAddress.city}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <label className={`relative inline-flex items-center rounded-full ring-1 ${LANG_STYLE[lang]} ${saving === c.id ? "opacity-60" : ""}`}>
                      <span className="sr-only">Preferred language for {c.name}</span>
                      <select
                        value={lang}
                        onChange={(e) => setLang(c.id, e.target.value as LanguageCode)}
                        className="min-h-8 cursor-pointer appearance-none bg-transparent pl-3 pr-7 text-xs font-medium"
                      >
                        {LANGUAGE_CODES.map((code) => (
                          <option key={code} value={code}>
                            {code === "en-US" ? "English" : `${LANGUAGE_LABELS[code].native} · ${LANGUAGE_LABELS[code].label}`}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-2.5 text-xs">▾</span>
                    </label>
                  </td>
                  <td className="px-3 py-3.5">
                    <Link href={`/admin/customers/${c.id}`} title="Consent details" className="inline-flex min-h-8 items-center">
                      <ConsentChip status={consent[c.id]?.status ?? "none"} expires={consent[c.id]?.expiresAt} />
                    </Link>
                    {consent[c.id]?.txnOptedOut && <p className="mt-1 text-xs text-rose-600">Appt texts off</p>}
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums">
                    <span className="display text-[1.4rem]">{c.visitCount}</span>
                    {c.noShowCount > 0 && <p className="text-xs text-rose-600">{c.noShowCount} no-show</p>}
                  </td>
                  <td className="px-3 py-3.5 text-ink-soft">{c.lastVisit ? dayLabel(c.lastVisit.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }) : "No visits yet"}</td>
                  <td className="px-3 py-3.5">
                    <p className="text-ink-soft">{c.lastServiceName ?? ""}</p>
                    {c.nextBookingAt && (
                      <p className="mt-0.5 inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
                        Next {dayLabel(c.nextBookingAt.slice(0, 10), { month: "short", day: "numeric" })}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-ink-soft">{staffName(c.favouriteStaffId)}</td>
                  <td className="px-3 py-3.5 text-ink-soft">{c.birthday ? dayLabel(c.birthday, { month: "short", day: "numeric" }) : ""}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="rounded-md bg-tile px-2 py-0.5 text-xs text-ink-soft">{t}</span>
                      ))}
                    </div>
                    <ReferredBy id={c.id} value={c.referredBy} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-10 text-center text-ink-soft">No clients match.</p>}
      </div>
    </div>
  );
}

function ReferredBy({ id, value }: { id: string; value: string | null }) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  async function save() {
    if ((value ?? "") === v.trim()) return;
    setState("saving");
    await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referredBy: v.trim() || null }),
    });
    setState("saved");
    router.refresh();
  }
  return (
    <label className="mt-1.5 flex items-center gap-1.5 text-xs text-mute">
      <span className="shrink-0">Referred by</span>
      <input
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          setState("idle");
        }}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="add"
        className="min-h-8 w-28 rounded-md border border-transparent bg-transparent px-1.5 text-ink-soft hover:border-line focus:border-ink focus:bg-white"
      />
      {state === "saving" && <span>...</span>}
      {state === "saved" && <span className="text-emerald-700">saved</span>}
    </label>
  );
}
