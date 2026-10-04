import Link from "next/link";
import { PhotoSlot } from "@/components/art/PhotoSlot";
import type { CatalogService, CatalogStaff } from "@/lib/catalog";
import { bookingHref } from "@/lib/booking-params";
import { fill, type Dict, type Lang } from "@/lib/i18n/dictionary";
import { categoryName, joinList, languageList, roleName, serviceName, staffBio } from "@/lib/i18n/localize";
import { staffLanguages } from "@/lib/salon";
import { Rod } from "./Rod";

/** One row per stylist: photo slot, name, role, what they do, languages, and a way to book them. */
export function TeamRows({
  staff,
  services,
  categories,
  t,
  lang,
  detailed = false,
  headingLevel = 3,
}: {
  staff: CatalogStaff[];
  services: CatalogService[];
  categories: string[];
  t: Dict;
  lang: Lang;
  detailed?: boolean;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="border-t border-rule">
      {staff.map((s) => {
        const offered = services.filter((x) => s.serviceIds.includes(x.id));
        const cats = categories.filter((c) => offered.some((x) => x.category === c));
        const langs = languageList(t, staffLanguages(s.id));
        return (
          <li
            key={s.id}
            className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-4 border-b border-rule py-6 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:gap-x-6"
          >
            <PhotoSlot slot={s.id} label={t.common.photoSlot} alt={s.name} className="aspect-[4/5] w-full" />
            <div className="min-w-0">
              <H className="font-cond text-[1.6rem] font-semibold leading-none">{s.name}</H>
              <p className="mt-1.5 text-[0.95rem] text-slate">{roleName(t, s.role)}</p>
              <p className="mt-3 max-w-[60ch] leading-relaxed">{staffBio(t, s.id, s.bio)}</p>
              {langs.length > 0 && <p className="mt-2 text-[0.95rem] text-slate">{fill(t.team.speaks, { langs: joinList(lang, langs) })}</p>}
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2" aria-label={t.team.does}>
                {cats.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-[0.95rem]">
                    <Rod category={c} className="!h-3 !w-8" />
                    {categoryName(t, c)}
                  </li>
                ))}
              </ul>
              {detailed && (
                <p className="mt-3 max-w-[64ch] text-[0.92rem] leading-relaxed text-slate">
                  {offered.map((x) => serviceName(t, x.id, x.name)).join(t.common.listSep)}
                </p>
              )}
            </div>
            <div className="col-span-2 sm:col-span-1 sm:self-start">
              <Link href={bookingHref(undefined, s.id)} className="s-btn-line w-full whitespace-nowrap sm:w-auto">
                {fill(t.team.bookWith, { name: s.name })}
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
