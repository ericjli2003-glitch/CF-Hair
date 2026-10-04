import Link from "next/link";
import type { Dict, Lang } from "@/lib/i18n/dictionary";
import { formatTime } from "@/lib/i18n/localize";
import { DAY_KEYS, formatPhoneDisplay, fullAddress, mapsUrl, salon } from "@/lib/salon";
import { Logo } from "../art/Monogram";

export function Footer({ t, lang }: { t: Dict; lang: Lang }) {
  const year = new Date().getFullYear();
  // Group consecutive days with identical hours: "Mon to Sat 10 am to 6 pm".
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
    <footer className="mt-auto border-t border-rule bg-tile">
      <div className="frame grid gap-8 py-10 text-[0.95rem] sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_1fr_auto] lg:gap-10">
        <div>
          <Logo />
          <p className="mt-3 max-w-[32ch] text-balance leading-snug text-slate">{t.footer.tagline}</p>
        </div>
        <div>
          <h2 className="font-medium">{t.contact.address}</h2>
          <a href={mapsUrl()} target="_blank" rel="noreferrer" className="s-link mt-1.5 block max-w-[34ch] leading-snug">
            {fullAddress()}
          </a>
          <a href={`tel:${salon.phone}`} className="s-link nums mt-2 inline-block">
            {formatPhoneDisplay(salon.phone)}
          </a>
        </div>
        <div>
          <h2 className="font-medium">{t.contact.hours}</h2>
          <dl className="mt-1.5">
            {groups.map((g) => (
              <div key={g.from} className="nums flex justify-between gap-4 sm:max-w-[18rem]">
                <dt>{g.from === g.to ? dayName(g.from) : `${dayName(g.from)}${t.common.to}${dayName(g.to)}`}</dt>
                <dd>{g.hours}</dd>
              </div>
            ))}
          </dl>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-1.5">
          <Link href="/services" className="s-link">{t.nav.services}</Link>
          <Link href="/team" className="s-link">{t.nav.team}</Link>
          <Link href="/contact" className="s-link">{t.nav.visit}</Link>
          <Link href="/book" className="s-link font-medium">{t.nav.book}</Link>
        </nav>
      </div>
      <div className="frame">
        <div className="flex flex-col justify-between gap-2 border-t border-rule py-5 text-[0.85rem] text-slate sm:flex-row">
          <span>
            © {year} {salon.name}. {t.footer.rights}
          </span>
          <Link href="/admin" className="s-link">
            {t.footer.owner}
          </Link>
        </div>
      </div>
    </footer>
  );
}
