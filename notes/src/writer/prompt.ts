/**
 * Prompt construction. The system prompt is identical for every client in a run
 * (salon voice + campaign guidelines + limits), so it is sent with cache_control
 * and only the short per-client context varies.
 */
import { monthDay, roughlyAgo } from "../dates.js";
import type { AudienceMatch, Campaign, IsoDate } from "../types.js";
import { daysBetween } from "../dates.js";

export interface PromptLimits {
  maxChars: number;
  maxCharsZh: number;
}

export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "The English note body, greeting included, no sign-off or signature.",
    },
    message_zh: {
      type: "string",
      description: "Simplified Chinese version of the note, or an empty string when not requested.",
    },
  },
  required: ["message", "message_zh"],
  additionalProperties: false,
} as const;

const SALON_VOICE = `You write short personal notes that a stylist at CF Hair Salon sends to a client on a real greeting card. A pen-holding robot (or the salon's own pen plotter) writes your words in ink, so the card must read exactly like something a thoughtful person wrote by hand at the front desk.

About the salon
- CF Hair Salon is a small, friendly unisex salon in Henderson Place Mall on Pinetree Way in Coquitlam, BC, near Coquitlam Centre and the Lafarge Lake area.
- Clients are neighbours: families, students, seniors, busy professionals. Many speak Mandarin or Cantonese at home.
- The team does cuts, colour (balayage, highlights, root touch-ups), perms (digital perms, Korean down perms, men's texture perms), straightening, keratin and scalp treatments.

Voice
- Warm, specific and sincere. Sound like the stylist, in the first person ("I" for the stylist, "we" for the salon), talking to one person.
- Specific beats generic: one concrete, natural detail (the service they had, how it suited them, a small thing they mentioned in the chair) is worth more than three adjectives.
- Plain, everyday Canadian English. Canadian spelling (colour, favourite). Short sentences. No marketing language, no exclamation-mark storms (one at most), no puns about hair.
- Never salesy: no urgency, no "limited time", "act now", "don't miss out", "book today", no prices. An invitation to come back is fine when it is gentle and optional.
- Never creepy: do not mention the client's age, birth year, exact dates, how many days or weeks it has been, their address, phone number, how often they visit, or anything that sounds like tracking. Do not mention data, records or systems. Only use details a stylist would naturally remember from chatting in the chair, and only the ones provided.
- Respectful of privacy: if a friend or family member is mentioned, use their first name only and say nothing about their appointment.
- If a client note mentions something sensitive (health, money, grief, relationships), leave it out.

Format rules (strict, because a pen writes this)
- Start with a greeting that uses the client's first name exactly as given, e.g. "Dear Arash," or "Hi Arash,".
- 2 to 4 short sentences after the greeting. Line breaks are allowed only after the greeting.
- Do NOT include a sign-off, closing word or signature (no "Warmly," "Best," or names at the end). The signature is added separately.
- Plain ASCII punctuation only: letters, digits, spaces, . , ! ? ' " : ; ( ) and the ordinary hyphen. Never use em dashes or en dashes; use a comma, colon or full stop instead. No emoji, no symbols, no hashtags, no URLs, no bullet points.
- Respect the character limit given below. Characters include spaces and punctuation. Aim for the target range; a card that is a little short is far better than one that is cut off.
- If an offer is provided, mention it exactly once, naturally, including the code exactly as written. If no offer is provided, do not invent one.

Simplified Chinese version (only when the client context says write_chinese_version: true)
- Write message_zh in natural, warm Simplified Chinese, as a Chinese-speaking stylist would write it. It should carry the same meaning, but do not translate word for word.
- Address the client by name in a natural way (for example "亲爱的美琳：" or the given name followed by a colon). Keep the stylist's first name in its original spelling if you use it.
- Use full-width Chinese punctuation. No emoji, no dashes of any kind, no sign-off or signature.
- Stay within the Chinese character limit given below.
- When write_chinese_version is false, message_zh must be an empty string.

Examples of the tone (do not copy them; every note must be written fresh for its client)
- Win-back, men's perm: "Hi Daniel, I was thinking about that textured perm we did, and I hope it has been easy to style on busy mornings. Whenever you feel like a refresh, your chair is here. As a small welcome back, WELCOME15 takes 15% off your next visit."
- First visit, women's cut: "Dear Sarah, thank you for trusting us with your first visit. Taking your hair up to your shoulders was a big change, and it really suits you. If you have a moment, a Google review means a lot to a small neighbourhood salon like ours. I hope to see you again soon."
- Birthday: "Hi Joyce, happy birthday from all of us at CF Hair! I hope your day is full of good food and the people you love. Your next visit comes with a little birthday treat from us: just mention BDAYTREAT."

Output
- Return JSON with exactly two fields: message (English body) and message_zh (Chinese body or empty string).`;

