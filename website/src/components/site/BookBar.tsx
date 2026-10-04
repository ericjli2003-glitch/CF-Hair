"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "../LangProvider";

/** Phones only: "Book a time" fixed to the bottom of public pages, clear of the home indicator. */
export function BookBar({ phone }: { phone: string }) {
  const { t } = useI18n();
  const path = usePathname();
  if (path.startsWith("/book")) return null;
  return (
    <>
      <div aria-hidden="true" className="h-[calc(4.5rem+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        aria-label={t.nav.book}
        data-bookbar
        className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-tile/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="flex gap-2 px-[max(1rem,env(safe-area-inset-left))] py-3 pr-[max(1rem,env(safe-area-inset-right))]">
          <Link href="/book" className="s-btn flex-1">
            {t.nav.book}
          </Link>
          <a href={`tel:${phone}`} className="s-btn-line">
            {t.common.call}
          </a>
        </div>
      </nav>
    </>
  );
}
