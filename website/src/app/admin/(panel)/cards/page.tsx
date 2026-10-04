import Link from "next/link";
import { CardSettings } from "@/components/admin/cards/CardSettings";
import { CARD_STATUS_LABEL, CardStatusChip, MonthMeter } from "@/components/admin/cards/ui";
import { money, shortDate } from "@/components/admin/promo/ui";
import { getCardSettings, listBatches, monthSummary } from "@/lib/cards";

export const dynamic = "force-dynamic";

const ORDER = ["pending", "approved", "sent", "failed", "skipped"] as const;

export default async function CardsPage() {
  const [batches, month, settings] = await Promise.all([listBatches(), monthSummary(), getCardSettings()]);
  const waiting = batches.reduce((n, b) => n + b.counts.pending, 0);
  // Batches still needing a decision first, then the rest newest first.
  const sorted = [...batches].sort((a, b) => Number(b.counts.pending > 0) - Number(a.counts.pending > 0) || b.createdAt.localeCompare(a.createdAt));

  return (
    <div>
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-mute">Handwritten notes</p>
        <h1 className="display mt-1 text-[2.8rem] leading-none">Cards</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Personal notes for clients, written by the card pipeline and handwritten by a pen robot. Read each one, change a word if you like, then approve it. Nothing is mailed until you approve it.
        </p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto]">
        <MonthMeter label={`This month, ${month.label}`} used={month.used} cap={month.cap} price={month.pricePerCardCAD} />
        <div className={`flex min-w-[13rem] flex-col justify-between rounded-2xl p-5 ring-1 ${waiting ? "bg-clay text-paper ring-clay" : "bg-paper ring-line"}`}>
          <p className={`text-[0.7rem] uppercase tracking-[0.14em] ${waiting ? "text-paper/75" : "text-mute"}`}>Waiting for you</p>
          <p className="display mt-1 text-[2rem] leading-none tabular-nums">{waiting}</p>
          <p className={`mt-1.5 text-xs ${waiting ? "text-paper/85" : "text-ink-soft"}`}>{waiting ? `About ${money(waiting * month.pricePerCardCAD)} CAD if all approved` : "All caught up"}</p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-8">
          <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-ink-soft">Batches</h2>
          {sorted.length === 0 ? (
            <div className="mt-3 rounded-2xl bg-paper px-6 py-12 text-center ring-1 ring-line">
              <p className="text-lg font-medium">No cards yet.</p>
              <p className="mx-auto mt-1 max-w-md text-ink-soft">
                When the card pipeline writes a batch (birthdays, thank-yous, &ldquo;we miss you&rdquo; notes), it lands here for you to read and approve.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {sorted.map((b) => {
                const spend = (b.counts.approved + b.counts.sent) * month.pricePerCardCAD;
                return (
                  <li key={b.id}>
                    <Link href={`/admin/cards/${b.id}`} className="group block rounded-2xl bg-paper p-5 ring-1 ring-line transition hover:ring-ink/40 sm:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-medium group-hover:text-clay">{b.campaignName}</p>
                            {b.counts.pending > 0 && <CardStatusChip status="pending" />}
                            {b.mock && <span className="rounded-full bg-[#fbedc9] px-2.5 py-0.5 text-xs text-[#7a5200] ring-1 ring-[#ecd395]">Sample text</span>}
                          </div>
                          <p className="mt-1 text-sm text-mute">
                            {b.occasion} · written {shortDate(b.generatedAt)}
                          </p>
                        </div>
                        <dl className="flex gap-5 text-right">
                          {ORDER.filter((s) => b.counts[s] > 0 || s === "pending").map((s) => (
                            <div key={s}>
                              <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-mute">{CARD_STATUS_LABEL[s]}</dt>
                              <dd className={`display mt-0.5 text-[1.7rem] leading-none tabular-nums ${s === "pending" && b.counts.pending ? "text-clay" : s === "failed" ? "text-rose-700" : ""}`}>
                                {b.counts[s]}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                      <p className="mt-3 text-xs text-ink-soft">
                        {b.counts.total} card{b.counts.total === 1 ? "" : "s"}
                        {spend > 0 ? ` · ${money(spend)} CAD approved or mailed` : ""}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-4 lg:col-span-4">
          <div className="rounded-2xl bg-paper p-5 text-sm leading-relaxed text-ink-soft ring-1 ring-line">
            <p className="font-medium text-ink">How cards work</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <li>Nothing is mailed until you approve it. Skipped cards are never sent.</li>
              <li>The pen robot writes the English. Chinese and Korean lines are written by hand at the salon before the card goes out.</li>
              <li>Edits are checked as you type: the length has to fit the card, and the pen only writes plain punctuation (no emoji or long dashes).</li>
              <li>Cards marked Sample text were filled in from a template, not written for that client. Read them closely.</li>
              <li>Approvals stop at the monthly limit, so a busy month cannot run up the bill.</li>
            </ul>
          </div>
          <CardSettings monthlyCap={settings.monthlyCap} pricePerCardCAD={settings.pricePerCardCAD} />
        </aside>
      </div>
    </div>
  );
}
