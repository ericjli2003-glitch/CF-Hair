import Link from "next/link";
import type { Dict, Lang } from "@/lib/i18n/dictionary";
import { formatTime } from "@/lib/i18n/localize";
import { DAY_KEYS, formatPhoneDisplay, fullAddress, mapsUrl, salon } from "@/lib/salon";
import { Logo } from "../art/Monogram";

export function Footer({ t, lang }: { t: Dict; lang: Lang }) {
  const year = new Date().getFullYear();
  // Group consecutive days with identical hours: "Mon to Sat 10:00 to 18:00".
  const groups: { from: string; to: string; hours: string }[] = [];
  for (const d of DAY_KEYS) {
    const h = salon.hours[d];
    const hours = h ? `${formatTime(h.open, lang)}${t.common.to}${formatTime(h.close, lang)}` : t.common.closed;
    const last = groups.at(-1);
    if (last && last.hours === hours) last.to = d;
    else groups.push({ from: d, to: d, hours });
  }
  const dayName = (d: string) => t.daysShort[d as keyof typeof t.daysShort];
  return (
    <footer className="border-t border-line bg-bone">
      <div className="container-x grid gap-10 py-14 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-soft">{t.footer.tagline}</p>
        </div>
        <div className="text-sm leading-relaxed text-ink-soft md:col-span-3">
          <p className="eyebrow mb-3 !text-mute">{t.home.address}</p>
          <a href={mapsUrl()} target="_blank" rel="noreferrer" className="link-u">
            {fullAddress()}
          </a>
          <p className="mt-3">
            <a href={`tel:${salon.phone}`} className="link-u">
              {formatPhoneDisplay(salon.phone)}
            </a>
          </p>
        </div>
        <div className="text-sm leading-relaxed text-ink-soft md:col-span-3">
          <p className="eyebrow mb-3 !text-mute">{t.home.hours}</p>
          {groups.map((g) => (
            <p key={g.from} className="flex justify-between gap-4 tabular-nums">
              <span>{g.from === g.to ? dayName(g.from) : `${dayName(g.from)}${t.common.to}${dayName(g.to)}`}</span>
              <span>{g.hours}</span>
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-sm md:col-span-2 md:items-end">
          <Link href="/services" className="link-u">{t.nav.services}</Link>
          <Link href="/team" className="link-u">{t.nav.team}</Link>
          <Link href="/contact" className="link-u">{t.nav.visit}</Link>
          <Link href="/book" className="link-u text-clay">{t.nav.book}</Link>
        </div>
      </div>
      <div className="container-x">
      <div className="flex flex-col justify-between gap-2 border-t border-line py-6 text-xs text-mute sm:flex-row">
        <span>
          © {year} {salon.name}. {t.footer.rights}
        </span>
        <Link href="/admin" className="link-u">
          {t.footer.owner}
        </Link>
      </div>
      </div>
    </footer>
  );
}
