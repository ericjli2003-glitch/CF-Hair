import { SALON_TZ } from "./salon";

// Stylist markers: dark inks that keep 3:1 or more against white and the tile
// background, distinct from the light rod colours that mean a service category.
export const STAFF_COLORS = ["#1f4e79", "#2e6b4f", "#6a3d7a", "#8a4b12", "#3d4a45"];

export function staffColor(index: number): string {
  return STAFF_COLORS[index % STAFF_COLORS.length];
}

/** "10:30" from an ISO string already expressed in salon time. */
export const hhmm = (iso: string) => iso.slice(11, 16);

export function time12(iso: string): string {
  const [h, m] = hhmm(iso).split(":").map(Number);
  const s = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${s}`;
}

export function dayLabel(dateKey: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function relTime(date: Date | string, now = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: SALON_TZ }).format(d);
}

export function phonePretty(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  completed: "bg-tile text-slate ring-rule",
  "no-show": "bg-rose-50 text-rose-800 ring-rose-200",
  cancelled: "bg-white text-slate ring-rule line-through",
};

export const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  completed: "Completed",
  "no-show": "No-show",
  cancelled: "Cancelled",
};

export const SOURCE_LABEL: Record<string, string> = {
  web: "Online",
  phone: "Phone",
  "walk-in": "Walk-in",
  admin: "Owner",
};
