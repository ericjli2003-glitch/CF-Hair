// Small presentational pieces shared by the Promotions screens and the client page.
import type { LanguageCode } from "@/lib/languages";

export const CONSENT_STYLE: Record<string, string> = {
  express: "bg-primary-wash text-primary ring-primary-line",
  implied: "bg-terra-wash text-terra-deep ring-terra-line",
  withdrawn: "bg-alert-wash text-alert ring-alert-line",
  none: "bg-tile text-slate ring-rule",
};

export const CONSENT_LABEL: Record<string, string> = {
  express: "Opted in",
  implied: "Implied",
  withdrawn: "Opted out",
  none: "No consent",
};

export function ConsentChip({ status, expires, size = "sm" }: { status: string; expires?: string | null; size?: "sm" | "md" }) {
  const exp = status === "implied" && expires ? ` to ${shortDate(expires, true)}` : "";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md ring-1 ${CONSENT_STYLE[status] ?? CONSENT_STYLE.none} ${
        size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${status === "express" ? "bg-primary" : status === "implied" ? "bg-terra" : status === "withdrawn" ? "bg-alert" : "bg-slate"}`} />
      {CONSENT_LABEL[status] ?? status}
      {exp}
    </span>
  );
}

export const CAMPAIGN_STATUS_STYLE: Record<string, string> = {
  draft: "bg-tile text-slate ring-rule",
  scheduled: "bg-lilac-wash text-lilac-deep ring-lilac-line",
  sending: "bg-terra-wash text-terra-deep ring-terra-line",
  sent: "bg-primary-wash text-primary ring-primary-line",
  cancelled: "bg-paper text-slate ring-rule",
};

export function CampaignStatus({ status }: { status: string }) {
  return (
    <span className={`rounded-md px-2.5 py-0.5 text-xs capitalize ring-1 ${CAMPAIGN_STATUS_STYLE[status] ?? CAMPAIGN_STATUS_STYLE.draft}`}>{status}</span>
  );
}

export const MSG_STATUS_STYLE: Record<string, string> = {
  queued: "bg-lilac-wash text-lilac-deep ring-lilac-line",
  sent: "bg-tile text-slate ring-rule",
  delivered: "bg-primary-wash text-primary ring-primary-line",
  failed: "bg-alert-wash text-alert ring-alert-line",
  skipped: "bg-paper text-slate ring-rule",
};

export const PROMO_LANGS: { code: LanguageCode; tab: string; label: string; script: string }[] = [
  { code: "en-US", tab: "EN", label: "English", script: "English" },
  { code: "zh-CN", tab: "简", label: "Mandarin", script: "简体中文" },
  { code: "zh-HK", tab: "繁", label: "Cantonese", script: "繁體中文" },
  { code: "ko-KR", tab: "한", label: "Korean", script: "한국어" },
];

export function shortDate(iso: string, withYear = false): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "America/Vancouver",
  }).format(d);
}

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Vancouver",
  }).format(new Date(iso));
}

export function money(n: number, digits = 2): string {
  return `$${n.toLocaleString("en-CA", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** A count with its label. "attention" turns it deep green when something waits for the owner. */
export function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "attention" }) {
  const on = accent === "attention";
  return (
    <div className={`rounded-xl p-4 ring-1 ${on ? "bg-primary text-paper ring-primary" : "bg-paper ring-line"}`}>
      <p className={`text-sm ${on ? "text-on-primary-soft" : "text-ink-soft"}`}>{label}</p>
      <p className="display mt-1 text-[2rem] leading-none tabular-nums">{value}</p>
      {sub && <p className={`mt-1.5 text-sm ${on ? "text-on-primary-soft" : "text-ink-soft"}`}>{sub}</p>}
    </div>
  );
}

/** A phone-style message bubble for previews. */
export function Bubble({ text, lang }: { text: string; lang?: string }) {
  return (
    <div lang={lang} className="max-w-[92%] whitespace-pre-wrap rounded-[1.3rem] rounded-bl-md bg-tile px-4 py-3 text-[0.92rem] leading-snug text-ink shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      {text}
    </div>
  );
}
