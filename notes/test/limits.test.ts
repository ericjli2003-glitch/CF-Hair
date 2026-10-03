import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectAudience } from "../src/audience.js";
import { loadCampaign } from "../src/campaigns.js";
import { loadClientsCsv } from "../src/data/csv.js";
import { HandwryttenAdapter } from "../src/providers/handwrytten.js";
import { layoutCard } from "../src/providers/plotter.js";
import { effectiveLimits } from "../src/run.js";
import { charCount, sanitizeForPen, validateNote } from "../src/text.js";
import { generateNotes } from "../src/writer/generate.js";
import { MockWriter } from "../src/writer/mock.js";
import { emptyUsage, type Draft, type DraftRequest, type NoteWriter } from "../src/writer/types.js";

const TODAY = "2026-10-09";
const SAMPLE = loadClientsCsv(path.join(__dirname, "..", "sample", "clients.csv"));
const base = {
  firstName: "Arash",
  maxChars: 120,
  maxCharsZh: 40,
  maxSignatureChars: 50,
  signature: "Warmly,\nJason\nCF Hair Salon",
  requireZh: false,
};

describe("character limits and pen-safe text", () => {
  it("counts graphemes, not UTF-16 units", () => {
    expect(charCount("café")).toBe(4);
    expect(charCount("新年快乐")).toBe(4);
  });

  it("flags notes over the limit", () => {
    const long = `Hi Arash, ${"a".repeat(200)}`;
    const v = validateNote(long, undefined, base);
    expect(v.issues.map((i) => i.code)).toContain("too_long");
    expect(validateNote("Hi Arash, see you soon.", undefined, base).issues).toEqual([]);
  });

  it("removes em and en dashes and smart quotes before a pen sees them", () => {
    const s = sanitizeForPen("Hi Arash \u2014 it’s been 3\u20134 months… see you");
    expect(s).toBe("Hi Arash, it's been 3 to 4 months... see you");
    expect(/[\u2013\u2014]/.test(s)).toBe(false);
  });

  it("rejects emoji, unsupported characters, missing names, private details and salesy copy", () => {
    const codes = (m: string, extra = {}) => validateNote(m, undefined, { ...base, maxChars: 400, ...extra }).issues.map((i) => i.code);
    expect(codes("Hi Arash, see you soon \u{1F600}")).toContain("emoji");
    expect(codes("Hi Arash, see you soon →")).toContain("unsupported_char");
    expect(codes("Hi there, see you soon.")).toContain("missing_name");
    expect(codes("Hi Arash, hope 1194 Lansdowne Drive is well.", { forbidden: ["1194 Lansdowne Drive"] })).toContain("sensitive_detail");
    expect(codes("Hi Arash, limited time offer, book now!")).toContain("salesy");
    expect(codes("Hi Arash, see you soon.", { offerCode: "WELCOME15" })).toContain("offer_missing");
    expect(codes("Hi Arash.", { signature: "x".repeat(60) })).toContain("signature_too_long");
  });

  it("effective limit is the stricter of campaign and provider", () => {
    const c = { ...loadCampaign("win-back"), maxChars: 500 };
    expect(effectiveLimits(c, "handwrytten").maxChars).toBe(450);
    expect(effectiveLimits(c, "plotter").maxChars).toBe(420);
    expect(effectiveLimits(loadCampaign("win-back"), "handwrytten").maxChars).toBe(380);
  });
});

/** Writer that returns a too-long draft first, then whatever the feedback asks for. */
class ScriptedWriter implements NoteWriter {
  readonly name = "scripted";
  readonly mock = true;
  readonly usage = emptyUsage();
  calls: Array<{ ids: string[]; forceRegular?: boolean; prompts: string[] }> = [];
  constructor(private readonly script: (req: DraftRequest, attempt: number) => Draft) {}
  private attempts = new Map<string, number>();
  async draftMany(reqs: DraftRequest[], opts: { forceRegular?: boolean } = {}) {
    this.calls.push({ ids: reqs.map((r) => r.id), forceRegular: opts.forceRegular, prompts: reqs.map((r) => r.user) });
    const out = new Map<string, Draft>();
    for (const r of reqs) {
      const n = (this.attempts.get(r.id) ?? 0) + 1;
      this.attempts.set(r.id, n);
      out.set(r.id, this.script(r, n));
    }
    return out;
  }
}

