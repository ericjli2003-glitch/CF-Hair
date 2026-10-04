// Small presentational pieces for the Calls tab and the client page.
import { phonePretty } from "@/lib/admin-format";
import { isLanguageCode, LANGUAGE_LABELS } from "@/lib/languages";

export const OUTCOME_LABEL: Record<string, string> = {
  booked: "Booked",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  message: "Message",
  transferred: "Transferred",
  info: "Question",
  abandoned: "Hung up",
  spam: "Spam",
};

const OUTCOME_STYLE: Record<string, string> = {
  booked: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rescheduled: "bg-sky-50 text-sky-900 ring-sky-200",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
  message: "bg-amber-50 text-amber-900 ring-amber-200",
  transferred: "bg-violet-50 text-violet-800 ring-violet-200",
  info: "bg-tile text-slate ring-rule",
  abandoned: "bg-white text-slate ring-rule",
  spam: "bg-white text-slate ring-rule",
};

export function OutcomeChip({ outcome, size = "sm" }: { outcome: string; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md ring-1 ${OUTCOME_STYLE[outcome] ?? OUTCOME_STYLE.info} ${
        size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      {OUTCOME_LABEL[outcome] ?? outcome}
    </span>
  );
}

/** Language of the call: a script glyph plus the English name ("粵 Cantonese"). */
export function LangChip({ lang, compact = false }: { lang: string; compact?: boolean }) {
  const l = isLanguageCode(lang) ? LANGUAGE_LABELS[lang] : null;
  if (!l) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-tile py-0.5 pl-1 pr-2.5 text-xs text-ink-soft" title={`${l.label} (${l.native})`}>
      <span lang={lang} className="grid h-[1.15rem] min-w-[1.15rem] place-items-center rounded-full bg-paper px-1 text-xs font-medium leading-none text-ink">
        {l.short}
      </span>
      {compact ? null : l.label}
    </span>
  );
}

export function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function callerNumber(from: string | null): string {
  return from ? phonePretty(from) : "Withheld";
}

export const LANGUAGE_SOURCE_LABEL: Record<string, string> = {
  saved: "remembered for this number",
  detected: "detected from what the caller said",
  keypad: "chosen on the keypad",
  asked: "the caller was asked",
  default: "default",
};

export const TRANSFER_LABEL: Record<string, string> = {
  answered: "Answered at the salon",
  "no-answer": "Nobody picked up",
  busy: "Line busy",
  failed: "Transfer failed",
};

export const SMS_ANSWER_LABEL: Record<string, string> = {
  yes: "Said yes to promotional texts",
  no: "Said no to promotional texts (not asked again)",
  "not-asked": "Not asked",
};
