// "Draft with Claude": turns a one-line brief into a short promo in English,
// Simplified Chinese, Traditional Chinese (Cantonese readers) and Korean.
// Only offered when ANTHROPIC_API_KEY is set. The owner always reviews the text;
// the sender prefix and STOP footer are added later by compose.ts, so the model is
// told not to write them.
import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "../api";
import { salon } from "../salon";
import { composePromo } from "./compose";
import { countSegments } from "./segments";

export function draftingEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export const DRAFT_MODEL = () => process.env.ANTHROPIC_PROMO_MODEL || "claude-sonnet-5-5";

export interface DraftResult {
  name: string;
  bodies: { "en-US": string; "zh-CN": string; "zh-HK": string; "ko-KR": string };
  model: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short internal campaign name in English, 2 to 5 words" },
    en: { type: "string" },
    zh_cn: { type: "string" },
    zh_hk: { type: "string" },
    ko: { type: "string" },
  },
  required: ["name", "en", "zh_cn", "zh_hk", "ko"],
  additionalProperties: false,
} as const;

const SYSTEM = `You write promotional text messages for ${salon.name}, a friendly unisex hair salon in Henderson Place, Coquitlam, BC, Canada. Clients are local families and professionals; many speak Mandarin, Cantonese or Korean.

Write one promo from the owner's brief, in four versions:
- en: English. At most 105 characters, plain ASCII only (no emoji, no curly quotes, no dashes other than a hyphen), so that with the salon name prefix and the opt-out line it fits one 160 character SMS segment.
- zh_cn: Simplified Chinese for Mandarin readers, at most 32 characters.
- zh_hk: Traditional Chinese written for Hong Kong Cantonese readers, at most 32 characters.
- ko: Korean, polite (요/니다), at most 34 characters.

Rules:
- Do not include the salon name, "Reply STOP", or any opt-out wording: they are added automatically.
- Only state facts from the brief. Never invent prices, percentages, dates, or conditions.
- Warm and direct, one clear call to action (book online or call). No ALL CAPS, no hashtags, no emoji.
- The four versions say the same thing; translate the meaning naturally, not word for word.
- If you mention the mall, write "Henderson Place" exactly, in English, in every version. Never translate or transliterate it and do not add a word for "mall".`;

export async function draftPromo(brief: string): Promise<DraftResult> {
  if (!draftingEnabled()) throw new HttpError(404, "DRAFTING_DISABLED", "Set ANTHROPIC_API_KEY to enable drafting");
  const text = brief.trim().slice(0, 400);
  if (!text) throw new HttpError(400, "INVALID_BRIEF", "Describe the promotion in a sentence");
  const client = new Anthropic();
  const model = DRAFT_MODEL();
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `Brief from the owner: ${text}` }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "DRAFT_RATE_LIMITED", "Claude is busy, try again in a minute");
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, "DRAFT_AUTH", "The Anthropic API key was rejected");
    if (e instanceof Anthropic.APIError) throw new HttpError(502, "DRAFT_FAILED", e.message);
    throw e;
  }
  if (response.stop_reason === "refusal") throw new HttpError(422, "DRAFT_REFUSED", "Claude declined this brief. Try rewording it.");
  if (response.stop_reason === "max_tokens") throw new HttpError(502, "DRAFT_TRUNCATED");
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new HttpError(502, "DRAFT_EMPTY");
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    throw new HttpError(502, "DRAFT_INVALID_JSON");
  }
  const clean = (s: unknown) => (typeof s === "string" ? s.replace(/[\u2013\u2014]/g, ", ").replace(/\s+/g, " ").trim() : "");
  let en = clean(parsed.en).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  // Keep English to one segment when possible: trim at a sentence boundary if the model ran long.
  if (countSegments(composePromo(en, "en-US")).segments > 1) {
    const cut = en.slice(0, 105);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
    if (stop > 40) en = cut.slice(0, stop + 1);
  }
  return {
    name: clean(parsed.name).slice(0, 60) || "New promotion",
    bodies: { "en-US": en, "zh-CN": clean(parsed.zh_cn), "zh-HK": clean(parsed.zh_hk), "ko-KR": clean(parsed.ko) },
    model: response.model,
  };
}
