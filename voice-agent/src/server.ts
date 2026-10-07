import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import twilio from "twilio";
import { WebSocketServer } from "ws";
import type { AppConfig } from "./config.js";
import type { SessionDeps } from "./agent/session.js";
import { handleRelaySocket } from "./relay/handler.js";
import { CallRegistry, handleListenSocket } from "./relay/listen.js";
import { DirectTts } from "./tts/direct.js";
import { isLanguageCode, looksLikeElevenLabsVoice } from "./languages.js";
import { actionTwiml, conversationRelayTwiml, dialStatusTwiml, openingGreeting, relayToken } from "./relay/twiml.js";
import { normalizeLanguage } from "./languages.js";

export const RELAY_PATH = "/relay";
export const LISTEN_PATH = "/listen";

/** Last four digits only, so logs show which test phone called without storing full numbers. */
function maskPhone(raw: unknown): string {
  const s = String(raw ?? "");
  const digits = s.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : s || "unknown";
}

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
  const registry = new CallRegistry();
  // Languages spoken with ElevenLabs directly use that language's ElevenLabs voice id (CR_<LANG>_VOICE).
  const directVoices = Object.fromEntries(
    cfg.directTtsLanguages
      .filter(isLanguageCode)
      .map((code) => [code, deps.languages[code].voice.split("-")[0]])
      .filter(([, id]) => looksLikeElevenLabsVoice(id)),
  );
  const directTts = new DirectTts({ apiKey: cfg.elevenLabsApiKey, apiBase: cfg.elevenLabsApiBase, model: cfg.directTtsModel, voices: directVoices });
  for (const code of cfg.directTtsLanguages) {
    if (!isLanguageCode(code) || !directTts.covers(code)) console.warn(`Warning: ELEVENLABS_DIRECT_LANGUAGES lists ${code}, but it needs ELEVENLABS_API_KEY and an ElevenLabs voice id in that language's CR_<LANG>_VOICE; using Twilio's voice.`);
  }
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
      speechTimeoutMs: cfg.speechTimeoutMs,
      eotThreshold: cfg.eotThreshold,
      startSpeechModel: cfg.startSpeechModel,
      token: tokenSecret ? relayToken(tokenSecret, callSid) : "dev",
      forwardedFrom: req.body?.ForwardedFrom ? String(req.body.ForwardedFrom) : undefined,
    };
  };

  // Direct ElevenLabs speech clips, fetched by Twilio for `play` messages. Ids are random and single use.
  app.get("/tts/:id.mp3", (req, res) => void directTts.serve(req.params.id, res));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, model: cfg.anthropicModel, bookingApi: cfg.bookingApiUrl });
  });

  const verify = twilioSignatureMiddleware(cfg);

  // Voice webhook for the salon's Twilio number ("A call comes in"). A returning caller's saved
  // language is looked up first (briefly), so the call opens in it; anyone else hears English.
  app.post("/twiml", verify, async (req, res) => {
    const { language, known } = await deps.callers.openingLanguage(req.body?.From, cfg.openingLookupTimeoutMs);
    const opening = known ? "returning" : "welcome";
    console.log(`[call ${req.body?.CallSid ?? "?"}] incoming from ${maskPhone(req.body?.From)}: opening in ${language} (${opening})`);
    res.type("text/xml").send(
      conversationRelayTwiml({
        ...relayOpts(req),
        startLanguage: language,
        opening,
        // Every call that opens in English: a new caller, or a saved English caller who may answer in
        // Chinese or Korean. Calls opening in a saved Chinese or Korean language do not need it.
        listenUrl: language === "en-US" && cfg.elevenLabsApiKey ? publicBase(cfg, req).replace(/^http/, "ws") + LISTEN_PATH : undefined,
        // A directly spoken greeting is played by the relay handler instead.
        greeting: directTts.covers(language) ? "" : openingGreeting(opening, language, cfg.welcomeGreeting, deps.languages),
      }),
    );
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
    const language = normalizeLanguage(typeof req.query.lang === "string" ? req.query.lang : null) ?? undefined;
    res.type("text/xml").send(
      dialStatusTwiml({
        dialCallStatus: req.body?.DialCallStatus,
        language,
        greetingPlayedByServer: directTts.covers(language ?? "en-US"),
        relay: relayOpts(req),
      }),
    );
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === LISTEN_PATH && cfg.elevenLabsApiKey) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleListenSocket(ws, {
          tokenSecret,
          registry,
          maxMs: cfg.languageIdMaxMs,
          scribe: { url: cfg.scribeRealtimeUrl, apiKey: cfg.elevenLabsApiKey },
        });
      });
      return;
    }
    if (url.pathname !== RELAY_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleRelaySocket(ws, deps, {
        tokenSecret,
        greeting: cfg.welcomeGreeting,
        languages: deps.languages,
        registry,
        directTts,
        ttsUrl: (id: string) => `${cfg.publicBaseUrl || `https://${req.headers.host}`}/tts/${id}.mp3`,
        onSessionClosed: (s, file) =>
          console.log(`[call ${s.init.callSid}] ended: ${s.log.record.outcome}${file ? ` (log ${file})` : ""}`),
      });
    });
  });

  return { app, server, wss };
}
