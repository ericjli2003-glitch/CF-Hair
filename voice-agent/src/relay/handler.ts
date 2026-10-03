import type { WebSocket } from "ws";
import { CallSession, type CallChannel, type SessionDeps } from "../agent/session.js";
import type { LanguageCode } from "../languages.js";
import { verifyRelayToken } from "./twiml.js";

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
  greeting: string;
  onSessionClosed?: (session: CallSession, logFile: string | null) => void;
}

export function handleRelaySocket(ws: WebSocket, deps: SessionDeps, opts: RelayOptions): void {
  let session: CallSession | null = null;

  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const channel: CallChannel = {
    sendText: (token: string, last: boolean, lang: LanguageCode) => send({ type: "text", token, last, lang }),
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
        session = new CallSession(
          deps,
          {
            callSid,
            from: msg.from ?? null,
            to: msg.to ?? null,
            resumeReason: msg.customParameters?.resume ?? null,
            greeting: opts.greeting,
          },
          channel,
        );
        // Caller lookup runs while Twilio plays the welcome greeting.
        void session.start().catch((e) => console.error(`[relay] start failed: ${(e as Error).message}`));
        break;
      }
      case "prompt":
        if (msg.last === false) return; // partial transcript (only sent if partialPrompts is enabled)
        void session?.handlePrompt(msg.voicePrompt ?? "");
        break;
      case "interrupt":
        session?.interrupt(msg.utteranceUntilInterrupt ?? null);
        break;
      case "dtmf":
        void session?.handleDtmf(String(msg.digit ?? ""));
        break;
      case "error":
        console.error(`[relay] ConversationRelay error: ${msg.description ?? "unknown"}`);
        session?.log.record.errors.push(`relay: ${msg.description ?? "unknown"}`);
        break;
      default:
        break;
    }
  });

  ws.on("close", async () => {
    if (!session) return;
    const file = await session.close("caller");
    opts.onSessionClosed?.(session, file);
  });

  ws.on("error", (err) => console.error(`[relay] socket error: ${err.message}`));
}
