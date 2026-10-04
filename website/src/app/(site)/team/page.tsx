import type { Metadata } from "next";
import { TeamRows } from "@/components/site/TeamRows";
import { getCatalog } from "@/lib/catalog";
import { fill } from "@/lib/i18n/dictionary";
import { joinList, languageList } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { salon } from "@/lib/salon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { lang, t } = await getI18n();
  const { services, staff, categories } = await getCatalog();
  const langs = joinList(lang, languageList(t, salon.languages));

  return (
    <div className="frame pb-16 pt-4 md:pt-8">
      <h1 className="display text-[clamp(2.25rem,5vw,3.25rem)]">{t.team.title}</h1>
      <p className="mt-3 max-w-[60ch] text-[1.1rem] leading-snug">{t.team.lead}</p>
      <p className="mt-1 max-w-[60ch] text-[1.1rem] leading-snug">{fill(t.team.together, { langs })}</p>
      <div className="mt-8">
        <TeamRows staff={staff} services={services} categories={categories} t={t} lang={lang} detailed headingLevel={2} />
      </div>
    </div>
  );
}
