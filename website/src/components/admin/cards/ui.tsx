// Presentational pieces for the Cards tab.
import { money } from "../promo/ui";

export const CARD_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  approved: "Approved",
  skipped: "Skipped",
  sent: "Mailed",
  failed: "Failed",
};

const CARD_STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-900 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  skipped: "bg-stone-100 text-stone-500 ring-stone-200",
  sent: "bg-sky-50 text-sky-900 ring-sky-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function CardStatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ring-1 ${CARD_STATUS_STYLE[status] ?? CARD_STATUS_STYLE.pending}`}>
      {CARD_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export const PROVIDER_LABEL: Record<string, string> = { handwrytten: "Handwrytten", plotter: "the salon's pen plotter" };

/** This month's approved and sent cards against the cap, with the estimated cost. */
export function MonthMeter(props: { label: string; used: number; cap: number; price: number; waiting?: number; compact?: boolean }) {
  const { used, cap, price } = props;
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 100;
  const left = Math.max(0, cap - used);
  const full = used >= cap;
  return (
    <div className={props.compact ? "" : "rounded-2xl bg-paper p-5 ring-1 ring-line"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className={props.compact ? "text-sm text-ink-soft" : "text-[0.7rem] uppercase tracking-[0.14em] text-mute"}>{props.label}</p>
        <p className="text-sm text-ink-soft">
          about <span className="font-medium text-ink">{money(used * price)} CAD</span> at {money(price)} a card
        </p>
      </div>
      {!props.compact && (
        <p className="display mt-1 text-[2rem] leading-none tabular-nums">
          {used} <span className="text-[1.2rem] text-mute">of {cap} cards</span>
        </p>
      )}
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-[#ebe3d7]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={used}
        aria-label={`${used} of ${cap} cards this month`}
      >
        <div className={`h-full rounded-full ${full ? "bg-clay" : "bg-moss"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-2 text-xs ${full ? "text-clay-deep" : "text-ink-soft"}`}>
        {full
          ? `Monthly limit reached. Raise it in the settings to approve more this month.`
          : `${left} more can be approved this month. Approved and mailed cards count; skipped ones do not.`}
        {props.waiting ? ` ${props.waiting} waiting for you.` : ""}
      </p>
    </div>
  );
}
