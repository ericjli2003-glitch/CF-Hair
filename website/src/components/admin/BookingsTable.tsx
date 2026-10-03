"use client";

import type { BookingView } from "@/lib/bookings";
import { dayLabel, phonePretty, SOURCE_LABEL, STATUS_STYLES, time12 } from "@/lib/admin-format";
import { StatusButtons } from "./StatusActions";

export function BookingsTable({ rows, today }: { rows: BookingView[]; today: string }) {
  if (!rows.length) return <p className="mt-10 rounded-2xl bg-paper p-10 text-center text-ink-soft ring-1 ring-line">Nothing here yet.</p>;
  return (
    <div className="mt-6 overflow-hidden rounded-2xl bg-paper ring-1 ring-line">
      {rows.map((b, i) => {
        const day = b.start.slice(0, 10);
        const header = i === 0 || rows[i - 1].start.slice(0, 10) !== day;
        return (
          <div key={b.id}>
            {header && (
              <div className="border-b border-line bg-[#f3eee7] px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-soft">
                {day === today ? "Today · " : ""}
                {dayLabel(day, { weekday: "long", month: "long", day: "numeric" })}
              </div>
            )}
            <div className="grid gap-3 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[110px_1.3fr_1.2fr_auto] md:items-center">
              <div className="tabular-nums">
                <p className="font-medium">{time12(b.start)}</p>
                <p className="text-xs text-mute">{b.durationMin} min</p>
              </div>
              <div>
                <p className={`font-medium ${b.status === "cancelled" ? "text-mute line-through" : ""}`}>{b.customer.name}</p>
                <a href={`tel:${b.customer.phone}`} className="text-sm text-ink-soft hover:underline">
                  {phonePretty(b.customer.phone)}
                </a>
              </div>
              <div className="text-sm">
                <p>{b.serviceName}</p>
                <p className="text-ink-soft">
                  {b.staffName} · <span className="text-mute">{SOURCE_LABEL[b.source] ?? b.source}</span>
                </p>
                {b.notes && <p className="mt-1 text-xs italic text-mute">&ldquo;{b.notes}&rdquo;</p>}
              </div>
              <div className="flex flex-wrap items-center gap-3 md:justify-end">
                <span className={`rounded-full px-2.5 py-1 text-xs capitalize ring-1 ${STATUS_STYLES[b.status]}`}>{b.status}</span>
                <StatusButtons id={b.id} status={b.status} isPast={day <= today} size="sm" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
