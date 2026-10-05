"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../art/Logo";

const TABS = [
  { href: "/admin", label: "Schedule" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/new", label: "New booking" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/calls", label: "Calls" },
  { href: "/admin/customers", label: "Clients" },
  { href: "/admin/promotions", label: "Promotions" },
  { href: "/admin/cards", label: "Cards" },
];

/** What a tab's badge means, written out for screen readers and the tooltip. */
export function badgeText(href: string, n: number): string | null {
  if (n <= 0) return null;
  if (href === "/admin/messages") return `${n} new`;
  if (href === "/admin/cards") return `${n} waiting for approval`;
  return null;
}

/**
 * Owner navigation. The tabs wrap onto a second row on narrower screens (iPad
 * portrait) instead of scrolling sideways, so every tab and its badge stays in
 * view. The header's height is published as --admin-nav-h for sticky toolbars
 * and scroll padding.
 */
export function AdminNav({ newMessages, cardsWaiting = 0 }: { newMessages: number; cardsWaiting?: number }) {
  const path = usePathname();
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--admin-nav-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function logout() {
    setLeaving(true);
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }
  const counts: Record<string, number> = { "/admin/messages": newMessages, "/admin/cards": cardsWaiting };

  return (
    <header ref={ref} className="sticky top-0 z-40 border-b border-line bg-tile/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 px-4 sm:px-6 lg:px-8">
        <Link href="/admin" className="flex min-h-11 shrink-0 items-center gap-2 py-2.5">
          <Logo variant="compact" size={26} decorative />
          <span className="text-[0.95rem] font-medium">Owner</span>
          <span className="sr-only">, schedule</span>
        </Link>
        <nav aria-label="Owner" className="order-last -mx-2 w-full pb-1.5 xl:order-none xl:mx-0 xl:w-auto xl:flex-1 xl:pb-0">
          <ul className="flex flex-wrap gap-x-0.5">
            {TABS.map((t) => {
              const active = t.href === "/admin" ? path === "/admin" : path.startsWith(t.href);
              const badge = badgeText(t.href, counts[t.href] ?? 0);
              return (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    title={badge ?? undefined}
                    className={`relative flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-[0.95rem] xl:min-h-16 xl:rounded-none xl:px-3 ${
                      active
                        ? "font-semibold text-ink underline decoration-2 underline-offset-[6px] xl:no-underline xl:after:absolute xl:after:inset-x-3 xl:after:bottom-0 xl:after:h-[3px] xl:after:bg-primary"
                        : "text-ink-soft hover:bg-paper hover:text-ink"
                    }`}
                  >
                    {t.label}
                    {badge && (
                      <>
                        <span
                          aria-hidden="true"
                          className="nums grid h-6 min-w-6 place-items-center rounded-full bg-terra px-1.5 text-[0.8rem] font-semibold text-ink"
                        >
                          {counts[t.href]}
                        </span>
                        <span className="sr-only">, {badge}</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-md px-3 text-[0.95rem] text-ink-soft hover:bg-paper hover:text-ink">
            View site
          </Link>
          <button
            type="button"
            onClick={logout}
            disabled={leaving}
            className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-primary bg-paper px-4 text-[0.95rem] font-medium hover:bg-tile disabled:opacity-60"
          >
            {leaving ? "Logging out..." : "Log out"}
          </button>
        </div>
      </div>
    </header>
  );
}
