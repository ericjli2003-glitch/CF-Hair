import Link from "next/link";
import { RotatingBadge } from "@/components/art/Badge";
import { MapArt } from "@/components/art/MapArt";
import { Arrow, Sparkle } from "@/components/art/Monogram";
import { PhotoSlot } from "@/components/art/PhotoSlot";
import { Strands } from "@/components/art/Strands";
import { Reveal } from "@/components/Reveal";
import { getCatalog } from "@/lib/catalog";
import { fill } from "@/lib/i18n/dictionary";
import { categoryName, formatTime, languageList, roleName, staffBio } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { DAY_KEYS, clean, formatPhoneDisplay, fullAddress, mapsUrl, salon, SALON_TZ } from "@/lib/salon";
import { dateKeyOf, weekdayOf } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { lang, t } = await getI18n();
  const { services, staff, categories } = await getCatalog();
  const todayKey = weekdayOf(dateKeyOf(new Date(), SALON_TZ));
  const langs = languageList(t, salon.languages);
  const tagline = lang === "en" ? clean(salon.tagline) : "";

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -right-40 -top-40 h-[640px] w-[640px] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, #ecd0bd 0%, rgba(236,208,189,0) 70%)" }}
        />
        <div className="container-x relative grid items-center gap-12 pb-16 pt-10 md:pt-16 lg:grid-cols-12 lg:gap-8 lg:pb-24">
          <div className="lg:col-span-7">
            <Reveal>
              <p className="eyebrow flex items-center gap-3">
                <span className="h-px w-10 bg-clay" />
                {t.home.eyebrow}
              </p>
            </Reveal>
            <Reveal delay={80}>
              <h1 className={`display mt-7 text-ink ${lang === "en" ? "text-[clamp(3.2rem,9vw,7.4rem)]" : "text-[clamp(2.8rem,7vw,5.8rem)]"}`}>
                {t.home.titleA}
                <br />
                <em className="font-normal text-clay">{t.home.titleB}</em>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-7 max-w-md text-[1.05rem] leading-relaxed text-ink-soft">
                {tagline && <>{tagline}. </>}
                {t.home.lead}
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href="/book" className="btn-clay group !py-4 !pl-7 !pr-6">
                  {t.home.ctaBook}
                  <Arrow className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
                <a href={`tel:${salon.phone}`} className="btn-ghost !py-4">
                  {t.home.ctaCall} {formatPhoneDisplay(salon.phone)}
                </a>
              </div>
            </Reveal>
            <Reveal delay={320}>
              <dl className="mt-12 grid max-w-xl grid-cols-3 divide-x divide-line border-y border-line text-[0.78rem]">
                <div className="py-4 pr-3">
                  <dt className="text-mute">{t.home.hours}</dt>
                  <dd className="mt-1 text-ink">{t.home.factHours}</dd>
                </div>
                <div className="px-3 py-4 sm:px-4">
                  <dt className="text-mute">{t.home.factLangs}</dt>
                  <dd className="mt-1 text-ink">{langs.join(" · ")}</dd>
                </div>
                <div className="py-4 pl-3 sm:pl-4">
                  <dt className="text-mute">{t.home.address}</dt>
                  <dd className="mt-1 text-ink">{t.home.factTransit}</dd>
                </div>
              </dl>
            </Reveal>
          </div>

          <div className="relative mx-auto w-full max-w-[460px] lg:col-span-5">
            <Reveal delay={150}>
              <PhotoSlot slot="hero" labelPos="br" label={`${t.common.photoSlot}: salon`} className="arch aspect-[4/5.3] w-full shadow-[0_40px_80px_-40px_rgba(37,28,22,0.55)]" priority>
                <Strands className="absolute inset-0 h-full w-full" count={26} seed={2} />
                <div className="absolute inset-x-0 top-[18%] text-center">
                  <span className="display text-[7.5rem] italic leading-none text-paper/90 drop-shadow-sm sm:text-[9rem]">CF</span>
                </div>
              </PhotoSlot>
            </Reveal>
            <div className="absolute -bottom-8 -left-4 sm:-left-10">
              <RotatingBadge text={t.home.badge} className="h-32 w-32 sm:h-36 sm:w-36" />
            </div>
            <div className="absolute -right-2 top-10 hidden animate-float rounded-2xl border border-line bg-paper/90 px-4 py-3 text-xs shadow-lg backdrop-blur sm:block">
              <p className="text-mute">{t.common.today}</p>
              <p className="mt-0.5 font-medium text-ink">
                {salon.hours[todayKey]
                  ? `${formatTime(salon.hours[todayKey]!.open, lang)}${t.common.to}${formatTime(salon.hours[todayKey]!.close, lang)}`
                  : t.common.closed}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <section className="overflow-hidden bg-espresso py-6 text-paper" aria-hidden="true">
        <div className="flex w-max animate-marquee">
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0 items-center">
              {[...t.home.marquee, ...t.home.marquee].map((w, i) => (
                <span key={i} className="flex items-center">
                  <span className="display px-7 text-[2.2rem] italic text-paper/90">{w}</span>
                  <Sparkle className="h-3.5 w-3.5 text-champagne" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* MENU PREVIEW */}
      <section className="container-x grid gap-12 py-24 md:py-32 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <Reveal>
              <p className="eyebrow">{t.home.menuEyebrow}</p>
              <h2 className="display mt-5 text-[clamp(2.6rem,5vw,4.2rem)]">{t.home.menuTitle}</h2>
              <p className="mt-6 max-w-sm leading-relaxed text-ink-soft">{t.home.menuLead}</p>
              <Link href="/services" className="btn-ghost group mt-9">
                {t.home.menuCta}
                <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Reveal>
          </div>
        </div>
        <ol className="border-t border-line lg:col-span-7">
          {categories.map((c, i) => {
            const items = services.filter((s) => s.category === c);
            const paid = items.filter((s) => s.priceCAD > 0);
            const min = paid.length ? Math.min(...paid.map((s) => s.priceCAD)) : 0;
            return (
              <Reveal as="li" key={c} delay={i * 60}>
                <Link
                  href={`/services#${c.toLowerCase()}`}
                  className="group grid grid-cols-[3rem_1fr_auto] items-center gap-4 border-b border-line py-7 transition-colors hover:bg-paper/60 sm:grid-cols-[4rem_1fr_auto_auto] sm:px-2"
                >
                  <span className="text-xs tabular-nums tracking-[0.2em] text-mute">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="display block text-[2.1rem] transition-colors group-hover:text-clay sm:text-[2.5rem]">
                      {categoryName(t, c)}
                    </span>
                    <span className="mt-1 block text-xs uppercase tracking-[0.16em] text-mute">
                      {items.length} {t.home.services}
                    </span>
                  </span>
                  <span className="hidden text-right text-sm text-ink-soft sm:block">
                    {min > 0 ? (
                      lang === "en" ? <>{t.common.from} <span className="text-ink">${min}</span></> : <><span className="text-ink">${min}</span> {t.common.from}</>
                    ) : (
                      t.common.freeConsult
                    )}
                  </span>
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-line transition-all duration-300 group-hover:border-clay group-hover:bg-clay group-hover:text-paper">
                    <Arrow className="h-4 w-4" />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </ol>
      </section>

      {/* WHY US */}
      <section className="bg-paper">
        <div className="container-x grid gap-14 py-24 md:py-32 lg:grid-cols-12 lg:gap-10">
          <Reveal className="lg:col-span-5">
            <PhotoSlot slot="interior" label={`${t.common.photoSlot}: interior`} palette={1} className="aspect-[4/5] w-full rounded-[28px]">
              <Strands className="absolute inset-0 h-full w-full opacity-80" count={18} seed={5} animate={false} />
              <div className="absolute inset-8 rounded-[999px_999px_20px_20px] border border-paper/30" />
            </PhotoSlot>
          </Reveal>
          <div className="lg:col-span-7 lg:pl-8">
            <Reveal>
              <p className="eyebrow">{t.home.whyEyebrow}</p>
              <h2 className="display mt-5 max-w-xl text-[clamp(2.6rem,5vw,4.2rem)]">{t.home.whyTitle}</h2>
            </Reveal>
            <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2">
              {t.home.why.map((w, i) => (
                <Reveal key={w.t} delay={i * 80}>
                  <div className="border-t border-ink/80 pt-5">
                    <span className="display text-[1.1rem] italic text-clay">{["i.", "ii.", "iii.", "iv."][i]}</span>
                    <h3 className="mt-2 text-lg font-medium">{w.t}</h3>
                    <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{fill(w.d, { langs: langs.join(", ") })}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* TEAM */}
      <section className="container-x py-24 md:py-32">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Reveal>
            <p className="eyebrow">{t.home.teamEyebrow}</p>
            <h2 className="display mt-5 text-[clamp(2.6rem,5vw,4.2rem)]">{t.home.teamTitle}</h2>
          </Reveal>
          <Link href="/team" className="btn-ghost group">
            {t.home.teamCta}
            <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {staff.map((s, i) => (
            <Reveal key={s.id} delay={i * 90}>
              <Link href={`/book?staff=${s.id}`} className="group block">
                <PhotoSlot slot={s.id} label={t.team.portrait} palette={i + 1} className="arch aspect-[3/4] w-full">
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="display text-[8rem] italic text-paper/80 transition-transform duration-700 group-hover:scale-105">
                      {s.name.replace(/^Stylist\s+/i, "").charAt(0)}
                    </span>
                  </div>
                </PhotoSlot>
                <div className="mt-5 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="display text-[1.9rem]">{s.name}</h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-clay">{roleName(t, s.role)}</p>
                  </div>
                  <span className="mt-2 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line transition group-hover:border-clay group-hover:bg-clay group-hover:text-paper">
                    <Arrow className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">{staffBio(t, s.id, s.bio)}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* VISIT */}
      <section className="bg-espresso text-paper">
        <div className="container-x grid gap-14 py-24 md:py-28 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <Reveal>
              <p className="eyebrow !text-champagne">{t.home.visitEyebrow}</p>
              <h2 className="display mt-5 text-[clamp(2.6rem,5vw,4.2rem)]">{t.home.visitTitle}</h2>
            </Reveal>
            <Reveal delay={100}>
              <div className="mt-12 grid gap-10 sm:grid-cols-2">
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.22em] text-paper/50">{t.home.hours}</p>
                  <ul className="mt-4 space-y-2 text-[0.95rem]">
                    {DAY_KEYS.map((d) => {
                      const h = salon.hours[d];
                      const isToday = d === todayKey;
                      return (
                        <li key={d} className={`flex justify-between gap-6 tabular-nums ${isToday ? "text-paper" : "text-paper/65"}`}>
                          <span className="flex items-center gap-2">
                            {isToday && <span className="h-1.5 w-1.5 rounded-full bg-clay" />}
                            {t.days[d]}
                          </span>
                          <span>{h ? `${formatTime(h.open, lang)}${t.common.to}${formatTime(h.close, lang)}` : t.common.closed}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="space-y-8 text-[0.95rem]">
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.22em] text-paper/50">{t.home.address}</p>
                    <p className="mt-4 leading-relaxed text-paper/85">{fullAddress()}</p>
                  </div>
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.22em] text-paper/50">{t.home.phone}</p>
                    <a href={`tel:${salon.phone}`} className="link-u mt-4 inline-block text-paper/85">
                      {formatPhoneDisplay(salon.phone)}
                    </a>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
          <Reveal delay={150} className="lg:col-span-6">
            <a
              href={mapsUrl()}
              target="_blank"
              rel="noreferrer"
              className="group relative block overflow-hidden rounded-[28px] border border-paper/10 bg-espresso-2"
            >
              <MapArt dark className="aspect-[4/3] w-full transition-transform duration-700 group-hover:scale-[1.03]" />
              <span className="absolute bottom-5 left-5 right-5 flex items-center justify-between rounded-full bg-paper px-5 py-3 text-[0.78rem] font-medium uppercase tracking-[0.14em] text-espresso">
                {t.home.openMaps}
                <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </a>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <Strands className="pointer-events-none absolute -right-24 top-0 h-full w-[38%] opacity-30" count={20} seed={9} stroke="var(--color-champagne)" animate={false} />
        <div className="container-x relative py-28 text-center md:py-36">
          <Reveal>
            <Sparkle className="mx-auto h-6 w-6 text-clay" />
            <h2 className="display mx-auto mt-6 max-w-3xl text-[clamp(3rem,7vw,6rem)]">{t.home.ctaTitle}</h2>
            <p className="mx-auto mt-6 max-w-md leading-relaxed text-ink-soft">{t.home.ctaLead}</p>
            <Link href="/book" className="btn-clay group mt-10 !px-9 !py-4">
              {t.home.ctaBook}
              <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}
