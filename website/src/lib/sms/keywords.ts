// Inbound SMS keyword handling. A reply only counts as a keyword when the whole
// message is the keyword (ignoring case, spaces and trailing punctuation), which
// matches how carriers and Twilio's Advanced Opt-Out treat them: "STOP" opts out,
// "please stop by at 3" does not.

export type KeywordAction = "stop" | "start" | "help";

/** English keywords are also handled by Twilio Advanced Opt-Out at the carrier level. */
export const STOP_KEYWORDS = [
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "ARRET",
  // Chinese and Korean equivalents (handled by this app only, not by Twilio)
  "退订", "退訂", "取消", "取消订阅", "取消訂閱", "수신거부",
] as const;
export const START_KEYWORDS = ["START", "UNSTOP", "SUBSCRIBE", "JOIN", "订阅", "訂閱", "수신동의"] as const;
export const HELP_KEYWORDS = ["HELP", "INFO", "帮助", "幫助", "도움말"] as const;

/** Keywords that Twilio Advanced Opt-Out answers itself (so the app must not reply twice). */
export const TWILIO_HANDLED = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "START", "UNSTOP", "YES", "HELP", "INFO"]);

export function normaliseKeyword(body: string): string {
  return body
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // ARRÊT -> ARRET
    .normalize("NFC")
    .trim()
    .replace(/^[\s"'“”‘’.,!?。，！？、~]+|[\s"'“”‘’.,!?。，！？、~]+$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * Classifies an inbound text. `YES` re-subscribes only when the number is currently
 * withdrawn, because Twilio treats YES as an opt-in keyword on long codes and the
 * app must stay in sync with Twilio's block list. Otherwise YES is a normal reply.
 */
export function classifyKeyword(body: string, opts: { currentlyWithdrawn?: boolean } = {}): KeywordAction | null {
  const k = normaliseKeyword(body);
  if (!k) return null;
  if ((STOP_KEYWORDS as readonly string[]).includes(k)) return "stop";
  if ((START_KEYWORDS as readonly string[]).includes(k)) return "start";
  if (k === "YES" && opts.currentlyWithdrawn) return "start";
  if ((HELP_KEYWORDS as readonly string[]).includes(k)) return "help";
  return null;
}

/** True when Twilio Advanced Opt-Out will already have replied to this keyword. */
export function twilioRepliesTo(body: string): boolean {
  return TWILIO_HANDLED.has(normaliseKeyword(body));
}
