import type { Metadata } from "next";
import Link from "next/link";
import { Arrow } from "@/components/art/Monogram";
import { Strands } from "@/components/art/Strands";
import { Reveal } from "@/components/Reveal";
import { getCatalog } from "@/lib/catalog";
import { categoryName, serviceDesc, serviceName } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { formatPhoneDisplay, salon } from "@/lib/salon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Services & pricing" };

function duration(min: number, unit: string) {
  return `${min} ${unit}`;
}

export default async function ServicesPage() {
  const { lang, t } = await getI18n();
  const { services, categories } = await getCatalog();

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <Strands className="pointer-events-none absolute -right-24 top-0 h-full w-[55%] opacity-50" count={22} seed={4} stroke="var(--color-champagne)" />
        <div className="container-x relative pb-16 pt-14 md:pb-20 md:pt-20">
          <Reveal>
            <p className="eyebrow">{t.services.eyebrow}</p>
            <h1 className="display mt-6 text-[clamp(3.4rem,9vw,7rem)]">{t.services.title}</h1>
            <p className="mt-6 max-w-xl leading-relaxed text-ink-soft">{t.services.lead}</p>
          </Reveal>
        </div>
      </section>

      <nav className="sticky top-[72px] z-30 border-b border-line bg-bone/90 backdrop-blur" aria-label="Categories">
        <div className="container-x no-scrollbar flex gap-2 overflow-x-auto py-3">
          {categories.map((c) => (
            <a
              key={c}
              href={`#${c.toLowerCase()}`}
              className="shrink-0 rounded-full border border-line px-4 py-1.5 text-[0.78rem] tracking-wide text-ink-soft transition hover:border-ink hover:text-ink"
            >
              {categoryName(t, c)}
            </a>
          ))}
        </div>
      </nav>

      <div className="container-x py-10 md:py-16">
        {categories.map((c, ci) => (
          <section key={c} id={c.toLowerCase()} className="scroll-mt-36 grid gap-8 border-b border-line py-14 last:border-0 lg:grid-cols-12">
            <Reveal className="lg:col-span-4">
              <span className="text-xs tabular-nums tracking-[0.2em] text-mute">{String(ci + 1).padStart(2, "0")}</span>
              <h2 className="display mt-3 text-[2.8rem] italic md:text-[3.4rem]">{categoryName(t, c)}</h2>
              {lang !== "en" && <p className="mt-1 text-xs uppercase tracking-[0.2em] text-mute">{c}</p>}
            </Reveal>
            <ul className="lg:col-span-8">
              {services
                .filter((s) => s.category === c)
                .map((s, i) => (
                  <Reveal as="li" key={s.id} delay={i * 50}>
                    <div className="group grid gap-x-6 border-t border-line/80 py-6 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_auto]">
                      <div>
                        <div className="flex items-baseline gap-3">
                          <h3 className="text-[1.15rem] font-medium">{serviceName(t, s.id, s.name)}</h3>
                          <span className="leader hidden sm:block" />
                          <span className="display ml-auto text-[1.6rem] tabular-nums text-ink sm:ml-0">
                            {s.priceCAD > 0 ? `$${s.priceCAD}` : t.common.free}
                            {s.priceCAD > 0 && <span className="ml-1 align-top font-sans text-[0.65rem] tracking-wider text-mute">+</span>}
                          </span>
                        </div>
                        {lang !== "en" && <p className="text-xs text-mute">{s.name}</p>}
                        <p className="mt-2 max-w-lg text-[0.93rem] leading-relaxed text-ink-soft">{serviceDesc(t, s.id, s.description)}</p>
                        <p className="mt-3 text-[0.72rem] uppercase tracking-[0.18em] text-mute">{duration(s.durationMin, t.common.min)}</p>
                      </div>
                      <div className="mt-4 flex items-end sm:mt-0">
                        <Link
                          href={`/book?service=${s.id}`}
                          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[0.72rem] font-medium uppercase tracking-[0.16em] transition hover:border-clay hover:bg-clay hover:text-paper"
                        >
                          {t.services.bookThis}
                          <Arrow className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  </Reveal>
                ))}
            </ul>
          </section>
        ))}
        <Reveal>
          <div className="mt-6 flex flex-col items-start justify-between gap-6 rounded-[28px] bg-paper p-8 md:flex-row md:items-center md:p-10">
            <p className="display max-w-xl text-[1.8rem] leading-tight">{t.services.note}</p>
            <a href={`tel:${salon.phone}`} className="btn-primary shrink-0">
              {t.common.call} {formatPhoneDisplay(salon.phone)}
            </a>
          </div>
        </Reveal>
      </div>
    </>
  );
}
