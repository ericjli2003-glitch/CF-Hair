import raw from "@/data/salon.json";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type Hours = Partial<Record<DayKey, { open: string; close: string } | null>>;

export interface SalonService {
  id: string;
  name: string;
  category: string;
  durationMin: number;
  priceCAD: number;
  description: string;
}

export interface SalonStaff {
  id: string;
  name: string;
  role: string;
  bio: string;
  serviceIds: string[];
  /** Languages this stylist speaks, when the owner has listed them. */
  languages?: string[];
}

export interface Salon {
  name: string;
  tagline: string;
  type: string;
  address: { street: string; city: string; province: string; postal: string; country: string };
  phone: string;
  email: string;
  website: string;
  social: { instagram?: string; facebook?: string };
  timezone: string;
  hours: Hours;
  services: SalonService[];
  staff: SalonStaff[];
  languages: string[];
  policies: { cancellationHours: number; lateMinutes: number; walkIns: boolean };
}

export const salon = raw as unknown as Salon;

const PLACEHOLDER_PREFIX = /^PLACEHOLDER:\s*/;

/** Strips the "PLACEHOLDER: " marker so placeholder copy reads naturally in the UI. */
export function clean(value: string | undefined | null): string {
  return (value ?? "").replace(PLACEHOLDER_PREFIX, "").trim();
}

/** True when a value is a pure placeholder with no usable content (e.g. a fake email). */
export function isPlaceholderOnly(value: string | undefined | null): boolean {
  const v = (value ?? "").trim();
  if (!v) return true;
  if (/^PLACEHOLDER@/i.test(v) || /\.example$/i.test(v)) return true;
  return false;
}

export const SALON_TZ = salon.timezone || "America/Vancouver";

/**
 * The street line as written for clients. The mall is always "Henderson Place" in
 * every language, never translated and with no word for "mall" added.
 */
export function streetLine(): string {
  return salon.address.street.replace(/Henderson Place Mall/gi, "Henderson Place");
}

export function fullAddress(): string {
  const a = salon.address;
  return `${streetLine()}, ${a.city}, ${a.province} ${a.postal}`;
}

/** "2140" from "2140-1163 Pinetree Way (...)", or "" when the street has no unit. */
export function unitNumber(): string {
  return salon.address.street.match(/^\s*(\w+)-\d/)?.[1] ?? "";
}

/** "1163 Pinetree Way" from "2140-1163 Pinetree Way (...)". */
export function buildingAddress(): string {
  return salon.address.street
    .replace(/^\s*\w+-(?=\d)/, "")
    .replace(/\s*\(.*\)\s*/, "")
    .trim();
}

export function mapsUrl(): string {
  const a = salon.address;
  const q = `${salon.name}, ${a.street.replace(/\s*\(.*\)\s*/, " ")}, ${a.city}, ${a.province} ${a.postal}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function formatPhoneDisplay(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function telHref(): string {
  return `tel:${salon.phone}`;
}

export const CATEGORY_ORDER = Array.from(new Set(salon.services.map((s) => s.category)));

/** Languages a stylist speaks, from salon.json when listed there; otherwise none. */
export function staffLanguages(id: string): string[] {
  const l = salon.staff.find((s) => s.id === id)?.languages;
  return Array.isArray(l) ? l.filter((x) => typeof x === "string" && x && !x.startsWith("PLACEHOLDER")) : [];
}
