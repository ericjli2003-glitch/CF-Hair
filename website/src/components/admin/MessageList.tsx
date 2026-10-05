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
  high: "bg-alert text-white",
  normal: "bg-terra-wash text-terra-deep",
  low: "bg-tile text-slate ring-1 ring-rule",
};
const URGENCY_LABEL: Record<string, string> = { high: "Urgent", normal: "Normal", low: "Low" };

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
  if (!items.length)
    return (
      <p className="mt-10 rounded-xl bg-paper p-10 text-center text-ink-soft ring-1 ring-line">
        No messages. Callback requests from the phone receptionist and the website appear here.
      </p>
    );
  return (
    <ul className="mt-8 space-y-3">
      {items.map((m) => {
        const done = m.status === "done";
        return (
          <li key={m.id} id={`m-${m.id}`} className={`scroll-mt-28 rounded-xl p-5 ring-1 transition target:ring-2 target:ring-primary sm:p-6 ${done ? "bg-tile/60 ring-line" : "bg-paper ring-line"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-medium">{m.callerName}</p>
                  {done ? (
                    <span className="rounded-md bg-paper px-2.5 py-0.5 text-sm font-medium text-ink-soft ring-1 ring-rule">Done</span>
                  ) : (
                    <span className={`rounded-md px-2.5 py-0.5 text-sm font-medium ${URGENCY[m.urgency] ?? URGENCY.normal}`}>
                      {URGENCY_LABEL[m.urgency] ?? m.urgency}
                    </span>
                  )}
                  {m.language !== "en-US" && (
                    <span className="rounded-md bg-tile px-2.5 py-0.5 text-sm text-ink-soft">
                      Speaks {LANGUAGE_LABELS[m.language].label} · {LANGUAGE_LABELS[m.language].native}
                    </span>
                  )}
                  {m.isClient && <span className="rounded-md bg-primary-wash px-2.5 py-0.5 text-sm text-primary ring-1 ring-primary-line">Client · {m.bookings} booking{m.bookings === 1 ? "" : "s"}</span>}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {m.source === "web" ? "Website form" : m.source === "sms" ? "Text message reply" : "Phone assistant"} · {relTime(m.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`tel:${m.phone}`} className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm text-paper hover:bg-primary-hover">
                  Call {phonePretty(m.phone)}
                </a>
                <button
                  type="button"
                  disabled={busy === m.id}
                  aria-busy={busy === m.id || undefined}
                  onClick={() => toggle(m.id, done ? "new" : "done")}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-paper px-4 text-sm ring-1 ring-primary hover:bg-tile disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === m.id ? "Saving..." : done ? "Reopen" : "Mark done"}
                  <span className="sr-only">, {m.callerName}</span>
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
