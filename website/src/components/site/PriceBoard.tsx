import Link from "next/link";
import type { CatalogService, CatalogStaff } from "@/lib/catalog";
import { bookingHref } from "@/lib/booking-params";
import { fill, type Dict, type Lang } from "@/lib/i18n/dictionary";
import { categoryName, formatDuration, formatPrice, joinList, serviceDesc, serviceName } from "@/lib/i18n/localize";
import { rodColour, rodText, rodTint } from "@/lib/rods";

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
  variant = "home",
}: {
  services: CatalogService[];
  categories: string[];
  staff?: CatalogStaff[];
  t: Dict;
  lang: Lang;
  variant?: "home" | "page";
}) {
  const home = variant === "home";
  const TitleTag = home ? "h2" : "h1";
  const CatTag = home ? "h3" : "h2";
  const used = categories.filter((c) => services.some((s) => s.category === c));
  // On the home page the board is two columns on wide screens: categories in
  // order, split where the two sides come out closest in rows.
  const columns = home ? splitInTwo(used, (c) => services.filter((s) => s.category === c).length + 1) : [used];
  return (
    <section aria-labelledby="board-title" className="rounded-xl bg-board">
      <header className={`px-4 pb-4 pt-5 sm:px-6 ${home ? "" : "sm:pt-7"}`}>
        <TitleTag id="board-title" className={`display ${home ? "text-[1.75rem]" : "text-[clamp(2.25rem,5vw,3.25rem)]"}`}>
          {t.board.title}
        </TitleTag>
        {!home && <p className="mt-1.5 max-w-[60ch] text-[0.95rem] leading-snug text-slate">{t.board.note}</p>}
      </header>
      <div key={lang} className={`animate-fade ${home ? "lg:grid lg:grid-cols-2" : ""}`}>
        {columns.map((col, i) => (
          <div key={i} className={i > 0 ? "lg:border-l lg:border-rule" : ""}>
            {col.map((c) => {
              const items = services.filter((s) => s.category === c);
              return (
                <div key={c} id={home ? undefined : c.toLowerCase()} className="scroll-mt-28">
                  <CatTag
                    style={{ background: rodColour(c), color: rodText(c) }}
                    className="flex items-center gap-3 px-4 py-2.5 font-cond text-[1.35rem] font-semibold leading-none sm:px-6"
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
                          style={{ ["--rod" as string]: rodTint(c) }}
                          className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-rule px-4 py-3 last:border-b-0 hover:bg-[color-mix(in_srgb,var(--rod)_60%,var(--color-board))] sm:grid-cols-[minmax(0,1fr)_6.5rem_4rem_auto] sm:px-6"
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
                              className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-primary bg-board px-4 text-[0.95rem] font-medium text-primary after:absolute after:inset-0 hover:bg-primary hover:text-white"
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
        ))}
      </div>
      {home && (
        <footer className="border-t-2 border-primary px-4 py-3.5 sm:px-6">
          <p className="max-w-[64ch] text-[0.9rem] leading-snug text-slate">{t.board.note}</p>
        </footer>
      )}
    </section>
  );
}

/** Splits items, in order, into two runs whose weights are as even as possible (the first run is never lighter). */
function splitInTwo<T>(items: T[], weight: (item: T) => number): [T[], T[]] {
  const w = items.map(weight);
  const total = w.reduce((a, b) => a + b, 0);
  let best = items.length;
  let bestGap = Infinity;
  let left = 0;
  for (let i = 0; i <= items.length; i++) {
    if (i > 0) left += w[i - 1];
    const gap = left - (total - left);
    if (gap >= 0 && gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return [items.slice(0, best), items.slice(best)];
}
