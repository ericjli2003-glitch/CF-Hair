"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Monogram } from "../art/Monogram";

const TABS = [
  { href: "/admin", label: "Schedule" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/new", label: "New booking" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/customers", label: "Clients" },
];

export function AdminNav({ newMessages }: { newMessages: number }) {
  const path = usePathname();
  const router = useRouter();
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[#f7f3ee]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/admin" className="flex shrink-0 items-center gap-2 py-3">
          <Monogram className="h-9 w-9" />
          <span className="hidden text-sm font-medium xl:inline">Owner</span>
        </Link>
        <nav className="no-scrollbar -mb-px flex flex-1 gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.href === "/admin" ? path === "/admin" : path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`relative flex shrink-0 items-center gap-2 border-b-2 px-3 py-5 text-[0.9rem] transition ${
                  active ? "border-clay font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {t.label}
                {t.href === "/admin/messages" && newMessages > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-clay px-1.5 text-[0.68rem] font-medium text-paper">
                    {newMessages}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <Link href="/" className="hidden text-sm text-ink-soft hover:text-ink md:inline">
          View site
        </Link>
        <button onClick={logout} className="shrink-0 rounded-full border border-line px-4 py-2 text-sm text-ink-soft hover:border-ink hover:text-ink">
          Log out
        </button>
      </div>
    </header>
  );
}
