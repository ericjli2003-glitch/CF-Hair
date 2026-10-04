import Link from "next/link";
import { notFound } from "next/navigation";
import { CardGrid } from "@/components/admin/cards/CardGrid";
import { ChevronIcon } from "@/components/admin/icons";
import { money, shortDate } from "@/components/admin/promo/ui";
import { listCards, monthSummary } from "@/lib/cards";
import { prisma } from "@/lib/db";
import { isLanguageCode } from "@/lib/languages";

export const dynamic = "force-dynamic";

export default async function CardBatchPage(props: PageProps<"/admin/cards/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const batch = await prisma.cardBatch.findUnique({ where: { id } });
  if (!batch) notFound();
  const [cards, month] = await Promise.all([listCards({ batchId: id }), monthSummary()]);
  const customers = await prisma.customer.findMany({
    where: { id: { in: cards.map((c) => c.customerId).filter((x): x is string => !!x) } },
    select: { id: true, preferredLanguage: true },
  });
  const langOf = new Map(customers.map((c) => [c.id, c.preferredLanguage]));
  const items = cards.map((c) => {
    const pref = c.customerId ? langOf.get(c.customerId) : undefined;
    return { ...c, language: c.altLanguage ?? (isLanguageCode(pref) ? pref : "en-US"), mock: c.mock || batch.mock };
  });

  return (
    <div>
      <Link href="/admin/cards" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[0.95rem] text-ink-soft hover:text-ink">
        <ChevronIcon dir="left" className="h-4 w-4" />
        All batches
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[2.8rem] leading-none">{batch.campaignName}</h1>
          <p className="mt-2 text-ink-soft">
            {batch.occasion} · written {shortDate(batch.generatedAt.toISOString())} · {cards.length} card{cards.length === 1 ? "" : "s"} · {money(month.pricePerCardCAD)} a card
          </p>
        </div>
      </div>
      <CardGrid
        batchId={batch.id}
        initialCards={items}
        month={{ label: month.label, used: month.used, cap: month.cap, price: month.pricePerCardCAD }}
        initialFilter={typeof sp.status === "string" ? sp.status : undefined}
      />
    </div>
  );
}
