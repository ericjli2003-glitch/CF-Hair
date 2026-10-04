"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { phonePretty, relTime } from "@/lib/admin-format";
import { LANGUAGE_LABELS, type LanguageCode } from "@/lib/languages";

interface Item {
  id: string;
  callerName: string;
  phone: string;
  message: string;
  urgency: string;
  status: string;
  source: string;
  createdAt: string;
  language: LanguageCode;
  isClient: boolean;
  bookings: number;
}

const URGENCY: Record<string, string> = {
  high: "bg-rose-600 text-white",
  normal: "bg-amber-100 text-amber-900",
  low: "bg-stone-100 text-stone-600",
};

export function MessageList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function toggle(id: string, status: string) {
    setBusy(id);
    await fetch(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    router.refresh();
  }
  if (!items.length) return <p className="mt-10 rounded-2xl bg-paper p-10 text-center text-ink-soft ring-1 ring-line">No messages.</p>;
  return (
    <ul className="mt-8 space-y-3">
      {items.map((m) => {
        const done = m.status === "done";
        return (
          <li key={m.id} id={`m-${m.id}`} className={`scroll-mt-24 rounded-2xl bg-paper p-5 ring-1 ring-line transition target:ring-2 target:ring-clay sm:p-6 ${done ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-medium">{m.callerName}</p>
                  <span className={`rounded-full px-2.5 py-0.5 text-[0.7rem] font-medium uppercase tracking-wider ${URGENCY[m.urgency] ?? URGENCY.normal}`}>
                    {m.urgency}
                  </span>
                  {m.language !== "en-US" && (
                    <span className="rounded-full bg-[#efe6da] px-2.5 py-0.5 text-xs text-ink-soft">
                      Speaks {LANGUAGE_LABELS[m.language].label} · {LANGUAGE_LABELS[m.language].native}
                    </span>
                  )}
                  {m.isClient && <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">Client · {m.bookings} booking{m.bookings === 1 ? "" : "s"}</span>}
                </div>
                <p className="mt-1 text-sm text-mute">
                  {m.source === "web" ? "Website form" : m.source === "sms" ? "Text message reply" : "Phone assistant"} · {relTime(m.createdAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <a href={`tel:${m.phone}`} className="rounded-full bg-ink px-4 py-2.5 text-sm text-paper hover:bg-clay">
                  Call {phonePretty(m.phone)}
                </a>
                <button
                  type="button"
                  disabled={busy === m.id}
                  onClick={() => toggle(m.id, done ? "new" : "done")}
                  className="rounded-full px-4 py-2.5 text-sm ring-1 ring-line hover:ring-ink disabled:opacity-50"
                >
                  {done ? "Reopen" : "Mark done"}
                </button>
              </div>
            </div>
            <p className="mt-4 leading-relaxed text-ink">{m.message}</p>
          </li>
        );
      })}
    </ul>
  );
}
