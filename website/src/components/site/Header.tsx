"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "../art/Monogram";
import { useI18n } from "../LangProvider";
import { LangToggle } from "./LangToggle";

export function Header({ phone, phoneDisplay }: { phone: string; phoneDisplay: string }) {
  const { t } = useI18n();
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  const links = [
    { href: "/services", label: t.nav.services },
    { href: "/team", label: t.nav.team },
    { href: "/contact", label: t.nav.visit },
  ];

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-500 ${
        scrolled ? "border-b border-line/70 bg-bone/85 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <div className="container-x flex h-[72px] items-center justify-between gap-3 lg:gap-4">
        <Link href="/" aria-label="CF Hair Salon home" className="shrink-0" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-4 md:flex lg:gap-9">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`link-u whitespace-nowrap text-[0.8rem] uppercase tracking-[0.08em] lg:tracking-[0.18em] ${path === l.href ? "text-clay" : "text-ink"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          <div className="hidden sm:block">
            <LangToggle />
          </div>
          <Link href="/book" className="btn-primary hidden whitespace-nowrap !px-4 !py-2.5 !tracking-[0.1em] sm:inline-flex lg:!px-5 lg:!tracking-[0.14em]">
            {t.nav.book}
          </Link>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full border border-ink/15 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? t.nav.close : t.nav.menu}
          >
            <span className="relative block h-3 w-4">
              <span className={`absolute left-0 h-px w-4 bg-ink transition ${open ? "top-1.5 rotate-45" : "top-0"}`} />
              <span className={`absolute left-0 top-1.5 h-px w-4 bg-ink transition ${open ? "opacity-0" : ""}`} />
              <span className={`absolute left-0 h-px w-4 bg-ink transition ${open ? "top-1.5 -rotate-45" : "top-3"}`} />
            </span>
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-x-0 bottom-0 top-[72px] z-40 flex flex-col bg-bone px-6 pb-10 pt-6 md:hidden">
          <nav className="flex flex-col">
            {[{ href: "/", label: "CF Hair" }, ...links].map((l, i) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="display flex items-baseline justify-between border-b border-line py-5 text-[2.6rem]"
              >
                {l.label}
                <span className="font-sans text-xs tracking-[0.2em] text-mute">0{i + 1}</span>
              </Link>
            ))}
          </nav>
          <div className="mt-8 flex items-center justify-between">
            <LangToggle />
            <a href={`tel:${phone}`} className="text-sm text-ink-soft">
              {phoneDisplay}
            </a>
          </div>
          <Link href="/book" onClick={() => setOpen(false)} className="btn-clay mt-auto w-full !py-4">
            {t.nav.book}
          </Link>
        </div>
      )}
    </header>
  );
}
