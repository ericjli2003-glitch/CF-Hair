import twilio from "twilio";
import type { LanguageCode } from "../languages.js";

export interface S2sTwimlOptions {
  /** wss://.../s2s/media */
  wsUrl: string;
  token: string;
  from?: string;
  to?: string;
  startLanguage: LanguageCode;
  opening: "welcome" | "returning";
  /** Where Twilio goes when the stream ends: an apology if the call failed, otherwise a hang-up. */
  afterUrl: string;
}

/**
 * <Connect><Stream>: a two-way audio stream to this server for the whole call. When the server
 * closes the stream, Twilio moves on to <Redirect> (afterUrl), which hangs up, or apologizes first
 * if the call failed.
 */
export function s2sTwiml(o: S2sTwimlOptions): string {
  const vr = new twilio.twiml.VoiceResponse();
  const stream = vr.connect().stream({ url: o.wsUrl });
  const params: Record<string, string | undefined> = {
    token: o.token,
    from: o.from,
    to: o.to,
    startLanguage: o.startLanguage,
    opening: o.opening,
  };
  for (const [name, value] of Object.entries(params)) if (value) stream.parameter({ name, value });
  vr.redirect({ method: "POST" }, o.afterUrl);
  return vr.toString();
}

/** After the stream: a short apology when the call failed, then a hang-up. */
export function s2sAfterTwiml(failed: boolean): string {
  const vr = new twilio.twiml.VoiceResponse();
  if (failed) vr.say("Sorry, this test line is not working right now. Please try again later.");
  vr.hangup();
  return vr.toString();
}
