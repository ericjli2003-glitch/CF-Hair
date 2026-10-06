import crypto from "node:crypto";
import twilio from "twilio";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, isLanguageCode, type LanguageCode, type RelayLanguage } from "../languages.js";

const { VoiceResponse } = twilio.twiml;

/** Words that help speech recognition with salon vocabulary. */
export const SPEECH_HINTS = [
  "men's",
  "men's cut",
  "women's",
  "women's cut",
  "men's haircut",
  "women's haircut",
  "kids haircut",
  "haircut",
  "appointment",
  "tomorrow",
  "CF Hair",
  "Henderson Place",
  "Coquitlam",
  "Pinetree Way",
  "balayage",
  "highlights",
  "keratin",
  "digital perm",
  "down perm",
  "root touch-up",
  "updo",
  "braiding",
  "blow-dry",
  "Mandarin",
  "Cantonese",
  "Korean",
].join(",");

/** Per-call token placed in a <Parameter> and checked on the WebSocket `setup` message. */
export function relayToken(secret: string, callSid: string): string {
  return crypto.createHmac("sha256", secret).update(`relay:${callSid}`).digest("base64url");
}

export function verifyRelayToken(secret: string, callSid: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(relayToken(secret, callSid));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Which opening line Twilio plays: the general welcome, a returning caller's, or after a failed transfer. */
export type OpeningKind = "welcome" | "returning" | "transfer_failed";

/** The first words of the call, in the language the call starts in. */
export function openingGreeting(
  kind: OpeningKind,
  language: LanguageCode,
  welcomeGreeting: string,
  languages: Record<LanguageCode, RelayLanguage>,
): string {
  if (kind === "transfer_failed") return languages[language].transferFailed;
  if (kind === "returning") return languages[language].greeting;
  return welcomeGreeting;
}

export interface RelayTwimlOptions {
  wsUrl: string;
  actionUrl: string;
  greeting: string;
  languages: Record<LanguageCode, RelayLanguage>;
  token: string;
  resume?: string;
  /** Language the call opens in: the caller's saved language when known, otherwise English. */
  startLanguage?: LanguageCode;
  opening?: OpeningKind;
  /** Twilio ForwardedFrom on the inbound call, passed through to the session for the transfer guard. */
  forwardedFrom?: string;
  /** "multi" starts transcription in Deepgram automatic language detection mode. */
  startTranscription?: "en-US" | "multi";
  startSpeechModel?: string;
}

/**
 * <Connect action=...><ConversationRelay ...> with a <Language> entry for every language we may
 * switch to. The call starts in `startLanguage`: greeting, voice and speech recognition.
 */
export function conversationRelayTwiml(o: RelayTwimlOptions): string {
  const vr = new VoiceResponse();
  const connect = vr.connect({ action: o.actionUrl, method: "POST" });
  const start = o.startLanguage ?? DEFAULT_LANGUAGE;
  const sl = o.languages[start];
  // Deepgram's "multi" mode covers none of Chinese or Korean, so it only applies to English starts.
  const multi = o.startTranscription === "multi" && start === "en-US";
  const languageAttrs = multi
    ? {
        ttsLanguage: "en-US",
        transcriptionLanguage: "multi",
        transcriptionProvider: "Deepgram",
        speechModel: o.startSpeechModel || "nova-3-general",
      }
    : { language: start, transcriptionProvider: sl.transcriptionProvider, speechModel: sl.speechModel };
  const cr = connect.conversationRelay({
    url: o.wsUrl,
    welcomeGreeting: o.greeting,
    welcomeGreetingInterruptible: "any",
    interruptible: "any",
    ...languageAttrs,
    ttsProvider: sl.ttsProvider,
    voice: sl.voice,
    dtmfDetection: true,
    hints: SPEECH_HINTS,
  });
  for (const code of LANGUAGE_CODES) {
    const l = o.languages[code];
    cr.language({
      code,
      ttsProvider: l.ttsProvider,
      voice: l.voice,
      transcriptionProvider: l.transcriptionProvider,
      speechModel: l.speechModel,
    });
  }
  cr.parameter({ name: "token", value: o.token });
  cr.parameter({ name: "startLanguage", value: start });
  cr.parameter({ name: "opening", value: o.opening ?? "welcome" });
  if (o.resume) cr.parameter({ name: "resume", value: o.resume });
  if (o.forwardedFrom) cr.parameter({ name: "forwardedFrom", value: o.forwardedFrom });
  return vr.toString();
}

/** Response to the <Connect> action callback after the agent sends `end`. */
export function actionTwiml(o: { handoffData: string | undefined; forwardNumber: string; dialStatusUrl: string }): string {
  const vr = new VoiceResponse();
  let data: { reasonCode?: string; language?: string } = {};
  try {
    data = o.handoffData ? JSON.parse(o.handoffData) : {};
  } catch {
    data = {};
  }
  if (data.reasonCode === "live-agent-handoff" && o.forwardNumber) {
    // Carry the call's language so a missed transfer comes back to the agent in that language.
    const action = isLanguageCode(data.language) ? `${o.dialStatusUrl}?lang=${data.language}` : o.dialStatusUrl;
    const dial = vr.dial({ timeout: 20, action, method: "POST" });
    dial.number(o.forwardNumber);
    return vr.toString();
  }
  if (!o.handoffData) {
    // Session ended without the agent saying goodbye (socket error or timeout).
    vr.say("Sorry, something went wrong on our end. Please call the salon again in a few minutes.");
  }
  vr.hangup();
  return vr.toString();
}

/** After a transfer attempt: hang up if it connected, otherwise come back to the agent to take a message. */
export function dialStatusTwiml(o: {
  dialCallStatus: string | undefined;
  /** The call's language before the transfer (from the ?lang= on the dial action URL). */
  language?: LanguageCode;
  relay: Omit<RelayTwimlOptions, "greeting" | "resume" | "startLanguage" | "opening">;
}): string {
  if (o.dialCallStatus === "completed" || o.dialCallStatus === "answered") {
    const vr = new VoiceResponse();
    vr.hangup();
    return vr.toString();
  }
  const language = o.language ?? DEFAULT_LANGUAGE;
  return conversationRelayTwiml({
    ...o.relay,
    greeting: o.relay.languages[language].transferFailed,
    startLanguage: language,
    opening: "transfer_failed",
    resume: "transfer_failed",
  });
}
