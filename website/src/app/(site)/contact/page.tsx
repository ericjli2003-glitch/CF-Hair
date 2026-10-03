import type { Metadata } from "next";
import { MapArt } from "@/components/art/MapArt";
import { Arrow } from "@/components/art/Monogram";
import { Reveal } from "@/components/Reveal";
import { ContactForm } from "@/components/site/ContactForm";
import { fill } from "@/lib/i18n/dictionary";
import { formatTime } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { DAY_KEYS, formatPhoneDisplay, fullAddress, isPlaceholderOnly, mapsUrl, salon, SALON_TZ } from "@/lib/salon";
import { dateKeyOf, weekdayOf } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visit & contact" };

export default async function ContactPage() {
  const { lang, t } = await getI18n();
  const today = weekdayOf(dateKeyOf(new Date(), SALON_TZ));
  const showEmail = !isPlaceholderOnly(salon.email);

  return (
    <div className="container-x pb-24 pt-14 md:pt-20">
      <Reveal>
        <p className="eyebrow">{t.contact.eyebrow}</p>
        <h1 className="display mt-6 text-[clamp(3.4rem,9vw,7rem)]">{t.contact.title}</h1>
        <p className="mt-6 max-w-xl leading-relaxed text-ink-soft">{t.contact.lead}</p>
      </Reveal>

      <div className="mt-16 grid gap-12 lg:grid-cols-12">
        <div className="space-y-12 lg:col-span-7">
          <Reveal>
            <a href={mapsUrl()} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-[28px] bg-paper ring-1 ring-line">
              <MapArt className="aspect-[16/10] w-full transition-transform duration-700 group-hover:scale-[1.03]" />
              <span className="absolute bottom-5 left-5 inline-flex items-center gap-3 rounded-full bg-ink px-5 py-3 text-[0.75rem] font-medium uppercase tracking-[0.14em] text-paper">
                {t.home.openMaps}
                <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </a>
          </Reveal>
          <div className="grid gap-10 sm:grid-cols-2">
            <Reveal>
              <p className="label">{t.home.address}</p>
              <p className="mt-3 text-[1.05rem] leading-relaxed">{fullAddress()}</p>
              <p className="label mt-8">{t.home.phone}</p>
              <a href={`tel:${salon.phone}`} className="display link-u mt-2 inline-block text-[2rem]">
                {formatPhoneDisplay(salon.phone)}
              </a>
              {showEmail && (
                <>
                  <p className="label mt-8">{t.contact.email}</p>
                  <a href={`mailto:${salon.email}`} className="link-u mt-3 inline-block">{salon.email}</a>
                </>
              )}
            </Reveal>
            <Reveal delay={80}>
              <p className="label">{t.home.hours}</p>
              <ul className="mt-3 space-y-1.5 text-[0.95rem]">
                {DAY_KEYS.map((d) => {
                  const h = salon.hours[d];
                  return (
                    <li key={d} className={`flex justify-between gap-4 tabular-nums ${d === today ? "font-medium text-clay" : "text-ink-soft"}`}>
                      <span>{t.days[d]}</span>
                      <span>{h ? `${formatTime(h.open, lang)}${t.common.to}${formatTime(h.close, lang)}` : t.common.closed}</span>
                    </li>
                  );
                })}
              </ul>
            </Reveal>
          </div>
          <Reveal>
            <div className="grid gap-6 border-t border-line pt-10 sm:grid-cols-2">
              <div>
                <p className="label">{t.contact.gettingHere}</p>
                <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">{t.contact.gettingHereText}</p>
              </div>
              <div className="space-y-2 text-[0.95rem] leading-relaxed text-ink-soft">
                {salon.policies.walkIns && <p className="label">{t.contact.walkIns}</p>}
                <p>{fill(t.contact.policy, { h: salon.policies.cancellationHours })}</p>
                <p>{fill(t.contact.late, { m: salon.policies.lateMinutes })}</p>
              </div>
            </div>
          </Reveal>
        </div>
        <Reveal delay={120} className="lg:col-span-5">
          <ContactForm />
        </Reveal>
      </div>
    </div>
  );
}
