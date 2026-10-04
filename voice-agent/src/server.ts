import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import twilio from "twilio";
import { WebSocketServer } from "ws";
import type { AppConfig } from "./config.js";
import type { SessionDeps } from "./agent/session.js";
import { handleRelaySocket } from "./relay/handler.js";
import { actionTwiml, conversationRelayTwiml, dialStatusTwiml, relayToken } from "./relay/twiml.js";

export const RELAY_PATH = "/relay";

/** Base URL Twilio used to reach us. Twilio signs the exact URL configured in the console. */
function publicBase(cfg: AppConfig, req: Request): string {
  if (cfg.publicBaseUrl) return cfg.publicBaseUrl;
  const host = (req.header("x-forwarded-host") ?? req.header("host") ?? "localhost").split(",")[0].trim();
  const proto = (req.header("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}

export function twilioSignatureMiddleware(cfg: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.validateTwilioSignature) return next();
    if (!cfg.twilioAuthToken) {
      console.error("[twilio] TWILIO_AUTH_TOKEN is not set; refusing webhook. Set it, or TWILIO_VALIDATE_SIGNATURE=false for local testing.");
      res.status(500).type("text/plain").send("Server not configured");
      return;
    }
    const signature = req.header("x-twilio-signature") ?? "";
    const url = publicBase(cfg, req) + req.originalUrl;
    const ok = twilio.validateRequest(cfg.twilioAuthToken, signature, url, req.body ?? {});
    if (!ok) {
      console.warn(`[twilio] invalid signature for ${url}`);
      res.status(403).type("text/plain").send("Invalid Twilio signature");
      return;
    }
    next();
  };
}

export function createServer(deps: SessionDeps) {
  const cfg = deps.config;
  const tokenSecret = cfg.validateTwilioSignature ? cfg.twilioAuthToken : "";
  const app = express();
  app.set("trust proxy", true);
  app.use(express.urlencoded({ extended: false }));

  const relayOpts = (req: Request) => {
    const base = publicBase(cfg, req);
    const callSid = String(req.body?.CallSid ?? "");
    return {
      wsUrl: base.replace(/^http/, "ws") + RELAY_PATH,
      actionUrl: `${base}/twiml/action`,
      languages: deps.languages,
      startTranscription: cfg.startTranscriptionLanguage,
      startSpeechModel: cfg.startSpeechModel,
      token: tokenSecret ? relayToken(tokenSecret, callSid) : "dev",
    };
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true, model: cfg.anthropicModel, bookingApi: cfg.bookingApiUrl });
  });

  const verify = twilioSignatureMiddleware(cfg);

  // Voice webhook for the salon's Twilio number ("A call comes in").
  app.post("/twiml", verify, (req, res) => {
    res.type("text/xml").send(conversationRelayTwiml({ ...relayOpts(req), greeting: cfg.welcomeGreeting }));
  });

  // <Connect action>: called when the ConversationRelay session ends.
  app.post("/twiml/action", verify, (req, res) => {
    res.type("text/xml").send(
      actionTwiml({
        handoffData: req.body?.HandoffData,
        forwardNumber: cfg.salonForwardNumber,
        dialStatusUrl: `${publicBase(cfg, req)}/twiml/dial-status`,
      }),
    );
  });

  // <Dial action>: transfer finished. If nobody answered, return to the agent to take a message.
  app.post("/twiml/dial-status", verify, (req, res) => {
    // Calls tab: post the call again with how the transfer went.
    if (req.body?.CallSid) void deps.reporter?.transferResult(String(req.body.CallSid), req.body?.DialCallStatus);
    res.type("text/xml").send(dialStatusTwiml({ dialCallStatus: req.body?.DialCallStatus, relay: relayOpts(req) }));
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== RELAY_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleRelaySocket(ws, deps, {
        tokenSecret,
        greeting: cfg.welcomeGreeting,
        onSessionClosed: (s, file) =>
          console.log(`[call ${s.init.callSid}] ended: ${s.log.record.outcome}${file ? ` (log ${file})` : ""}`),
      });
    });
  });

  return { app, server, wss };
}
