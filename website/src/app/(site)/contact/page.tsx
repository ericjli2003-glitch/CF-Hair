import type { Metadata } from "next";
import { ContactForm } from "@/components/site/ContactForm";
import { OpenNow } from "@/components/site/OpenNow";
import { Wayfinding } from "@/components/site/Wayfinding";
import { fill } from "@/lib/i18n/dictionary";
import { formatTime } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { DAY_KEYS, formatPhoneDisplay, fullAddress, isPlaceholderOnly, mapsUrl, salon, SALON_TZ } from "@/lib/salon";
import { dateKeyOf, weekdayOf } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visit" };

export default async function ContactPage() {
  const { lang, t } = await getI18n();
  const today = weekdayOf(dateKeyOf(new Date(), SALON_TZ));
  const showEmail = !isPlaceholderOnly(salon.email);

  return (
    <div className="frame pb-16 pt-4 md:pt-8">
      <h1 className="display text-[clamp(2.25rem,5vw,3.25rem)]">{t.contact.title}</h1>
      <p className="mt-3 max-w-[60ch] text-[1.1rem] leading-snug">{t.contact.lead}</p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0">
          <h2 className="display text-[1.75rem]">{t.way.title}</h2>
          <div className="mt-6">
            <Wayfinding t={t} />
          </div>

          <div className="mt-10 grid gap-8 border-t border-rule pt-8 sm:grid-cols-2">
            <div>
              <h2 className="font-medium">{t.contact.address}</h2>
              <p className="mt-1.5 max-w-[34ch] leading-snug">{fullAddress()}</p>
              <a href={mapsUrl()} target="_blank" rel="noreferrer" className="s-btn-line mt-3">
                {t.common.openMaps}
              </a>
              <h2 className="mt-6 font-medium">{t.contact.phone}</h2>
              <a href={`tel:${salon.phone}`} className="s-link nums mt-1 inline-block font-cond text-[1.6rem] font-semibold">
                {formatPhoneDisplay(salon.phone)}
              </a>
              {showEmail && (
                <>
                  <h2 className="mt-6 font-medium">{t.contact.email}</h2>
                  <a href={`mailto:${salon.email}`} className="s-link mt-1 inline-block">
                    {salon.email}
                  </a>
                </>
              )}
            </div>
            <div>
              <h2 className="font-medium">{t.contact.hours}</h2>
              <OpenNow t={t} lang={lang} className="mt-1.5 text-slate" />
              <dl className="mt-3 max-w-[20rem]">
                {DAY_KEYS.map((d) => {
                  const h = salon.hours[d];
                  return (
                    <div key={d} className={`nums flex justify-between gap-4 py-0.5 ${d === today ? "font-semibold" : ""}`}>
                      <dt>
                        {t.days[d]}
                        {d === today && <span className="sr-only"> ({t.common.today})</span>}
                      </dt>
                      <dd>{h ? `${formatTime(h.open, lang)}${t.common.to}${formatTime(h.close, lang)}` : t.common.closed}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </div>

          <div className="mt-8 border-t border-rule pt-8">
            <h2 className="font-medium">{t.contact.before}</h2>
            <ul className="mt-2 max-w-[60ch] list-disc space-y-1.5 pl-5 leading-snug marker:text-slate">
              {salon.policies.walkIns && <li>{t.contact.walkIns}</li>}
              <li>{fill(t.contact.policy, { h: salon.policies.cancellationHours })}</li>
              <li>{fill(t.contact.late, { m: salon.policies.lateMinutes })}</li>
            </ul>
          </div>
        </div>
        <div className="lg:pt-1">
          <ContactForm />
        </div>
      </div>
    </div>
  );
}
