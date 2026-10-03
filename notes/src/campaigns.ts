import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CAMPAIGNS_DIR } from "./config.js";
import type { AudienceRule, Campaign } from "./types.js";

const RULES = new Set([
  "everyone",
  "firstVisitWithinDays",
  "birthdayWithinDays",
  "lastVisitBetweenDays",
  "minVisits",
  "maxVisits",
  "hasTag",
  "preferredLanguage",
  "referredSomeoneWithinDays",
  "hasUpcomingBooking",
]);

function checkRule(r: AudienceRule, where: string): void {
  if ("all" in r) return r.all.forEach((x, i) => checkRule(x, `${where}.all[${i}]`));
  if ("any" in r) return r.any.forEach((x, i) => checkRule(x, `${where}.any[${i}]`));
  if ("not" in r) return checkRule(r.not, `${where}.not`);
  if (!RULES.has((r as { rule: string }).rule)) throw new Error(`${where}: unknown rule "${(r as { rule: string }).rule}"`);
}

export function validateCampaign(input: Campaign, file = input.id): Campaign {
  // Older configs used maxCharsZh / chinese; accept them.
  const legacy = input as Campaign & { maxCharsZh?: number; chinese?: boolean };
  const c: Campaign = { ...input };
  c.maxCharsAlt ??= legacy.maxCharsZh ?? 140;
  c.secondLanguage ??= legacy.chinese ?? false;
  const need = ["id", "name", "occasion", "audience", "design", "guidelines", "maxChars", "signature", "dedupe"] as const;
  for (const k of need) if (c[k] == null) throw new Error(`${file}: missing "${k}"`);
  if (!/^[a-z0-9-]+$/.test(c.id)) throw new Error(`${file}: id must be lowercase letters, digits and hyphens`);
  if (c.maxChars < 80 || c.maxChars > 600) throw new Error(`${file}: maxChars should be between 80 and 600`);
  if (!["once", "year", "lastVisit", "firstVisit", "referral"].includes(c.dedupe)) throw new Error(`${file}: bad dedupe "${c.dedupe}"`);
  checkRule(c.audience, `${file}: audience`);
  c.description ??= "";
  c.excludeIfBooked ??= false;
  return c;
}

export function listCampaigns(dir = CAMPAIGNS_DIR): Campaign[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => validateCampaign(JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Campaign, f));
}

export function loadCampaign(idOrPath: string, dir = CAMPAIGNS_DIR): Campaign {
  const file = idOrPath.endsWith(".json") ? path.resolve(idOrPath) : path.join(dir, `${idOrPath}.json`);
  if (!existsSync(file)) {
    const known = listCampaigns(dir).map((c) => c.id);
    throw new Error(`Unknown campaign "${idOrPath}". Known: ${known.join(", ")}`);
  }
  return validateCampaign(JSON.parse(readFileSync(file, "utf8")) as Campaign, path.basename(file));
}

/** "{stylistFirstName}\nCF Hair Salon" style templates. */
export function renderSignature(c: Campaign, stylistName: string | undefined): string {
  if (!stylistName) return c.signature.fallback;
  const first = stylistName.trim().split(/\s+/)[0];
  return c.signature.template.replace(/\{stylistFirstName\}/g, first).replace(/\{stylistName\}/g, stylistName.trim());
}
