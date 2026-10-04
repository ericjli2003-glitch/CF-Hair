import { toE164 } from "./phone.js";

/**
 * The salon's existing number forwards unanswered calls to this receptionist. Transferring a
 * caller back to that same number would ring it, go unanswered, forward back here and loop.
 * Returns why a transfer must not happen, or null when it is safe.
 */
export interface TransferGuardInput {
  /** SALON_FORWARD_NUMBER: where transfers ring. */
  target: string | null | undefined;
  /** The salon's public number whose unanswered calls forward here (SALON_MAIN_NUMBER or salon.json). */
  mainNumber: string | null | undefined;
  /** Twilio's ForwardedFrom for this call, when the carrier provides it. */
  forwardedFrom?: string | null;
  /** True when this call already came back from an unanswered transfer. */
  alreadyTried?: boolean;
}

export function transferBlockReason(i: TransferGuardInput): string | null {
  const target = toE164(i.target);
  if (!target) return "No transfer number is configured.";
  if (target === toE164(i.mainNumber)) {
    return "The transfer number is the salon's main line, which forwards unanswered calls back here, so a transfer would loop. Take a message instead.";
  }
  if (i.forwardedFrom && target === toE164(i.forwardedFrom)) {
    return "This call was forwarded from the transfer number, so nobody there picked up and a transfer would loop. Take a message instead.";
  }
  if (i.alreadyTried) return "A transfer was already tried on this call and nobody answered. Take a message instead.";
  return null;
}
