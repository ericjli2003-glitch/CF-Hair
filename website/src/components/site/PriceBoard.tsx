import Link from "next/link";
import type { CatalogService, CatalogStaff } from "@/lib/catalog";
import { bookingHref } from "@/lib/booking-params";
import { fill, type Dict, type Lang } from "@/lib/i18n/dictionary";
import { categoryName, formatDuration, formatPrice, joinList, serviceDesc, serviceName } from "@/lib/i18n/localize";
import { rodColour } from "@/lib/rods";

/**
 * The salon's price board: every service with its duration and price in the
 * visitor's language, grouped by category under a rod marker, with a Book link
 * per row that opens the booking flow with that service already chosen.
 */
export function PriceBoard({
  services,
  categories,
  staff,
  t,
  lang,
  variant = "hero",
}: {
  services: CatalogService[];
  categories: string[];
  staff?: CatalogStaff[];
  t: Dict;
  lang: Lang;
  variant?: "hero" | "page";
}) {
  const hero = variant === "hero";
  const TitleTag = hero ? "h2" : "h1";
  const CatTag = hero ? "h3" : "h2";
  return (
    <section aria-labelledby="board-title" className="rounded-xl bg-white">
      <header className={`px-4 pb-4 pt-5 sm:px-6 ${hero ? "" : "sm:pt-7"}`}>
        <TitleTag id="board-title" className={`display ${hero ? "text-[1.75rem]" : "text-[clamp(2.25rem,5vw,3.25rem)]"}`}>
          {t.board.title}
        </TitleTag>
        {!hero && <p className="mt-1.5 max-w-[60ch] text-[0.95rem] leading-snug text-slate">{t.board.note}</p>}
      </header>
      <div
        key={lang}
        className={`animate-fade ${hero ? "board-scroll lg:max-h-[calc(100svh-15rem)] lg:min-h-[26rem] lg:overflow-y-auto lg:overscroll-contain" : ""}`}
        {...(hero ? { tabIndex: 0, role: "region", "aria-label": t.board.title } : {})}
      >
        {categories.map((c) => {
          const items = services.filter((s) => s.category === c);
          if (!items.length) return null;
          return (
            <div key={c} id={hero ? undefined : c.toLowerCase()} className="scroll-mt-28">
              <CatTag
                style={{ background: rodColour(c) }}
                className={`flex items-center gap-3 px-4 py-2.5 font-cond text-[1.35rem] font-semibold leading-none sm:px-6 ${
                  hero ? "lg:sticky lg:top-0 lg:z-10" : ""
                }`}
              >
                {categoryName(t, c)}
              </CatTag>
              <ul>
                {items.map((s) => {
                  const name = serviceName(t, s.id, s.name);
                  const by = staff?.filter((x) => x.serviceIds.includes(s.id)).map((x) => x.name);
                  return (
                    <li
                      key={s.id}
                      style={{ ["--rod" as string]: rodColour(c) }}
                      className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-rule px-4 py-3 last:border-b-0 hover:bg-[color-mix(in_srgb,var(--rod)_24%,white)] sm:grid-cols-[minmax(0,1fr)_6.5rem_4rem_auto] sm:px-6"
                    >
                      <div className="min-w-0">
                        <p className="text-[1.05rem] font-medium leading-snug">{name}</p>
                        <p className="mt-0.5 text-[0.88rem] leading-snug text-slate">{serviceDesc(t, s.id, s.description)}</p>
                        {by && by.length > 0 && (
                          <p className="mt-0.5 text-[0.88rem] leading-snug text-slate">{fill(t.board.by, { names: joinList(lang, by) })}</p>
                        )}
                        <p className="nums mt-1 text-[0.88rem] text-slate sm:hidden">{formatDuration(t, s.durationMin)}</p>
                      </div>
                      <p className="nums hidden text-[0.95rem] text-slate sm:block">{formatDuration(t, s.durationMin)}</p>
                      <div className="flex flex-col items-end gap-2 sm:contents">
                        <p className="nums text-right font-cond text-[1.4rem] font-semibold leading-none">{formatPrice(t, s.priceCAD)}</p>
                        <Link
                          href={bookingHref(s.id)}
                          className="inline-flex min-h-10 items-center rounded-md border-[1.5px] border-black bg-white px-4 text-[0.95rem] font-medium after:absolute after:inset-0 hover:bg-black hover:text-white"
                        >
                          {t.board.book}
                          <span className="sr-only"> {name}</span>
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {hero && (
        <footer className="border-t border-black px-4 py-3.5 sm:px-6">
          <p className="max-w-[64ch] text-[0.9rem] leading-snug text-slate">{t.board.note}</p>
        </footer>
      )}
    </section>
  );
}
