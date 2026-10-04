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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const links = [
    { href: "/services", label: t.nav.services },
    { href: "/team", label: t.nav.team },
    { href: "/contact", label: t.nav.visit },
  ];
  const onBooking = path.startsWith("/book");

  return (
    <header className="relative z-40 bg-tile">
      <div className="frame flex min-h-16 items-center justify-between gap-3 md:min-h-[4.5rem]">
        <Link href="/" className="shrink-0 py-2" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={path === l.href ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-[1rem] font-medium hover:bg-white ${
                path === l.href ? "underline decoration-2 underline-offset-[6px]" : ""
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="hidden sm:block">
            <LangToggle />
          </div>
          {!onBooking && (
            <Link href="/book" className="s-btn hidden whitespace-nowrap md:inline-flex">
              {t.nav.book}
            </Link>
          )}
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-black bg-white px-3.5 text-[0.95rem] font-medium md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="site-menu"
          >
            {open ? t.nav.close : t.nav.menu}
          </button>
        </div>
      </div>
      <div className="frame pb-3 sm:hidden">
        <LangToggle wide />
      </div>

      {open && (
        <div id="site-menu" className="fixed inset-x-0 bottom-0 top-0 z-50 overflow-y-auto bg-tile md:hidden">
          <div className="frame flex min-h-16 items-center justify-between">
            <Link href="/" onClick={() => setOpen(false)} className="py-2">
              <Logo />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-black bg-white px-3.5 text-[0.95rem] font-medium"
            >
              {t.nav.close}
            </button>
          </div>
          <nav aria-label="Main" className="frame mt-4 flex flex-col border-t border-rule">
            {[{ href: "/", label: t.nav.home }, ...links].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={path === l.href ? "page" : undefined}
                className="border-b border-rule py-4 font-cond text-[2rem] font-semibold leading-none"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="frame mt-8 flex flex-col gap-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <Link href="/book" onClick={() => setOpen(false)} className="s-btn w-full">
              {t.nav.book}
            </Link>
            <a href={`tel:${phone}`} className="s-btn-line w-full">
              {t.common.call} {phoneDisplay}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
