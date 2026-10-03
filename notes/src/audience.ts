/** Audience selection: evaluates campaign rules against clients and applies mailing exclusions. */
import { daysBetween, nextBirthday } from "./dates.js";
import type { History } from "./history.js";
import type { AudienceMatch, AudienceRule, Campaign, Client, Exclusion, IsoDate } from "./types.js";
import { isValidCanadianPostal } from "./data/csv.js";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface EvalContext {
  today: IsoDate;
  clientsById: Map<string, Client>;
  referralsByReferrer: Map<string, Client[]>;
}

interface RuleResult {
  ok: boolean;
  reasons: string[];
  occasion: AudienceMatch["occasion"];
}

function evalRule(rule: AudienceRule, c: Client, ctx: EvalContext): RuleResult {
  const no = (): RuleResult => ({ ok: false, reasons: [], occasion: {} });
  const yes = (reason: string, occasion: AudienceMatch["occasion"] = {}): RuleResult => ({ ok: true, reasons: [reason], occasion });

  if ("all" in rule) {
    const out: RuleResult = { ok: true, reasons: [], occasion: {} };
    for (const r of rule.all) {
      const res = evalRule(r, c, ctx);
      if (!res.ok) return no();
      out.reasons.push(...res.reasons);
      Object.assign(out.occasion, res.occasion);
    }
    return out;
  }
  if ("any" in rule) {
    for (const r of rule.any) {
      const res = evalRule(r, c, ctx);
      if (res.ok) return res;
    }
    return no();
  }
  if ("not" in rule) {
    const res = evalRule(rule.not, c, ctx);
    return res.ok ? no() : { ok: true, reasons: [], occasion: {} };
  }

  switch (rule.rule) {
    case "everyone":
      return yes("all clients");
    case "firstVisitWithinDays": {
      if (!c.firstVisit) return no();
      const d = daysBetween(c.firstVisit, ctx.today);
      return d >= 0 && d <= rule.days ? yes(d === 0 ? "first visit today" : `first visit ${plural(d, "day")} ago`, { daysSinceFirstVisit: d }) : no();
    }
    case "birthdayWithinDays": {
      if (!c.birthday) return no();
      const next = nextBirthday(c.birthday, ctx.today);
      if (!next) return no();
      const d = daysBetween(ctx.today, next);
      return d <= rule.days
        ? yes(d === 0 ? "birthday today" : `birthday in ${plural(d, "day")}`, { birthdayDate: next, daysUntilBirthday: d })
        : no();
    }
    case "lastVisitBetweenDays": {
      if (!c.lastVisit) return no();
      const d = daysBetween(c.lastVisit, ctx.today);
      return d >= rule.min && d <= rule.max ? yes(`last visit ${plural(d, "day")} ago`, { daysSinceLastVisit: d }) : no();
    }
    case "minVisits":
      return c.visitCount >= rule.count ? yes(plural(c.visitCount, "visit")) : no();
    case "maxVisits":
      return c.visitCount <= rule.count ? yes(plural(c.visitCount, "visit")) : no();
    case "hasTag":
      return c.tags.map((t) => t.toLowerCase()).includes(rule.tag.toLowerCase()) ? yes(`tagged ${rule.tag}`) : no();
    case "preferredLanguage":
      return c.preferredLanguage === rule.language ? yes(`prefers ${rule.language}`) : no();
    case "referredSomeoneWithinDays": {
      const referred = (ctx.referralsByReferrer.get(c.id) ?? [])
        .filter((r) => r.firstVisit && daysBetween(r.firstVisit, ctx.today) >= 0 && daysBetween(r.firstVisit, ctx.today) <= rule.days)
        .sort((a, b) => (b.firstVisit ?? "").localeCompare(a.firstVisit ?? ""));
      const r = referred[0];
      return r
        ? yes(`referred ${r.firstName} (first visit ${r.firstVisit})`, {
            referred: { id: r.id, firstName: r.firstName, firstVisit: r.firstVisit },
          })
        : no();
    }
  }
}

export function idempotencyKey(campaign: Campaign, c: Client, occasion: AudienceMatch["occasion"], today: IsoDate): string {
  const base = `${campaign.id}:${c.id}`;
  switch (campaign.dedupe) {
    case "once":
      return base;
    case "year":
      return `${base}:${(occasion.birthdayDate ?? today).slice(0, 4)}`;
    case "lastVisit":
      return `${base}:lv-${c.lastVisit ?? "none"}`;
    case "firstVisit":
      return `${base}:fv-${c.firstVisit ?? "none"}`;
    case "referral":
      return `${base}:ref-${occasion.referred?.id ?? "none"}`;
  }
}

const DO_NOT_MAIL = new Set(["do-not-mail", "no-mail", "opt-out", "deceased", "moved"]);

export interface SelectOptions {
  today: IsoDate;
  history?: History;
  cooldownDays: number;
}

export interface Selection {
  matches: AudienceMatch[];
  excluded: Exclusion[];
}

/**
 * Pick the campaign audience. A client must match the rule AND be mailable:
 * has a complete Canadian address, is not opted out, has not already received
 * this campaign for this occasion, and has not had any card in the cooldown window.
 */
export function selectAudience(campaign: Campaign, clients: Client[], opts: SelectOptions): Selection {
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const referralsByReferrer = new Map<string, Client[]>();
  for (const c of clients) {
    if (!c.referredBy) continue;
    const list = referralsByReferrer.get(c.referredBy) ?? [];
    list.push(c);
    referralsByReferrer.set(c.referredBy, list);
  }
  const ctx: EvalContext = { today: opts.today, clientsById, referralsByReferrer };
  const matches: AudienceMatch[] = [];
  const excluded: Exclusion[] = [];

  for (const c of clients) {
    const res = evalRule(campaign.audience, c, ctx);
    if (!res.ok) continue;
    const tags = c.tags.map((t) => t.toLowerCase());
    const blockedTag = tags.find((t) => DO_NOT_MAIL.has(t));
    if (blockedTag) {
      excluded.push({ client: c, reason: `opted out (${blockedTag})` });
      continue;
    }
    if (!c.firstName) {
      excluded.push({ client: c, reason: "no first name" });
      continue;
    }
    if (!c.address || !c.address.line1 || !c.address.city || !c.address.postalCode) {
      excluded.push({ client: c, reason: "no mailing address" });
      continue;
    }
    if (c.address.country === "CA" && !isValidCanadianPostal(c.address.postalCode)) {
      excluded.push({ client: c, reason: `invalid postal code "${c.address.postalCode}"` });
      continue;
    }
    const key = idempotencyKey(campaign, c, res.occasion, opts.today);
    if (opts.history?.isBlocked(key)) {
      excluded.push({ client: c, reason: "already sent this card" });
      continue;
    }
    if (!campaign.ignoreCooldown && opts.history && opts.cooldownDays > 0) {
      const last = opts.history.lastSentOn(c.id);
      if (last && daysBetween(last, opts.today) < opts.cooldownDays) {
        excluded.push({ client: c, reason: `received a card on ${last} (cooldown ${opts.cooldownDays} days)` });
        continue;
      }
    }
    matches.push({ client: c, reasons: res.reasons, occasion: res.occasion, idempotencyKey: key });
  }
  matches.sort((a, b) => a.client.lastName.localeCompare(b.client.lastName) || a.client.firstName.localeCompare(b.client.firstName));
  return { matches, excluded };
}
