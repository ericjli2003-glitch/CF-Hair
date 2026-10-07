import type { WebSocket } from "ws";
import type { CallSession } from "../agent/session.js";
import { ScribeLanguageId, type Detection, type ScribeOptions } from "../langid/scribe.js";
import { verifyRelayToken } from "./twiml.js";

/**
 * Twilio Media Stream (<Start><Stream>) for language identification. Twilio sends a copy of the
 * caller's audio here while ConversationRelay runs the call; it is forwarded to Scribe until the
 * first sentence comes back with its language, then the stream is dropped.
 *
 * Twilio messages: connected, start {start: {callSid, customParameters}}, media {media: {payload}}, stop.
 */

/** Detections waiting for their call's ConversationRelay session, and live sessions by call. */
export class CallRegistry {
  private readonly sessions = new Map<string, CallSession>();
  private readonly pending = new Map<string, Detection>();

  attach(callSid: string, session: CallSession) {
    this.sessions.set(callSid, session);
    const d = this.pending.get(callSid);
    if (d) {
      this.pending.delete(callSid);
      void session.applyDetection(d);
    }
  }

  detach(callSid: string) {
    this.sessions.delete(callSid);
    this.pending.delete(callSid);
  }

  deliver(callSid: string, d: Detection) {
    const s = this.sessions.get(callSid);
    if (s) void s.applyDetection(d);
    else this.pending.set(callSid, d);
  }
}

export interface ListenOptions {
  tokenSecret: string;
  scribe: Omit<ScribeOptions, "url" | "apiKey"> & { url: string; apiKey: string };
  registry: CallRegistry;
  /** Stop listening after this long even without a sentence (cost cap). */
  maxMs: number;
}

export function handleListenSocket(ws: WebSocket, opts: ListenOptions): void {
  let scribe: ScribeLanguageId | null = null;
  let callSid = "";
  let timer: NodeJS.Timeout | null = null;
  const stop = () => {
    scribe?.close();
    scribe = null;
    if (timer) clearTimeout(timer);
    if (ws.readyState === ws.OPEN) ws.close();
  };

  ws.on("message", (raw) => {
    let msg: { event?: string; start?: { callSid?: string; customParameters?: Record<string, string> }; media?: { payload?: string } };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.event === "start") {
      callSid = msg.start?.callSid ?? "";
      if (opts.tokenSecret && !verifyRelayToken(opts.tokenSecret, callSid, msg.start?.customParameters?.token)) {
        console.warn(`[listen] rejected stream for ${callSid}: bad or missing token`);
        ws.close(1008, "unauthorized");
        return;
      }
      const t0 = Date.now();
      scribe = new ScribeLanguageId(
        opts.scribe,
        (d) => {
          console.log(`[call ${callSid}] language identified: ${d.languageCode ?? "none"} in ${Date.now() - t0}ms`);
          opts.registry.deliver(callSid, d);
          stop();
        },
        (reason) => {
          console.warn(`[call ${callSid}] language identification unavailable: ${reason}`);
          stop();
        },
      );
      timer = setTimeout(stop, opts.maxMs);
      timer.unref?.();
    } else if (msg.event === "media" && msg.media?.payload) {
      scribe?.sendAudio(msg.media.payload);
    } else if (msg.event === "stop") {
      stop();
    }
  });
  ws.on("close", stop);
  ws.on("error", (err) => console.error(`[listen] socket error: ${err.message}`));
}
