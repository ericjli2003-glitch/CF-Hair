import Link from "next/link";
import { PromoSettings } from "@/components/admin/promo/PromoSettings";
import { CampaignStatus, Tile, dateTime, money } from "@/components/admin/promo/ui";
import { prisma } from "@/lib/db";
import { campaignStats, describeAudience, parseAudience } from "@/lib/sms/campaigns";
import { parseBodies } from "@/lib/sms/compose";
import { consentSummary } from "@/lib/sms/consent";
import { costPerSegmentUSD } from "@/lib/sms/segments";
import { getSmsSettings } from "@/lib/sms/settings";
import { senderFor, smsMode, txnMode } from "@/lib/sms/twilio";

export const dynamic = "force-dynamic";

const LANG_TAB: Record<string, string> = { "zh-CN": "简", "zh-HK": "繁", "ko-KR": "한" };

export default async function PromotionsPage() {
  const now = new Date();
  const monthStart = new Date(now.getTime() - 30 * 86400000);
  const [campaigns, staff, summary, settings, monthMsgs] = await Promise.all([
    prisma.campaign.findMany({ orderBy: [{ createdAt: "desc" }] }),
    prisma.staff.findMany(),
    consentSummary(now),
    getSmsSettings(),
    prisma.campaignMessage.aggregate({
      where: { isTest: false, sentAt: { gte: monthStart }, status: { in: ["sent", "delivered", "failed"] } },
      _count: true,
      _sum: { segments: true },
    }),
  ]);
  const stats = await campaignStats(campaigns.map((c) => c.id));
  const staffNames = new Map(staff.map((s) => [s.id, s.name]));
  const mode = smsMode();
  const order: Record<string, number> = { sending: 0, scheduled: 1, draft: 2, sent: 3, cancelled: 4 };
  const sorted = [...campaigns].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || +b.createdAt - +a.createdAt);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-mute">Text marketing</p>
          <h1 className="display mt-1 text-[2.8rem] leading-none">Promotions</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Specials by text, only to clients who agreed. Every message names the salon and says how to opt out, and replies of STOP take effect at once.
          </p>
        </div>
        <Link href="/admin/promotions/new" className="btn-primary">
          + New campaign
        </Link>
      </div>

      {mode !== "live" && (
        <div className={`mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-5 py-3.5 text-sm ring-1 ${mode === "outbox" ? "bg-tile text-ink-soft ring-line" : "bg-alert-wash text-alert ring-alert-line"}`}>
          <span className="font-medium text-ink">{mode === "outbox" ? "Outbox mode" : "Promotions number missing"}</span>
          <span>
            {mode === "outbox"
              ? "Twilio is not connected, so campaigns are recorded exactly as they would be sent and nothing leaves the salon. Open a sent campaign to see the outbox and simulate replies."
              : "Add a separate promotions sender (TWILIO_PROMO_MESSAGING_SERVICE_SID or TWILIO_PROMO_FROM). Campaigns will not send from the appointment number."}
          </span>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Opted in" value={String(summary.express)} sub="Express consent, no expiry" />
        <Tile label="Implied consent" value={String(summary.implied)} sub={`Paid visit in 2 years · ${summary.impliedExpiringSoon} expire within 60 days`} />
        <Tile label="Opted out" value={String(summary.withdrawn)} sub="Replied STOP or asked to stop" />
        <Tile
          label="Texts, last 30 days"
          value={String(monthMsgs._count)}
          sub={`${monthMsgs._sum.segments ?? 0} segments · about ${money((monthMsgs._sum.segments ?? 0) * costPerSegmentUSD())} USD`}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-8">
          <h2 className="text-sm font-medium text-ink-soft">Campaigns</h2>
          {sorted.length === 0 ? (
            <div className="mt-3 rounded-xl bg-paper p-10 text-center text-ink-soft ring-1 ring-line">
              No campaigns yet. <Link href="/admin/promotions/new" className="underline underline-offset-4">Write the first one</Link>.
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {sorted.map((c) => {
                const s = stats.get(c.id)!;
                const bodies = parseBodies(c.bodies);
                const audience = parseAudience(c.audience);
                const href = c.status === "draft" ? `/admin/promotions/${c.id}/edit` : `/admin/promotions/${c.id}`;
                return (
                  <li key={c.id}>
                    <Link href={href} className="group block rounded-xl bg-paper p-5 ring-1 ring-line transition hover:ring-primary/40 sm:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-medium group-hover:underline">{c.name}</p>
                            <CampaignStatus status={c.status} />
                            {c.dryRun && <span className="rounded-md bg-tile px-2 py-0.5 text-xs text-ink-soft">Outbox</span>}
                          </div>
                          <p className="mt-1 text-sm text-mute">
                            {describeAudience(audience, staffNames)}
                            {c.includeImplied ? " · incl. implied consent" : " · opted-in only"}
                            {" · "}
                            {c.status === "scheduled" && c.scheduledAt
                              ? `Goes out ${dateTime(c.scheduledAt.toISOString())}`
                              : c.startedAt
                                ? `Sent ${dateTime(c.startedAt.toISOString())}`
                                : `Created ${dateTime(c.createdAt.toISOString())}`}
                          </p>
                          <p className="mt-3 line-clamp-2 max-w-xl text-[0.92rem] text-ink-soft">{bodies["en-US"]}</p>
                          <div className="mt-2 flex gap-1">
                            {Object.keys(bodies)
                              .filter((l) => l !== "en-US")
                              .map((l) => (
                                <span key={l} className="grid h-6 min-w-6 place-items-center rounded-full bg-tile px-1.5 text-xs text-ink-soft">
                                  {LANG_TAB[l]}
                                </span>
                              ))}
                          </div>
                        </div>
                        {(c.status === "sent" || c.status === "sending") && (
                          <dl className="grid grid-cols-4 gap-4 text-right">
                            {[
                              ["Sent", s.sent],
                              ["Delivered", s.delivered],
                              ["Opt-outs", s.optOuts],
                              ["Bookings", s.bookings],
                            ].map(([k, v]) => (
                              <div key={k as string}>
                                <dt className="text-sm text-mute">{k}</dt>
                                <dd className={`display mt-0.5 text-[1.7rem] leading-none tabular-nums ${k === "Bookings" && Number(v) > 0 ? "text-ink" : ""}`}>{v}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                      {(c.status === "sent" || c.status === "sending") && s.bookings > 0 && (
                        <p className="mt-3 text-xs text-primary">
                          {money(s.bookedValueCAD, 0)} CAD booked within 14 days for {money(s.costUSD)} USD of texts
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-4 lg:col-span-4">
          <PromoSettings
            capMax={settings.frequencyCap.max}
            capDays={settings.frequencyCap.days}
            ownerPhone={settings.ownerPhone}
            promoSender={!!senderFor("promo")}
            txnSender={!!senderFor("transactional")}
            promoMode={mode}
            txnMode={txnMode()}
          />
          <div className="rounded-xl bg-paper p-5 text-sm leading-relaxed text-ink-soft ring-1 ring-line">
            <p className="font-medium text-ink">The rules, built in</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <li>Express consent by default. Implied consent (paid visit in the last 2 years) only when you tick it, with expiry worked out per client.</li>
              <li>Every text starts with the salon name and ends with how to opt out, counted in the length.</li>
              <li>STOP, 退订 or 수신거부 opts out immediately and is logged as proof.</li>
              <li>No promotions before 9:00 am or after 8:00 pm.</li>
              <li>Appointment texts come from a separate number and never depend on promotional consent.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