describe("generation retries until the note fits", () => {
  const campaign = loadCampaign("win-back");
  const matches = selectAudience(campaign, SAMPLE, { today: TODAY, cooldownDays: 30 }).matches.slice(0, 2);
  const limits = { maxChars: 200, maxCharsZh: 130, maxSignatureChars: 50 };

  it("rewrites a too-long note with feedback, using regular calls for the retry", async () => {
    const writer = new ScriptedWriter((r, attempt) => ({
      message:
        attempt === 1
          ? `Hi ${r.ctx.client_first_name}, ${"we really do hope everything is wonderful. ".repeat(8)} WELCOME15`
          : `Hi ${r.ctx.client_first_name}, your chair is here whenever you want a refresh. WELCOME15 is a small welcome back.`,
      messageZh: r.ctx.write_chinese_version ? "好久不见，随时欢迎回来。凭WELCOME15下次可享八五折。" : "",
    }));
    const notes = await generateNotes(campaign, matches, { writer, today: TODAY, ...limits, maxAttempts: 3 });
    expect(notes.every((n) => n.status === "ok")).toBe(true);
    expect(notes.every((n) => n.charCount <= 200 && n.attempts === 2)).toBe(true);
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[1].forceRegular).toBe(true);
    expect(writer.calls[1].prompts[0]).toMatch(/characters; the limit is 200/);
  });

  it("gives up after maxAttempts and marks the note for attention", async () => {
    const writer = new ScriptedWriter((r) => ({ message: `Hi ${r.ctx.client_first_name}, ${"x".repeat(300)} WELCOME15`, messageZh: "好" }));
    const notes = await generateNotes(campaign, matches, { writer, today: TODAY, ...limits, maxAttempts: 3 });
    expect(notes.every((n) => n.status === "needs_attention" && n.attempts === 3)).toBe(true);
    expect(notes[0].issues.map((i) => i.code)).toContain("too_long");
  });

  it("does not retry a refusal; it flags it for a human", async () => {
    const writer = new ScriptedWriter(() => ({ message: "", messageZh: "", refusal: true }));
    const notes = await generateNotes(campaign, matches, { writer, today: TODAY, ...limits, maxAttempts: 3 });
    expect(writer.calls).toHaveLength(1);
    expect(notes[0].issues[0].code).toBe("refusal");
  });

  it("mock templates always fit every campaign limit for every provider", async () => {
    for (const id of ["first-visit-thanks", "birthday", "win-back", "loyal-regulars", "referral-thanks", "lunar-new-year", "holiday"]) {
      const c = loadCampaign(id);
      const m = selectAudience(c, SAMPLE, { today: TODAY, cooldownDays: 30 }).matches;
      for (const provider of ["handwrytten", "plotter"]) {
        const notes = await generateNotes(c, m, { writer: new MockWriter(), today: TODAY, ...effectiveLimits(c, provider), maxAttempts: 1 });
        for (const n of notes) expect({ id: n.noteId, issues: n.issues }).toEqual({ id: n.noteId, issues: [] });
      }
    }
  });
});

describe("provider limits", () => {
  const campaign = loadCampaign("win-back");
  const note = {
    noteId: "win-back-c012",
    idempotencyKey: "win-back:c012:lv-2026-07-20",
    clientId: "c012",
    recipient: { firstName: "Arash", lastName: "Rahimi" },
  } as never;
  const address = { line1: "1194 Lansdowne Drive", city: "Coquitlam", province: "BC", postalCode: "V3E 1K8", country: "CA" };

  it("Handwrytten rejects signatures over 50 characters and messages over its limit", () => {
    const h = new HandwryttenAdapter({ apiKey: "k" });
    const item = { note, campaign, message: "x".repeat(451), signature: "y".repeat(51), address };
    const p = h.validate(item);
    expect(p.join(" ")).toMatch(/451 characters/);
    expect(p.join(" ")).toMatch(/wishes/);
  });

  it("plotter layout fits a full-length note and rejects one that cannot fit", () => {
    const ok = layoutCard({ note, campaign, message: `Hi Arash, ${"hope the perm is treating you well. ".repeat(10)}`.slice(0, 380), signature: "Warmly,\nJason\nCF Hair Salon", address });
    expect(ok.fits).toBe(true);
    expect(ok.inside).toContain("<path");
    expect(ok.inside).not.toContain("<text");
    const tooLong = layoutCard({ note, campaign, message: "word ".repeat(400), signature: "Jason", address });
    expect(tooLong.fits).toBe(false);
  });
});
