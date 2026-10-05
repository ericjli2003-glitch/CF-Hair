import Link from "next/link";
import type { Dict, Lang } from "@/lib/i18n/dictionary";
import { formatPhoneDisplay, fullAddress, mapsUrl, salon } from "@/lib/salon";
import { Logo } from "../art/Logo";
import { Lattice } from "../art/Lattice";
import { weeklyHours } from "./OpenNow";

export function Footer({ t, lang }: { t: Dict; lang: Lang }) {
  const year = new Date().getFullYear();
  // Consecutive days with identical hours are grouped: "Mon to Sat 10 am to 6 pm".
  const groups = weeklyHours(t, lang);
  return (
    <footer className="on-primary relative mt-auto bg-primary text-white">
      {/* A faint window lattice under the footer, never under text contrast: white at 5%. */}
      <Lattice cell={44} stroke="#fff" opacity={0.05} className="absolute inset-0" />
      <div className="frame relative grid gap-8 py-10 text-[0.95rem] sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_1fr_auto] lg:gap-10">
        <div>
          <Logo onDark size={32} />
          <p className="mt-3 max-w-[32ch] text-balance leading-snug text-on-primary-soft">{t.footer.tagline}</p>
        </div>
        <div>
          <h2 className="font-medium">{t.contact.address}</h2>
          <a href={mapsUrl()} target="_blank" rel="noreferrer" className="s-link-light mt-1.5 block max-w-[34ch] py-1 leading-snug">
            {fullAddress()}
          </a>
          <a href={`tel:${salon.phone}`} className="s-link-light nums inline-flex min-h-11 items-center">
            {formatPhoneDisplay(salon.phone)}
          </a>
        </div>
        <div>
          <h2 className="font-medium">{t.contact.hours}</h2>
          <dl className="mt-1.5">
            {groups.map((g) => (
              <div key={g.days} className="nums flex justify-between gap-4 sm:max-w-[18rem]">
                <dt>{g.days}</dt>
                <dd>{g.hours}</dd>
              </div>
            ))}
          </dl>
        </div>
        <nav aria-label="Footer" className="-my-2 flex flex-col">
          <Link href="/services" className="s-link-light inline-flex min-h-11 items-center">{t.nav.services}</Link>
          <Link href="/team" className="s-link-light inline-flex min-h-11 items-center">{t.nav.team}</Link>
          <Link href="/contact" className="s-link-light inline-flex min-h-11 items-center">{t.nav.visit}</Link>
          <Link href="/book" className="s-link-light inline-flex min-h-11 items-center font-medium">{t.nav.book}</Link>
        </nav>
      </div>
      <div className="frame relative">
        <div className="flex flex-col justify-between gap-2 border-t border-white/25 py-4 text-[0.85rem] text-on-primary-soft sm:flex-row sm:items-center">
          <span>
            © {year} {salon.name}. {t.footer.rights}
          </span>
          <Link href="/admin" className="s-link-light inline-flex min-h-11 items-center self-start">
            {t.footer.owner}
          </Link>
        </div>
      </div>
    </footer>
  );
}
