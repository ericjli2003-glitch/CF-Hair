import type { WebSocket } from "ws";
import { CallSession, type CallChannel, type SessionDeps } from "../agent/session.js";
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode, type RelayLanguage } from "../languages.js";
import { openingGreeting, verifyRelayToken, type OpeningKind } from "./twiml.js";
import type { CallRegistry } from "./listen.js";
import type { DirectTts } from "../tts/direct.js";

/**
 * ConversationRelay WebSocket protocol.
 * Incoming: setup, prompt, interrupt, dtmf, error, info.
 * Outgoing: text {token, last, lang}, language {ttsLanguage, transcriptionLanguage}, end {handoffData}.
 */
export interface SetupMessage {
  type: "setup";
  sessionId?: string;
  callSid?: string;
  from?: string;
  to?: string;
  direction?: string;
  callerName?: string;
  /** Present when the carrier passed on who forwarded the call (not guaranteed). */
  forwardedFrom?: string;
  customParameters?: Record<string, string>;
}

export type IncomingMessage =
  | SetupMessage
  | { type: "prompt"; voicePrompt: string; lang?: string; last?: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt?: string; durationUntilInterruptMs?: number }
  | { type: "dtmf"; digit: string }
  | { type: "error"; description?: string }
  | { type: "info"; [k: string]: unknown };

export interface RelayOptions {
  /** Secret used for the per-call token. Empty disables the check. */
  tokenSecret: string;
  /** The general English welcome; the opening actually played is rebuilt from the setup parameters. */
  greeting: string;
  languages: Record<LanguageCode, RelayLanguage>;
  /** Hands language identified from the call audio to the right session. */
  registry?: CallRegistry;
  /** Languages spoken with ElevenLabs directly; their text becomes `play` messages. */
  directTts?: DirectTts;
  /** Public URL of a direct speech clip, for the `play` message. */
  ttsUrl?: (id: string) => string;
  onSessionClosed?: (session: CallSession, logFile: string | null) => void;
}

export function handleRelaySocket(ws: WebSocket, deps: SessionDeps, opts: RelayOptions): void {
  let session: CallSession | null = null;

  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const channel: CallChannel = {
    sendText: (token: string, last: boolean, lang: LanguageCode) => {
      if (opts.directTts?.covers(lang) && opts.ttsUrl) {
        // Spoken by ElevenLabs directly (for example Cantonese with Eleven v4 Turbo).
        if (token.trim()) send({ type: "play", source: opts.ttsUrl(opts.directTts.prepare(token, lang)), interruptible: true, preemptible: false });
        return;
      }
      send({ type: "text", token, last, lang });
    },
    setLanguage: (code: LanguageCode) => send({ type: "language", ttsLanguage: code, transcriptionLanguage: code }),
    end: (handoffData: Record<string, unknown>) => send({ type: "end", handoffData: JSON.stringify(handoffData) }),
  };

  ws.on("message", (raw) => {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.warn("[relay] ignoring non-JSON frame");
      return;
    }
    switch (msg.type) {
      case "setup": {
        const callSid = msg.callSid ?? msg.sessionId ?? `unknown-${Date.now()}`;
        if (opts.tokenSecret && !verifyRelayToken(opts.tokenSecret, callSid, msg.customParameters?.token)) {
          console.warn(`[relay] rejected session for ${callSid}: bad or missing token`);
          ws.close(1008, "unauthorized");
          return;
        }
        const params = msg.customParameters ?? {};
        const startLanguage = isLanguageCode(params.startLanguage) ? params.startLanguage : DEFAULT_LANGUAGE;
        const opening: OpeningKind =
          params.opening === "returning" || params.opening === "transfer_failed" ? params.opening : "welcome";
        session = new CallSession(
          deps,
          {
            callSid,
            from: msg.from ?? null,
            to: msg.to ?? null,
            resumeReason: msg.customParameters?.resume ?? null,
            forwardedFrom: msg.customParameters?.forwardedFrom ?? msg.forwardedFrom ?? null,
            startLanguage,
            greeting: openingGreeting(opening, startLanguage, opts.greeting, opts.languages),
          },
          channel,
        );
        console.log(`[call ${callSid}] voice connected (${startLanguage})`);
        opts.registry?.attach(callSid, session);
        // A greeting in a directly spoken language was left out of the TwiML: play it now.
        if (opts.directTts?.covers(startLanguage)) {
          channel.sendText(openingGreeting(opening, startLanguage, opts.greeting, opts.languages), true, startLanguage);
        }
        // The full caller lookup (name, call count, consent) runs while Twilio plays the greeting.
        void session.start().catch((e) => console.error(`[relay] start failed: ${(e as Error).message}`));
        break;
      }
      case "prompt":
        if (msg.last === false) return; // partial transcript (only sent if partialPrompts is enabled)
        // `lang` is the transcription language, or the detected language in "multi" mode.
        void session?.handlePrompt(msg.voicePrompt ?? "", msg.lang ?? null);
        break;
      case "interrupt":
        // Twilio cannot say how much of a played clip was heard; treat it as heard.
        session?.interrupt(session && opts.directTts?.covers(session.language) ? null : (msg.utteranceUntilInterrupt ?? null));
        break;
      case "dtmf":
        void session?.handleDtmf(String(msg.digit ?? ""));
        break;
      case "error":
        console.error(`[call ${session?.init.callSid ?? "?"}] ConversationRelay error: ${msg.description ?? "unknown"}`);
        session?.log.record.errors.push(`relay: ${msg.description ?? "unknown"}`);
        break;
      default:
        break;
    }
  });

  ws.on("close", async () => {
    if (!session) return;
    opts.registry?.detach(session.init.callSid);
    const file = await session.close("caller");
    opts.onSessionClosed?.(session, file);
  });

  ws.on("error", (err) => console.error(`[relay] socket error: ${err.message}`));
}
