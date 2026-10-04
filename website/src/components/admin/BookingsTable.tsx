"use client";

import Link from "next/link";
import type { BookingView } from "@/lib/bookings";
import { dayLabel, phonePretty, SOURCE_LABEL, STATUS_LABEL, STATUS_STYLES, time12 } from "@/lib/admin-format";
import { StatusButtons } from "./StatusActions";

export function BookingsTable({ rows, today }: { rows: BookingView[]; today: string }) {
  if (!rows.length)
    return (
      <div className="mt-6 rounded-xl bg-paper px-6 py-10 text-center ring-1 ring-line">
        <p className="text-ink-soft">No bookings match this filter.</p>
        <Link href="/admin/new" className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4">
          Add a booking
        </Link>
      </div>
    );
  return (
    <div className="mt-6 overflow-hidden rounded-xl bg-paper ring-1 ring-line">
      {rows.map((b, i) => {
        const day = b.start.slice(0, 10);
        const header = i === 0 || rows[i - 1].start.slice(0, 10) !== day;
        return (
          <div key={b.id}>
            {header && (
              <div className="border-b border-line bg-tile px-5 py-2 text-sm font-medium text-ink-soft">
                {day === today ? "Today · " : ""}
                {dayLabel(day, { weekday: "long", month: "long", day: "numeric" })}
              </div>
            )}
            <div className="grid gap-3 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[110px_1.3fr_1.2fr_auto] md:items-center">
              <div className="tabular-nums">
                <p className="font-medium">{time12(b.start)}</p>
                <p className="text-sm text-ink-soft">{b.durationMin} min</p>
              </div>
              <div>
                <p className={`font-medium ${b.status === "cancelled" ? "text-mute line-through" : ""}`}>{b.customer.name}</p>
                <a href={`tel:${b.customer.phone}`} className="nums inline-flex min-h-8 items-center text-sm text-ink-soft underline-offset-4 hover:underline">
                  {phonePretty(b.customer.phone)}
                </a>
              </div>
              <div className="text-sm">
                <p>{b.serviceName}</p>
                <p className="text-ink-soft">
                  {b.staffName} · <span className="text-ink-soft">{SOURCE_LABEL[b.source] ?? b.source}</span>
                </p>
                {b.notes && <p className="mt-1 text-sm italic text-ink-soft">&ldquo;{b.notes}&rdquo;</p>}
              </div>
              <div className="flex flex-wrap items-center gap-3 md:justify-end">
                <span className={`rounded-md px-2.5 py-1 text-sm ring-1 ${STATUS_STYLES[b.status]}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
                <StatusButtons id={b.id} status={b.status} isPast={day <= today} size="sm" who={b.customer.name} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
