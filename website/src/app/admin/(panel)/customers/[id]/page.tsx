import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsentForm } from "@/components/admin/promo/ConsentForm";
import { ConsentChip, dateTime, shortDate } from "@/components/admin/promo/ui";
import { phonePretty } from "@/lib/admin-format";
import { listCustomers } from "@/lib/customers";
import { prisma } from "@/lib/db";
import { LANGUAGE_LABELS } from "@/lib/languages";
import { getConsent, SOURCE_LABEL } from "@/lib/sms/consent";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, { label: string; dot: string }> = {
  express: { label: "Opted in", dot: "bg-emerald-600" },
  resubscribed: { label: "Opted back in", dot: "bg-emerald-600" },
  implied: { label: "Implied consent from a paid visit", dot: "bg-amber-500" },
  implied_expired: { label: "Implied consent expired", dot: "bg-stone-400" },
  withdrawn: { label: "Opted out of promotions", dot: "bg-rose-500" },
  declined: { label: "Declined when asked", dot: "bg-stone-400" },
  help: { label: "Texted HELP", dot: "bg-sky-500" },
  txn_opted_out: { label: "Opted out of appointment texts", dot: "bg-rose-500" },
  txn_resubscribed: { label: "Appointment texts back on", dot: "bg-emerald-600" },
};

const ACTOR: Record<string, string> = { customer: "by the client", owner: "by the owner", agent: "by the phone assistant", system: "automatically" };

