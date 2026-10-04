import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignActions, RecipientsTable } from "@/components/admin/promo/Results";
import { Bubble, CampaignStatus, PROMO_LANGS, Tile, dateTime, money } from "@/components/admin/promo/ui";
import { prisma } from "@/lib/db";
import { ATTRIBUTION_DAYS, campaignStats, describeAudience, recipientOutcomes, serializeCampaign } from "@/lib/sms/campaigns";
import { composePromo } from "@/lib/sms/compose";
import { countSegments } from "@/lib/sms/segments";
import { smsMode } from "@/lib/sms/twilio";
import { ChevronIcon } from "@/components/admin/icons";

export const dynamic = "force-dynamic";

const SKIP_WHY: Record<string, string> = {
  no_consent: "with no consent on file",
  withdrawn: "opted out",
  implied_excluded: "with implied consent only (not included)",
  implied_expired: "whose implied consent expired",
  frequency_cap: "at the frequency cap",
  cancelled: "stopped when the campaign was cancelled",
  invalid_phone: "with an invalid number",
  duplicate: "duplicates",
};

export default async function CampaignPage(props: PageProps<"/admin/promotions/[id]">) {
  const { id } = await props.params;
  const row = await prisma.campaign.findUnique({ where: { id } });
  if (!row) notFound();
  const c = serializeCampaign(row);
  const [stats, recipients, staff] = await Promise.all([campaignStats([id]).then((m) => m.get(id)!), recipientOutcomes(id), prisma.staff.findMany()]);
  const staffNames = new Map(staff.map((s) => [s.id, s.name]));
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "");
  const real = recipients.filter((r) => !r.isTest);
  const langs = PROMO_LANGS.filter((l) => l.code === "en-US" || c.bodies[l.code]);
  const notSent = stats.skipped + stats.queued;
  const started = c.status === "sent" || c.status === "sending";

  return (
    <div>
      <Link href="/admin/promotions" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[0.95rem] text-ink-soft hover:text-ink">
        <ChevronIcon dir="left" className="h-4 w-4" />
        Promotions
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display text-[2.6rem] leading-none sm:text-[2.8rem]">{c.name}</h1>
            <CampaignStatus status={c.status} />
            {c.dryRun && <span className="rounded-md bg-tile px-2.5 py-0.5 text-xs text-ink-soft">Outbox (dry run)</span>}
          </div>
          <p className="mt-2 text-ink-soft">
            {describeAudience(c.audience, staffNames)} · {c.includeImplied ? "express and implied consent" : "opted-in clients only"}
            {" · "}
            {c.status === "scheduled" && c.scheduledAt
              ? `goes out ${dateTime(c.scheduledAt)}`
              : c.startedAt
                ? `sent ${dateTime(c.startedAt)}`
                : c.status}
          </p>
          {c.status === "scheduled" && c.requestedAt && c.scheduledAt && c.requestedAt !== c.scheduledAt && (
            <p className="mt-1 text-sm text-sky-900">Requested for {dateTime(c.requestedAt)}, moved out of quiet hours.</p>
          )}
        </div>
        <CampaignActions id={id} status={c.status} canEdit={c.status === "scheduled"} />
      </div>

      {started ? (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Sent" value={String(stats.sent + stats.failed)} sub={`${notSent} not sent (no consent, cap, opted out)`} />
          <Tile label="Delivered" value={String(stats.delivered)} sub={c.dryRun ? "Outbox: no carrier receipts" : pct(stats.delivered, stats.sent + stats.failed) + " of sent"} />
          <Tile label="Failed" value={String(stats.failed)} sub={stats.failed ? "See the error per client" : "None"} />
          <Tile label="Opt-outs" value={String(stats.optOuts)} sub={pct(stats.optOuts, stats.sent) ? `${pct(stats.optOuts, stats.sent)} of recipients` : "None so far"} />
          <Tile label={`Bookings in ${ATTRIBUTION_DAYS} days`} value={String(stats.bookings)} sub={`${money(stats.bookedValueCAD, 0)} CAD booked`} />
          <Tile label="Text cost" value={money(stats.costUSD)} sub={`${stats.segments} segments, USD`} />
        </div>
      ) : (
        <div className="mt-6 rounded-xl bg-sky-50 px-5 py-4 text-sm text-sky-900 ring-1 ring-sky-200">
          {c.status === "scheduled"
            ? "The audience is checked again when it goes out: anyone who opts out before then is left out, and consent and the frequency cap are re-checked for every text."
            : "This campaign was not sent."}
        </div>
      )}

      <section className="mt-6 rounded-xl bg-ink p-6 text-paper">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-white">What clients received</p>
          <p className="text-xs text-paper/60">Each client gets the version for their preferred language, or English.</p>
        </div>
        <div className={`mt-4 grid gap-4 sm:grid-cols-2 ${langs.length > 2 ? "xl:grid-cols-4" : ""}`}>
          {langs.map((l) => {
            const text = composePromo(c.bodies[l.code] ?? "", l.code);
            const info = countSegments(text);
            const n = real.filter((r) => r.language === l.code && (r.status === "sent" || r.status === "delivered" || r.status === "failed")).length;
            return (
              <div key={l.code} className="flex flex-col">
                <p className="mb-1.5 flex justify-between gap-2 text-xs text-paper/70">
                  <span>{l.code === "en-US" ? "English" : `${l.script} · ${l.label}`}</span>
                  <span className="whitespace-nowrap">
                    {info.segments} seg · {info.encoding}
                    {started ? ` · ${n} sent` : ""}
                  </span>
                </p>
                <div className="flex-1 rounded-[1.3rem] bg-tile p-3">
                  <Bubble text={text} lang={l.code} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-medium text-ink-soft">Recipients</h2>
          <p className="text-xs text-mute">A booking counts when the client books within {ATTRIBUTION_DAYS} days of the text (simple attribution).</p>
        </div>
        {Object.keys(stats.skippedByReason).length > 0 && (
          <p className="mt-2 text-sm text-ink-soft">
            Not sent:{" "}
            {Object.entries(stats.skippedByReason)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `${v} ${SKIP_WHY[k] ?? k}`)
              .join(", ")}
            .
          </p>
        )}
        <div className="mt-4">
          {started ? (
            <RecipientsTable rows={recipients} outbox={smsMode() === "outbox" && c.dryRun} />
          ) : (
            <p className="rounded-xl bg-paper p-8 text-center text-ink-soft ring-1 ring-line">The recipient list is built when the campaign goes out.</p>
          )}
        </div>
      </section>
    </div>
  );
}
