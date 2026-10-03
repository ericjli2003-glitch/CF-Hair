import fs from "node:fs";
import { DateTime } from "luxon";

export interface Service {
  id: string;
  name: string;
  category: string;
  durationMin: number;
  priceCAD: number;
  description: string;
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  bio: string;
  serviceIds: string[];
}

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface SalonData {
  name: string;
  address: { street: string; city: string; province: string; postal: string; country: string };
  phone: string;
  timezone: string;
  hours: Record<DayKey, { open: string; close: string } | null>;
  services: Service[];
  staff: Staff[];
  languages: string[];
  policies: { cancellationHours: number; lateMinutes: number; walkIns: boolean };
}

export function loadSalon(filePath: string): SalonData {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return raw as SalonData;
}

const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function dayKey(dt: DateTime): DayKey {
  return DAY_KEYS[dt.weekday - 1];
}

/** Open and close DateTimes for the given date in the salon timezone, or null if closed that day. */
export function hoursOn(salon: SalonData, date: DateTime): { open: DateTime; close: DateTime } | null {
  const h = salon.hours[dayKey(date)];
  if (!h) return null;
  const [oh, om] = h.open.split(":").map(Number);
  const [ch, cm] = h.close.split(":").map(Number);
  const d = date.setZone(salon.timezone);
  return {
    open: d.set({ hour: oh, minute: om, second: 0, millisecond: 0 }),
    close: d.set({ hour: ch, minute: cm, second: 0, millisecond: 0 }),
  };
}

export interface OpenStatus {
  isOpen: boolean;
  /** e.g. "Saturday, October 4 2026, 2:15 PM" */
  nowText: string;
  todayHoursText: string;
  nextOpenText: string | null;
}

export function openStatus(salon: SalonData, now: DateTime): OpenStatus {
  const local = now.setZone(salon.timezone);
  const today = hoursOn(salon, local);
  const isOpen = !!today && local >= today.open && local < today.close;
  let nextOpenText: string | null = null;
  if (!isOpen) {
    for (let i = 0; i < 8; i++) {
      const d = local.plus({ days: i });
      const h = hoursOn(salon, d);
      if (h && h.open > local) {
        nextOpenText = h.open.toFormat("cccc, LLLL d 'at' h:mm a");
        break;
      }
    }
  }
  return {
    isOpen,
    nowText: local.toFormat("cccc, LLLL d yyyy, h:mm a"),
    todayHoursText: today ? `${today.open.toFormat("h:mm a")} to ${today.close.toFormat("h:mm a")}` : "closed today",
    nextOpenText,
  };
}

export function hoursSummary(salon: SalonData): string {
  const names: Record<DayKey, string> = {
    mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
  };
  return DAY_KEYS.map((k) => {
    const h = salon.hours[k];
    if (!h) return `${names[k]}: closed`;
    const fmt = (t: string) => DateTime.fromFormat(t, "HH:mm").toFormat("h:mm a");
    return `${names[k]}: ${fmt(h.open)} to ${fmt(h.close)}`;
  }).join("\n");
}
