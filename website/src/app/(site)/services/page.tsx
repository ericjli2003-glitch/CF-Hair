import type { Metadata } from "next";
import { PriceBoard } from "@/components/site/PriceBoard";
import { Rod } from "@/components/site/Rod";
import { getCatalog } from "@/lib/catalog";
import { categoryName } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { formatPhoneDisplay, salon } from "@/lib/salon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Services and prices" };

export default async function ServicesPage() {
  const { lang, t } = await getI18n();
  const { services, staff, categories } = await getCatalog();

  return (
    <div className="frame pb-16 pt-4 md:pt-8">
      <nav aria-label={t.board.title} className="mb-4">
        <ul className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <li key={c}>
              <a
                href={`#${c.toLowerCase()}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-white px-3 text-[0.95rem] font-medium hover:bg-[color-mix(in_srgb,#000_6%,white)]"
              >
                <Rod category={c} className="!h-3 !w-8" />
                {categoryName(t, c)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <PriceBoard services={services} categories={categories} staff={staff} t={t} lang={lang} variant="page" />
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <p className="max-w-[48ch] text-[1.05rem] leading-snug">{t.services.help}</p>
        <a href={`tel:${salon.phone}`} className="s-btn-line nums self-start whitespace-nowrap sm:self-auto">
          {t.common.call} {formatPhoneDisplay(salon.phone)}
        </a>
      </div>
    </div>
  );
}
