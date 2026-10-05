import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Seal } from "@/components/art/Seal";
import { Rod } from "@/components/site/Rod";
import { getBooking } from "@/lib/bookings";
import { prisma } from "@/lib/db";
import { fill } from "@/lib/i18n/dictionary";
import { formatDuration, formatTime, LOCALE, serviceName } from "@/lib/i18n/localize";
import { getI18n } from "@/lib/i18n/server";
import { formatPhoneDisplay, fullAddress, mapsUrl, salon } from "@/lib/salon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booked", robots: { index: false } };

export default async function ConfirmedPage(props: PageProps<"/book/confirmed/[id]">) {
  const { id } = await props.params;
  const booking = await getBooking(id);
  if (!booking) notFound();
  const { lang, t } = await getI18n();
  const category = (await prisma.service.findUnique({ where: { id: booking.serviceId }, select: { category: true } }))?.category;
  const [y, m, d] = booking.start.slice(0, 10).split("-").map(Number);
  const dateLabel = new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
  const time = `${formatTime(booking.start.slice(11, 16), lang)}${t.common.to}${formatTime(booking.end.slice(11, 16), lang)}`;
  const firstName = booking.customer.name.split(/\s+/)[0];
  const lead = fill(t.confirmed.lead, { name: firstName, phone: "\u0000" }).split("\u0000");

  const rows: { k: string; v: React.ReactNode; s?: string }[] = [
    { k: t.confirmed.when, v: dateLabel, s: time },
    {
      k: t.confirmed.service,
      v: (
        <span className="flex items-center gap-2">
          {category && <Rod category={category} className="!h-3 !w-8" />}
          {serviceName(t, booking.serviceId, booking.serviceName)}
        </span>
      ),
      s: formatDuration(t, booking.durationMin),
    },
    { k: t.confirmed.stylist, v: booking.staffName },
    {
      k: t.confirmed.where,
      v: (
        <a href={mapsUrl()} target="_blank" rel="noreferrer" className="s-link text-balance">
          {fullAddress()}
        </a>
      ),
    },
  ];

  return (
    <div className="frame pb-16 pt-4 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-cond text-[clamp(2.75rem,7vw,4rem)] font-semibold leading-none">{t.confirmed.title}</h1>
        <p className="mt-3 max-w-[48ch] text-[1.15rem] leading-snug">
          {lead.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="nums whitespace-nowrap font-medium">{formatPhoneDisplay(booking.customer.phone)}</span>}
              {part}
            </span>
          ))}
        </p>

        <div className="relative mt-8 rounded-xl bg-board px-5 sm:px-6">
          <dl>
            {rows.map((row, i) => (
              <div key={row.k} className="grid gap-1 border-b border-rule py-4 last:min-h-[5.5rem] last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-slate">{row.k}</dt>
                <dd className={i === rows.length - 1 ? "pr-16" : undefined}>
                  <span className="block text-[1.05rem] font-medium">{row.v}</span>
                  {row.s && <span className="nums block text-slate">{row.s}</span>}
                </dd>
              </div>
            ))}
          </dl>
          {/* The salon signs the booking with its seal, bottom right, as on a letter.
              The last row keeps clear of it. */}
          <Seal size={52} className="absolute bottom-4 right-4 -rotate-3 sm:right-6" />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a href={`/api/bookings/${booking.id}/ics?lang=${lang}`} className="s-btn" download>
            {t.confirmed.addCal}
          </a>
          <Link href="/" className="s-btn-line">
            {t.confirmed.home}
          </Link>
        </div>
        <p className="mt-8 leading-relaxed">
          {fill(t.confirmed.change, { phone: "\u0000" })
            .split("\u0000")
            .map((part, i) => (
              <span key={i}>
                {i > 0 && (
                  <a href={`tel:${salon.phone}`} className="s-link nums whitespace-nowrap font-medium">
                    {formatPhoneDisplay(salon.phone)}
                  </a>
                )}
                {part}
              </span>
            ))}{" "}
          {fill(t.contact.policy, { h: salon.policies.cancellationHours })}
        </p>
        <p className="mt-2 text-[0.88rem] text-slate">
          {t.confirmed.ref}: {booking.id}
        </p>
      </div>
    </div>
  );
}
