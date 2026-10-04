import Link from "next/link";
import { OpenNow } from "@/components/site/OpenNow";
import { PriceBoard } from "@/components/site/PriceBoard";
import { TeamRows } from "@/components/site/TeamRows";
import { Wayfinding } from "@/components/site/Wayfinding";
import { getCatalog } from "@/lib/catalog";
import { fill } from "@/lib/i18n/dictionary";
import { joinList, languageList } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { formatPhoneDisplay, fullAddress, mapsUrl, salon, unitNumber } from "@/lib/salon";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { lang, t } = await getI18n();
  const { services, staff, categories } = await getCatalog();
  const langs = joinList(lang, languageList(t, salon.languages));

  return (
    <>
      <section className="frame grid gap-8 pb-14 pt-4 md:pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:pb-20">
        <div className="lg:sticky lg:top-8 lg:self-start lg:pt-4">
          <h1 className="font-cond text-[clamp(2.75rem,8vw,5.5rem)] font-semibold leading-[0.92] tracking-[-0.01em]">{salon.name}</h1>
          <p className="mt-4 max-w-[30ch] text-balance text-[1.25rem] leading-snug">{fill(t.home.lead, { unit: unitNumber() })}</p>
          <OpenNow t={t} lang={lang} className="mt-6 text-[1.05rem] font-medium" />
          <a href={`tel:${salon.phone}`} className="nums mt-2 inline-block text-[1.05rem] underline decoration-1 underline-offset-[3px] hover:decoration-2">
            {formatPhoneDisplay(salon.phone)}
          </a>
          <div className="mt-6 hidden md:block">
            <Link href="/book" className="s-btn min-h-12 px-6 text-[1.05rem]">
              {t.nav.book}
            </Link>
          </div>
          <p className="mt-6 max-w-[34ch] text-balance text-[0.95rem] leading-snug text-slate">{fill(t.home.speak, { langs })}</p>
        </div>
        <PriceBoard services={services} categories={categories} t={t} lang={lang} />
      </section>

      <section aria-labelledby="getting-here" className="border-t border-rule">
        <div className="frame py-12 md:py-16">
          <h2 id="getting-here" className="display text-[2rem] md:text-[2.25rem]">
            {t.way.title}
          </h2>
          <div className="mt-8">
            <Wayfinding t={t} />
          </div>
          <div className="mt-8 flex flex-col gap-3 text-[1rem] sm:flex-row sm:items-center sm:gap-6">
            <p className="max-w-[44ch] text-balance leading-snug">{fullAddress()}</p>
            <a href={mapsUrl()} target="_blank" rel="noreferrer" className="s-btn-line self-start whitespace-nowrap sm:self-auto">
              {t.common.openMaps}
            </a>
          </div>
        </div>
      </section>

      <section aria-labelledby="team" className="border-t border-rule">
        <div className="frame py-12 md:py-16">
          <h2 id="team" className="display text-[2rem] md:text-[2.25rem]">
            {t.team.title}
          </h2>
          <p className="mt-2 max-w-[60ch] text-slate">{t.team.lead}</p>
          <div className="mt-6">
            <TeamRows staff={staff} services={services} categories={categories} t={t} lang={lang} />
          </div>
          <Link href="/team" className="s-link mt-6 inline-block font-medium">
            {t.home.teamMore}
          </Link>
        </div>
      </section>
    </>
  );
}