export function buildSystemPrompt(campaign: Campaign, limits: PromptLimits): string {
  const target = `${Math.round(limits.maxChars * 0.6)} to ${Math.round(limits.maxChars * 0.88)}`;
  const targetZh = `${Math.round(limits.maxCharsZh * 0.5)} to ${Math.round(limits.maxCharsZh * 0.85)}`;
  return `${SALON_VOICE}

This campaign
- Campaign: ${campaign.name} (${campaign.occasion}).
- Guidelines from the salon owner: ${campaign.guidelines}
- English limit: at most ${limits.maxChars} characters; target ${target}.
- Chinese limit: at most ${limits.maxCharsZh} characters; target ${targetZh}.`;
}

export interface ClientContext {
  client_first_name: string;
  stylist_first_name: string | null;
  last_service: string | null;
  relationship: string;
  last_visit: string | null;
  occasion_details: Record<string, string>;
  stylist_note: string | null;
  offer: { code: string; description: string } | null;
  write_chinese_version: boolean;
}

export function buildClientContext(match: AudienceMatch, campaign: Campaign, today: IsoDate): ClientContext {
  const c = match.client;
  const occasion: Record<string, string> = {};
  if (match.occasion.birthdayDate) {
    const d = match.occasion.daysUntilBirthday ?? 0;
    occasion.birthday = d <= 3 ? "their birthday is in the next few days" : `their birthday is on ${monthDay(match.occasion.birthdayDate)}`;
  }
  if (match.occasion.referred) occasion.referred_friend_first_name = match.occasion.referred.firstName;
  if (match.occasion.daysSinceFirstVisit != null) occasion.first_visit = roughlyAgo(match.occasion.daysSinceFirstVisit);
  const relationship =
    c.visitCount <= 1 ? "new client, first visit" : c.visitCount <= 3 ? "fairly new client" : c.visitCount <= 8 ? "regular client" : "long-time regular client";
  return {
    client_first_name: c.firstName,
    stylist_first_name: c.favouriteStaffName ? c.favouriteStaffName.split(/\s+/)[0] : null,
    last_service: c.lastServiceName ?? null,
    relationship,
    last_visit: c.lastVisit ? roughlyAgo(daysBetween(c.lastVisit, today)) : null,
    occasion_details: occasion,
    stylist_note: c.notes ?? null,
    offer: campaign.offer ? { code: campaign.offer.code, description: campaign.offer.description.replace(/\s*\(PLACEHOLDER[^)]*\)/i, "") } : null,
    write_chinese_version: campaign.chinese && c.preferredLanguage === "zh",
  };
}

export function buildUserPrompt(ctx: ClientContext, feedback?: { previous: string; problems: string[] }): string {
  let text = `Write the card for this client.\n\n${JSON.stringify(ctx, null, 2)}`;
  if (feedback) {
    text += `\n\nYour previous draft had problems, so write a new version that fixes them.\nPrevious draft: ${JSON.stringify(feedback.previous)}\nProblems:\n${feedback.problems.map((p) => `- ${p}`).join("\n")}`;
  }
  return text;
}