export default async function ClientPage(props: PageProps<"/admin/customers/[id]">) {
  const { id } = await props.params;
  const row = await prisma.customer.findUnique({ where: { id } });
  if (!row) notFound();
  const [summary] = await listCustomers({ phone: row.phone });
  const [consent, events, promos, notices, row2, staff] = await Promise.all([
    getConsent(row.phone),
    prisma.consentEvent.findMany({ where: { phone: row.phone }, orderBy: { createdAt: "desc" } }),
    prisma.campaignMessage.findMany({ where: { phone: row.phone, isTest: false }, include: { campaign: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.notification.findMany({ where: { OR: [{ to: row.phone }, ...(row.email ? [{ to: row.email }] : [])] }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.smsConsent.findUnique({ where: { phone: row.phone } }),
    prisma.staff.findMany(),
  ]);
  const lang = LANGUAGE_LABELS[summary.preferredLanguage];
  const fav = staff.find((s) => s.id === summary.favouriteStaffId)?.name;
  const txnOff = row2?.txnOptedOutAt ?? null;

  const statusLine = (() => {
    switch (consent.status) {
      case "express":
        return `Agreed ${consent.consentedAt ? shortDate(consent.consentedAt, true) : ""} via ${(SOURCE_LABEL[consent.source ?? ""] ?? consent.source ?? "").toLowerCase()}. No expiry until they opt out.`;
      case "implied":
        return `${consent.impliedBasis} Expires ${consent.impliedExpiresAt ? shortDate(consent.impliedExpiresAt, true) : ""}. Only texted when a campaign includes implied consent.`;
      case "withdrawn":
        return `Opted out ${consent.withdrawnAt ? dateTime(consent.withdrawnAt).replace(/\.$/, "") : ""}. Never included in promotions until they opt in again.`;
      default:
        return "No promotional consent on file. They only get appointment texts.";
    }
  })();

  return (
    <div>
      <Link href="/admin/customers" className="text-sm text-ink-soft hover:text-ink">
        ‹ Clients
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[2.8rem] leading-none">{row.name}</h1>
          <p className="mt-2 text-ink-soft">
            <a href={`tel:${row.phone}`} className="hover:underline">
              {phonePretty(row.phone)}
            </a>
            {row.email ? ` · ${row.email}` : ""} · {lang.label}
            {summary.preferredLanguage !== "en-US" ? ` (${lang.native})` : ""}
          </p>
        </div>
        <div className="flex gap-6 text-right">
          {[
            ["Visits", String(summary.visitCount)],
            ["Last visit", summary.lastVisit ? shortDate(summary.lastVisit, true) : "None"],
            ["Usual stylist", fav ?? "None"],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-[0.7rem] uppercase tracking-[0.14em] text-mute">{k}</p>
              <p className="display mt-0.5 text-[1.6rem] leading-none">{v}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <section className="space-y-6 lg:col-span-7">
          <div className="rounded-3xl bg-paper p-6 ring-1 ring-line sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-clay">Promotional texts</p>
                <h2 className="display mt-1 text-[1.9rem] leading-none">Consent</h2>
              </div>
              <ConsentChip status={consent.status} size="md" />
            </div>
            <p className="mt-4 leading-relaxed text-ink-soft">{statusLine}</p>
            {consent.wording && consent.status !== "implied" && (
              <figure className="mt-4 rounded-2xl border-l-2 border-clay bg-[#f8f4ee] px-4 py-3">
                <figcaption className="text-[0.68rem] uppercase tracking-[0.14em] text-mute">
                  {consent.status === "withdrawn" ? "What they sent or said" : "Wording they agreed to"}
                  {consent.language ? ` · ${consent.language}` : ""}
                </figcaption>
                <blockquote className="mt-1 text-[0.95rem] leading-relaxed">&ldquo;{consent.wording}&rdquo;</blockquote>
              </figure>
            )}
            {consent.phoneAskDeclinedAt && (
              <p className="mt-3 text-sm text-mute">Said no to the phone assistant on {shortDate(consent.phoneAskDeclinedAt, true)}, so it will not ask again.</p>
            )}
            <div className="mt-5">
              <ConsentForm phone={row.phone} status={consent.status} language={summary.preferredLanguage} />
            </div>
          </div>

          <div className="rounded-3xl bg-paper p-6 ring-1 ring-line sm:p-7">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-clay">Proof log</p>
            <h2 className="display mt-1 text-[1.9rem] leading-none">Consent history</h2>
            <p className="mt-1.5 text-sm text-ink-soft">Every change is added here and never edited, so you can show when and how consent was given or withdrawn.</p>
            {events.length === 0 ? (
              <p className="mt-5 text-sm text-mute">Nothing recorded yet.</p>
            ) : (
              <ol className="relative mt-6 space-y-5 border-l border-line pl-6">
                {events.map((e) => {
                  const meta = EVENT_LABEL[e.type] ?? { label: e.type, dot: "bg-stone-400" };
                  const detail = e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : null;
                  return (
                    <li key={e.id} className="relative">
                      <span className={`absolute -left-[1.85rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-paper ${meta.dot}`} />
                      <p className="text-[0.95rem] font-medium">{meta.label}</p>
                      <p className="text-xs text-mute">
                        {dateTime(e.createdAt.toISOString())} · {SOURCE_LABEL[e.source] ?? e.source} · {ACTOR[e.actor] ?? e.actor}
                        {detail?.method ? ` · ${String(detail.method)}` : ""}
                        {detail?.channel ? ` · ${detail.channel === "promo" ? "promotions number" : "appointment number"}` : ""}
                      </p>
                      {e.wording && <p className="mt-1.5 rounded-xl bg-[#f8f4ee] px-3 py-2 text-sm text-ink-soft">&ldquo;{e.wording}&rdquo;</p>}
                      {e.type === "implied" && detail?.expiresAt ? (
                        <p className="mt-1 text-sm text-ink-soft">
                          Paid visit {shortDate(String(detail.basisVisitAt), true)}, valid to {shortDate(String(detail.expiresAt), true)}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>

        <aside className="space-y-4 lg:col-span-5">
          <div className="rounded-3xl bg-paper p-6 ring-1 ring-line">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Appointment texts</p>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${txnOff ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}
              >
                {txnOff ? "Opted out" : "On"}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {txnOff
                ? `Replied STOP to the appointment number on ${shortDate(txnOff.toISOString(), true)}. The carrier blocks those texts, so confirmations and reminders ${row.email ? `go to ${row.email}` : "cannot be sent: add an email or call them"}. They can text START to turn texts back on.`
                : "Confirmations and reminders come from the appointment number. They do not depend on promotional consent."}
            </p>
            {notices.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-line/70 pt-3 text-xs text-ink-soft">
                {notices.map((n) => (
                  <li key={n.id} className="flex justify-between gap-3">
                    <span className="capitalize">
                      {n.kind} by {n.channel === "none" ? "nothing" : n.channel}
                    </span>
                    <span className="text-mute">
                      {n.status === "dry_run" ? "dry run" : n.status} · {shortDate(n.createdAt.toISOString())}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-3xl bg-paper p-6 ring-1 ring-line">
            <p className="font-medium">Promotions received</p>
            {promos.length === 0 ? (
              <p className="mt-2 text-sm text-mute">None yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {promos.map((m) => (
                  <li key={m.id} className="text-sm">
                    <Link href={`/admin/promotions/${m.campaignId}`} className="font-medium hover:text-clay">
                      {m.campaign.name}
                    </Link>
                    <p className="text-xs text-mute">
                      {m.status === "skipped" ? `Not sent (${m.skipReason?.replace(/_/g, " ")})` : `${m.dryRun ? "Outbox" : m.status} · ${m.sentAt ? shortDate(m.sentAt.toISOString(), true) : ""}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
