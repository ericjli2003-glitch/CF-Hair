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
}

/**
 * <Connect><Stream>: a two-way audio stream to this server for the whole call. When the server
 * closes the stream (the agent ended the call), Twilio moves on to <Hangup/>.
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
  vr.hangup();
  return vr.toString();
}
