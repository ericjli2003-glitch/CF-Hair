/** Turns an audience into validated notes: draft, sanitise, validate, retry with feedback. */
import { renderSignature } from "../campaigns.js";
import { altLimit, altScriptFor } from "../language.js";
import { charCount, retryable, sanitizeAlt, sanitizeForPen, validateNote } from "../text.js";
import type { AltScript, AudienceMatch, Campaign, IsoDate, Note, NoteIssue } from "../types.js";
import { buildClientContext, buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { Draft, DraftRequest, NoteWriter } from "./types.js";

export interface GenerateOptions {
  writer: NoteWriter;
  today: IsoDate;
  /** Effective limits: min(campaign limit, provider limit). */
  maxChars: number;
  maxCharsAlt: number;
  maxSignatureChars: number;
  maxAttempts: number;
  log?: (m: string) => void;
}

export function noteIdFor(campaign: Campaign, clientId: string): string {
  return `${campaign.id}-${clientId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/** Details that must never appear on a card. */
export function forbiddenDetails(m: AudienceMatch): string[] {
  const c = m.client;
  const out: string[] = [];
  if (c.address) out.push(c.address.line1, c.address.postalCode, c.address.postalCode.replace(" ", ""));
  if (c.email) out.push(c.email);
  if (c.phone) out.push(c.phone.replace(/\D/g, "").slice(-7));
  const year = /^(\d{4})-/.exec(c.birthday ?? "")?.[1];
  if (year) out.push(year);
  return out.filter(Boolean);
}

export async function generateNotes(campaign: Campaign, matches: AudienceMatch[], opts: GenerateOptions): Promise<Note[]> {
  const log = opts.log ?? (() => {});
  const system = buildSystemPrompt(campaign, { maxChars: opts.maxChars, maxCharsAlt: opts.maxCharsAlt });

  type Slot = {
    match: AudienceMatch;
    req: DraftRequest;
    attempts: number;
    draft?: Draft;
    message: string;
    messageAlt: string;
    altScript?: AltScript;
    issues: NoteIssue[];
    charCount: number;
    charCountAlt?: number;
    signature: string;
  };

  const slots: Slot[] = matches.map((m) => {
    const ctx = buildClientContext(m, campaign, opts.today);
    const id = noteIdFor(campaign, m.client.id);
    return {
      match: m,
      req: {
        id,
        system,
        user: buildUserPrompt(ctx),
        ctx,
        meta: {
          campaignId: campaign.id,
          serviceId: m.client.lastServiceId,
          stylist: ctx.stylist_first_name,
          altScript: campaign.secondLanguage ? altScriptFor(m.client.preferredLanguage) : undefined,
        },
      },
      attempts: 0,
      message: "",
      messageAlt: "",
      altScript: campaign.secondLanguage ? altScriptFor(m.client.preferredLanguage) : undefined,
      issues: [],
      charCount: 0,
      signature: renderSignature(campaign, m.client.favouriteStaffName),
    };
  });

  const evaluate = (s: Slot) => {
    const d = s.draft!;
    if (d.refusal) {
      s.issues = [{ code: "refusal", message: "Claude declined to write this note; write it by hand." }];
      return;
    }
    if (d.error) {
      s.issues = [{ code: "api_error", message: d.error }];
      return;
    }
    s.message = sanitizeForPen(d.message);
    s.messageAlt = s.altScript ? sanitizeAlt(d.messageAlt, s.altScript) : "";
    const v = validateNote(s.message, s.messageAlt || undefined, {
      firstName: s.match.client.firstName,
      maxChars: opts.maxChars,
      maxCharsAlt: altLimit(opts.maxCharsAlt, s.altScript),
      maxSignatureChars: opts.maxSignatureChars,
      signature: s.signature,
      altScript: s.altScript,
      offerCode: campaign.offer?.code,
      forbidden: forbiddenDetails(s.match),
    });
    s.issues = v.issues;
    s.charCount = v.charCount;
    s.charCountAlt = v.charCountAlt;
  };

  let pending = slots;
  let round = 0;
  while (pending.length > 0 && round < opts.maxAttempts) {
    round++;
    if (round > 1) log(`Retrying ${pending.length} note(s) that broke a rule (attempt ${round} of ${opts.maxAttempts})`);
    const drafts = await opts.writer.draftMany(
      pending.map((s) => s.req),
      { forceRegular: round > 1, log },
    );
    for (const s of pending) {
      s.attempts++;
      s.draft = drafts.get(s.req.id) ?? { message: "", messageAlt: "", error: "no result returned" };
      evaluate(s);
    }
    pending = pending.filter((s) => s.issues.length > 0 && retryable(s.issues) && !s.draft?.refusal);
    for (const s of pending) {
      const problems = s.issues.map((i) => i.message);
      const over = s.charCount - opts.maxChars;
      if (over > 0) problems.push(`Cut at least ${over + 25} characters. Shorter sentences, fewer adjectives.`);
      s.req = { ...s.req, user: buildUserPrompt(s.req.ctx, { previous: s.message, problems }) };
    }
  }

  return slots.map((s): Note => {
    const c = s.match.client;
    return {
      noteId: s.req.id,
      idempotencyKey: s.match.idempotencyKey,
      campaignId: campaign.id,
      clientId: c.id,
      recipient: { firstName: c.firstName, lastName: c.lastName, address: c.address },
      preferredLanguage: c.preferredLanguage,
      altScript: s.altScript,
      stylistName: c.favouriteStaffName,
      lastServiceName: c.lastServiceName,
      visitCount: c.visitCount,
      reasons: s.match.reasons,
      message: s.message,
      messageAlt: s.messageAlt || undefined,
      signature: s.signature,
      charCount: s.charCount || charCount(s.message),
      charCountAlt: s.charCountAlt,
      maxChars: opts.maxChars,
      maxCharsAlt: altLimit(opts.maxCharsAlt, s.altScript),
      issues: s.issues,
      status: s.issues.length === 0 ? "ok" : "needs_attention",
      writer: opts.writer.name,
      attempts: s.attempts,
    };
  });
}
