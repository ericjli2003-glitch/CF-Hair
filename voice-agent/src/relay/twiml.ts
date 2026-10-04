import crypto from "node:crypto";
import twilio from "twilio";
import { LANGUAGE_CODES, type LanguageCode, type RelayLanguage } from "../languages.js";

const { VoiceResponse } = twilio.twiml;

/** Words that help speech recognition with salon vocabulary. */
export const SPEECH_HINTS = [
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

export interface RelayTwimlOptions {
  wsUrl: string;
  actionUrl: string;
  greeting: string;
  languages: Record<LanguageCode, RelayLanguage>;
  token: string;
  resume?: string;
  /** Twilio ForwardedFrom on the inbound call, passed through to the session for the transfer guard. */
  forwardedFrom?: string;
  /** "multi" starts transcription in Deepgram automatic language detection mode. */
  startTranscription?: "en-US" | "multi";
  startSpeechModel?: string;
}

/**
 * <Connect action=...><ConversationRelay ...> with a <Language> entry for every language we may
 * switch to. The call always starts in English (en-US).
 */
export function conversationRelayTwiml(o: RelayTwimlOptions): string {
  const vr = new VoiceResponse();
  const connect = vr.connect({ action: o.actionUrl, method: "POST" });
  const en = o.languages["en-US"];
  const multi = o.startTranscription === "multi";
  // The greeting and voice are always English. Transcription starts in English, or in Deepgram's
  // "multi" mode, which tags each prompt with the detected language (see README for coverage).
  const languageAttrs = multi
    ? {
        ttsLanguage: "en-US",
        transcriptionLanguage: "multi",
        transcriptionProvider: "Deepgram",
        speechModel: o.startSpeechModel || "nova-3-general",
      }
    : { language: "en-US", transcriptionProvider: en.transcriptionProvider, speechModel: en.speechModel };
  const cr = connect.conversationRelay({
    url: o.wsUrl,
    welcomeGreeting: o.greeting,
    welcomeGreetingInterruptible: "any",
    interruptible: "any",
    ...languageAttrs,
    ttsProvider: en.ttsProvider,
    voice: en.voice,
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
  if (o.resume) cr.parameter({ name: "resume", value: o.resume });
  if (o.forwardedFrom) cr.parameter({ name: "forwardedFrom", value: o.forwardedFrom });
  return vr.toString();
}

/** Response to the <Connect> action callback after the agent sends `end`. */
export function actionTwiml(o: { handoffData: string | undefined; forwardNumber: string; dialStatusUrl: string }): string {
  const vr = new VoiceResponse();
  let data: { reasonCode?: string } = {};
  try {
    data = o.handoffData ? JSON.parse(o.handoffData) : {};
  } catch {
    data = {};
  }
  if (data.reasonCode === "live-agent-handoff" && o.forwardNumber) {
    const dial = vr.dial({ timeout: 20, action: o.dialStatusUrl, method: "POST" });
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
  relay: Omit<RelayTwimlOptions, "greeting" | "resume">;
}): string {
  if (o.dialCallStatus === "completed" || o.dialCallStatus === "answered") {
    const vr = new VoiceResponse();
    vr.hangup();
    return vr.toString();
  }
  return conversationRelayTwiml({
    ...o.relay,
    greeting:
      "Sorry, no one from the team could pick up just now. I can take a message and have someone call you back. What would you like me to pass on?",
    resume: "transfer_failed",
  });
}
