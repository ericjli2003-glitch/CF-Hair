import { openStatus } from "@/lib/hours";
import { fill, type Dict, type Lang } from "@/lib/i18n/dictionary";
import { formatTime } from "@/lib/i18n/localize";
import { DAY_KEYS, salon, SALON_TZ } from "@/lib/salon";

/** The week's hours, with consecutive days that share hours grouped: "Mon to Sat", "10 am to 6 pm". */
export function weeklyHours(t: Dict, lang: Lang): { days: string; hours: string }[] {
  const groups: { from: string; to: string; hours: string }[] = [];
  for (const d of DAY_KEYS) {
    const h = salon.hours[d];
    const hours = h ? `${formatTime(h.open, lang)}${t.common.to}${formatTime(h.close, lang)}` : t.common.closed;
    const last = groups.at(-1);
    if (last && last.hours === hours) last.to = d;
    else groups.push({ from: d, to: d, hours });
  }
  const dayName = (d: string) => t.daysShort[d as keyof typeof t.daysShort];
  return groups.map((g) => ({ days: g.from === g.to ? dayName(g.from) : `${dayName(g.from)}${t.common.to}${dayName(g.to)}`, hours: g.hours }));
}

/** "Open today until 6 pm", or when the salon opens next. */
export function openNowText(t: Dict, lang: Lang, now = new Date()): { open: boolean; text: string } | null {
  const s = openStatus(salon.hours, now, SALON_TZ);
  switch (s.kind) {
    case "open":
      return { open: true, text: fill(t.hours.openUntil, { time: formatTime(s.until, lang) }) };
    case "later-today":
      return { open: false, text: fill(t.hours.opensToday, { time: formatTime(s.at, lang) }) };
    case "tomorrow":
      return { open: false, text: fill(t.hours.opensTomorrow, { time: formatTime(s.at, lang) }) };
    case "on":
      return { open: false, text: fill(t.hours.opensOn, { day: t.days[s.day], time: formatTime(s.at, lang) }) };
    default:
      return null;
  }
}

export function OpenNow({ t, lang, className = "" }: { t: Dict; lang: Lang; className?: string }) {
  const s = openNowText(t, lang);
  if (!s) return null;
  return (
    <p className={`flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden="true"
        className={`inline-block h-3 w-3 shrink-0 rounded-full border-2 border-primary ${s.open ? "bg-primary" : "bg-transparent"}`}
      />
      {s.text}
    </p>
  );
}
