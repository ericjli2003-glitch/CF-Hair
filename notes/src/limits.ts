import { providerSettings } from "./config.js";
import type { Campaign } from "./types.js";

/** The stricter of the campaign's and the provider's limits. */
export function effectiveLimitsFor(campaign: Campaign, provider: string) {
  const p = providerSettings(provider);
  return {
    maxChars: Math.min(campaign.maxChars, p.maxMessageChars),
    maxCharsAlt: campaign.maxCharsAlt,
    maxSignatureChars: p.maxSignatureChars,
  };
}
