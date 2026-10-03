import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the notes/ package root. */
export const NOTES_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(NOTES_ROOT, "..");
export const OUT_DIR = process.env.NOTES_OUT_DIR ? path.resolve(process.env.NOTES_OUT_DIR) : path.join(NOTES_ROOT, "out");
export const CAMPAIGNS_DIR = path.join(NOTES_ROOT, "campaigns");
export const SALON_JSON = path.join(REPO_ROOT, "shared", "salon.json");
export const DEFAULT_HISTORY = process.env.NOTES_HISTORY
  ? path.resolve(process.env.NOTES_HISTORY)
  : path.join(NOTES_ROOT, "data", "history.json");

export interface ProviderSettings {
  label: string;
  maxMessageChars: number;
  maxSignatureChars: number;
  envelopeCountryLine: boolean;
  pricingUSD?: Record<string, number>;
  pricingCAD?: Record<string, number>;
  pricingNote?: string;
}

export interface Settings {
  cooldownDays: number;
  defaultProvider: string;
  claude: {
    model: string;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
    batchThreshold: number;
    concurrency: number;
    maxAttempts: number;
    batchPollSeconds: number;
    pricePerMTokUSD: { input: number; output: number; cacheRead: number; cacheWrite5m: number };
    estimateTokensPerNote: { systemCached: number; user: number; output: number };
  };
  fxUsdToCad: number;
  providers: Record<string, ProviderSettings>;
}

let cached: Settings | undefined;

export function loadSettings(): Settings {
  if (!cached) {
    cached = JSON.parse(readFileSync(path.join(NOTES_ROOT, "settings.json"), "utf8")) as Settings;
    if (process.env.NOTES_MODEL) cached.claude.model = process.env.NOTES_MODEL;
  }
  return cached;
}

export function providerSettings(name: string): ProviderSettings {
  const p = loadSettings().providers[name];
  if (!p) throw new Error(`Unknown provider "${name}". Known: ${Object.keys(loadSettings().providers).join(", ")}`);
  return p;
}

export interface SalonInfo {
  name: string;
  phone: string;
  address: { street: string; city: string; province: string; postal: string; country: string };
  services: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string; role?: string }>;
  languages: string[];
}

export function loadSalon(): SalonInfo {
  return JSON.parse(readFileSync(SALON_JSON, "utf8")) as SalonInfo;
}

/** Return address for envelopes. Strips the "(Henderson Place Mall)" note from the street line. */
export function salonReturnAddress() {
  const s = loadSalon();
  const street = s.address.street.replace(/\s*\(.*?\)\s*/g, " ").trim();
  return {
    name: s.name,
    line1: street,
    city: s.address.city,
    province: s.address.province,
    postalCode: s.address.postal,
    country: s.address.country,
  };
}
