"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { dayLabel, phonePretty, time12 } from "@/lib/admin-format";
import type { CallView } from "@/lib/calls";
import { isLanguageCode, LANGUAGE_LABELS } from "@/lib/languages";
import { useModal } from "@/lib/use-modal";
import { CloseIcon } from "../icons";
import { LANGUAGE_SOURCE_LABEL, LangChip, OutcomeChip, SMS_ANSWER_LABEL, TRANSFER_LABEL, callerNumber, duration } from "./ui";

export interface CallDetail extends CallView {
  name: string | null;
  transcriptDays: number;
  booking: { id: string; start: string; serviceName: string; staffName: string; status: string } | null;
  message: { id: string; status: string; text: string } | null;
}

function offset(at: string | undefined, start: string): string | null {
  if (!at) return null;
  const s = Math.max(0, Math.round((Date.parse(at) - Date.parse(start)) / 1000));
  return duration(s);
}

export function CallDrawer({ call, closeHref }: { call: CallDetail | null; closeHref: string }) {
  const router = useRouter();
  const overlay = useRef<HTMLDivElement>(null);
  // Modal: the call list behind is inert, Tab wraps inside, Escape closes, focus
  // returns to the call row that opened it.
  useModal(overlay, true, () => router.push(closeHref, { scroll: false }));

  const lang = call && isLanguageCode(call.language) ? LANGUAGE_LABELS[call.language] : null;

  return (
    <div ref={overlay} className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={() => router.push(closeHref, { scroll: false })}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={call ? `Call from ${call.name ?? callerNumber(call.from)}` : "Call"}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 sm:px-7">
          {call ? <OutcomeChip outcome={call.outcome} size="md" /> : <span />}
          <Link data-autofocus href={closeHref} scroll={false} className="grid h-11 w-11 shrink-0 place-items-center rounded-md ring-1 ring-line hover:bg-tile" aria-label="Close call details">
            <CloseIcon />
          </Link>
        </div>

        {!call ? (
          <p className="px-7 py-10 text-ink-soft">This call is no longer in the log.</p>
        ) : (
          <div className="px-6 pb-10 sm:px-7">
            <h2 className="display mt-4 text-[2.3rem] leading-none">{call.name ?? callerNumber(call.from)}</h2>
            <p className="mt-2 text-ink-soft">
              {call.from ? (
                <a href={`tel:${call.from}`} className="underline-offset-4 hover:underline">
                  {phonePretty(call.from)}
                </a>
              ) : (
                "Caller ID withheld"
              )}
              {call.customer && (
                <>
                  {" · "}
                  <Link href={`/admin/customers/${call.customer.id}`} className="underline underline-offset-4 hover:decoration-2">
                    Client page
                  </Link>
                </>
              )}
            </p>

            <dl className="mt-6 divide-y divide-line rounded-xl bg-paper text-sm ring-1 ring-line">
              {[
                ["When", `${dayLabel(call.startedAt.slice(0, 10), { weekday: "short", month: "short", day: "numeric" })}, ${time12(call.startedAt)}`],
                ["Length", `${duration(call.durationSec)} min`],
                ["Language", lang ? `${lang.label} (${lang.native}), ${LANGUAGE_SOURCE_LABEL[call.languageSource] ?? call.languageSource}` : call.language],
                ...(call.transferResult ? [["Transfer", TRANSFER_LABEL[call.transferResult] ?? call.transferResult]] : []),
                ["Text opt-in", call.smsConsent ? SMS_ANSWER_LABEL[call.smsConsent] ?? call.smsConsent : call.from ? "Not asked" : "Not asked (no caller ID)"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-3">
                  <dt className="shrink-0 text-mute">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>

            <section className="mt-6">
              <h3 className="text-sm font-medium text-ink-soft">Summary</h3>
              <p className="mt-2 text-[1.02rem] leading-relaxed">{call.summary}</p>
            </section>

            {(call.booking || call.message || (call.bookingId && !call.booking) || (call.messageId && !call.message)) && (
              <section className="mt-6 space-y-2">
                {call.booking && (
                  <Link
                    href={`/admin?date=${call.booking.start.slice(0, 10)}&booking=${call.booking.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-paper px-4 py-3 ring-1 ring-line hover:ring-primary/40"
                  >
                    <span>
                      <span className="block text-xs text-mute">{call.booking.status === "cancelled" ? "Cancelled booking" : "Booking"}</span>
                      <span className={`font-medium ${call.booking.status === "cancelled" ? "line-through decoration-ink/40" : ""}`}>
                        {call.booking.serviceName}, {dayLabel(call.booking.start.slice(0, 10))} at {time12(call.booking.start)}
                      </span>
                      <span className="block text-sm text-ink-soft">with {call.booking.staffName}</span>
                    </span>
                    <span className="shrink-0 text-sm underline underline-offset-4">Open in schedule</span>
                  </Link>
                )}
                {call.bookingId && !call.booking && <p className="rounded-xl bg-paper px-4 py-3 text-sm text-mute ring-1 ring-line">The booking from this call was deleted.</p>}
                {call.message && (
                  <Link href={`/admin/messages#m-${call.message.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-paper px-4 py-3 ring-1 ring-line hover:ring-primary/40">
                    <span className="min-w-0">
                      <span className="block text-xs text-mute">Callback message, {call.message.status === "done" ? "done" : "waiting"}</span>
                      <span className="line-clamp-2 text-sm">{call.message.text}</span>
                    </span>
                    <span className="shrink-0 text-sm underline underline-offset-4">Open in Messages</span>
                  </Link>
                )}
              </section>
            )}

            <section className="mt-8">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium text-ink-soft">Transcript</h3>
                {call.transcript && call.transcript.length > 0 && <span className="text-xs text-mute">Kept {call.transcriptDays} days</span>}
              </div>
              {!call.transcript ? (
                <p className="mt-3 rounded-xl bg-paper px-4 py-4 text-sm text-ink-soft ring-1 ring-line">
                  Transcript cleared after {call.transcriptDays} days. The summary above is kept.
                </p>
              ) : call.transcript.length === 0 ? (
                <p className="mt-3 text-sm text-mute">No transcript was recorded for this call.</p>
              ) : (
                <ol className="mt-3 space-y-2.5">
                  {call.transcript.map((line, i) => {
                    const agent = line.role === "agent";
                    const l = line.lang ?? call.language;
                    const t = offset(line.at, call.startedAt);
                    return (
                      <li key={i} className={`flex flex-col ${agent ? "items-start" : "items-end"}`}>
                        <div className={`mb-1 flex items-center gap-2 text-xs text-mute ${agent ? "" : "flex-row-reverse"}`}>
                          <span>{agent ? "Assistant" : "Caller"}</span>
                          <LangChip lang={l} compact />
                          {t && <span className="tabular-nums">{t}</span>}
                        </div>
                        <p
                          lang={l}
                          className={`max-w-[88%] whitespace-pre-wrap px-4 py-2.5 text-[0.95rem] leading-snug ${
                            agent ? "rounded-[1.2rem] rounded-tl-md bg-tile text-ink" : "rounded-[1.2rem] rounded-tr-md bg-primary text-paper"
                          }`}
                        >
                          {line.text}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
