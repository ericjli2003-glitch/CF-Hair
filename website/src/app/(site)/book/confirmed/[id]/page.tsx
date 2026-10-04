import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Arrow, Sparkle } from "@/components/art/Monogram";
import { Strands } from "@/components/art/Strands";
import { getBooking } from "@/lib/bookings";
import { fill } from "@/lib/i18n/dictionary";
import { formatTime, LOCALE, serviceName } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { formatPhoneDisplay, fullAddress, mapsUrl, salon } from "@/lib/salon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking confirmed", robots: { index: false } };

export default async function ConfirmedPage(props: PageProps<"/book/confirmed/[id]">) {
  const { id } = await props.params;
  const booking = await getBooking(id);
  if (!booking) notFound();
  const { lang, t } = await getI18n();
  const [y, m, d] = booking.start.slice(0, 10).split("-").map(Number);
  const dateLabel = new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
  const time = `${formatTime(booking.start.slice(11, 16), lang)}${t.common.to}${formatTime(booking.end.slice(11, 16), lang)}`;
  const firstName = booking.customer.name.split(/\s+/)[0];

  return (
    <div className="container-x pb-24 pt-12 md:pt-16">
      <div className="mx-auto max-w-3xl">
        <div className="relative overflow-hidden rounded-[32px] bg-espresso px-7 py-12 text-paper sm:px-12 sm:py-16">
          <Strands className="pointer-events-none absolute -right-10 top-0 h-full w-2/3 opacity-60" count={22} seed={7} />
          <div className="relative">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-clay">
              <Sparkle className="h-6 w-6 text-paper" />
            </span>
            <p className="mt-8 text-[0.7rem] uppercase tracking-[0.24em] text-champagne">{t.confirmed.eyebrow}</p>
            <h1 className="display mt-3 text-[clamp(3rem,8vw,5.5rem)]">{t.confirmed.title}</h1>
            <p className="mt-5 max-w-md leading-relaxed text-paper/75">
              {fill(t.confirmed.lead, { name: firstName, phone: "\u0000" })
                .split("\u0000")
                .map((part, i) => (
                  <span key={i}>
                    {i > 0 && <span className="whitespace-nowrap text-paper">{formatPhoneDisplay(booking.customer.phone)}</span>}
                    {part}
                  </span>
                ))}
            </p>
          </div>
        </div>

        <dl className="mt-10 grid gap-px overflow-hidden rounded-[24px] bg-line ring-1 ring-line sm:grid-cols-2">
          {[
            { k: t.confirmed.when, v: dateLabel, s: time },
            { k: t.confirmed.service, v: serviceName(t, booking.serviceId, booking.serviceName), s: `${booking.durationMin} ${t.common.min}` },
            { k: t.confirmed.stylist, v: booking.staffName },
            { k: t.confirmed.where, v: fullAddress(), href: mapsUrl() },
          ].map((row) => (
            <div key={row.k} className="bg-paper p-6">
              <dt className="label">{row.k}</dt>
              <dd className="mt-2 text-[1.05rem]">
                {row.href ? (
                  <a href={row.href} target="_blank" rel="noreferrer" className="link-u">{row.v}</a>
                ) : (
                  row.v
                )}
              </dd>
              {row.s && <dd className="mt-0.5 text-sm text-ink-soft">{row.s}</dd>}
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <a href={`/api/bookings/${booking.id}/ics?lang=${lang}`} className="btn-clay" download>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
            </svg>
            {t.confirmed.addCal}
          </a>
          <Link href="/" className="btn-ghost group">
            {t.confirmed.home}
            <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        <p className="mt-8 text-sm text-ink-soft">
          {t.confirmed.change}{" "}
          <a href={`tel:${salon.phone}`} className="link-u text-ink">{formatPhoneDisplay(salon.phone)}</a>.{" "}
          {fill(t.contact.policy, { h: salon.policies.cancellationHours })}
        </p>
        <p className="mt-2 text-xs text-mute">
          {t.confirmed.ref}: {booking.id}
        </p>
      </div>
    </div>
  );
}
