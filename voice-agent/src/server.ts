import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import twilio from "twilio";
import { WebSocketServer } from "ws";
import type { AppConfig } from "./config.js";
import type { SessionDeps } from "./agent/session.js";
import { handleRelaySocket } from "./relay/handler.js";
import { CallRegistry, handleListenSocket } from "./relay/listen.js";
import { DirectTts } from "./tts/direct.js";
import { isLanguageCode, looksLikeElevenLabsVoice, type LanguageCode } from "./languages.js";
import { actionTwiml, conversationRelayTwiml, dialStatusTwiml, openingGreeting, relayToken } from "./relay/twiml.js";
import { normalizeLanguage } from "./languages.js";
import { handleS2sSocket } from "./s2s/realtime.js";
import { s2sAfterTwiml, s2sTwiml } from "./s2s/twiml.js";
import { openAiAuthFromConfig } from "./s2s/openai-auth.js";
import { azureProvider, openAiProvider, type RealtimeProvider } from "./s2s/providers.js";
import { MiniMaxSpeech } from "./tts/minimax.js";
import { ElevenSpeech } from "./tts/elevenlabs.js";
import { AudioLanguageId } from "./langid/audio-model.js";
import { VoiceWithBackup, type OutsideVoice } from "./tts/outside.js";
import { ElevenLine, toolKeyFor } from "./eleven/agent.js";

export const RELAY_PATH = "/relay";
export const LISTEN_PATH = "/listen";
export const S2S_PATH = "/s2s/media";
export const AZURE_PATH = "/azure/media";

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
  const openAi = openAiAuthFromConfig(cfg);
  // ElevenLabs phone agent test line: the agent is created or updated as soon as the server starts.
  const toolSecret = cfg.twilioAuthToken || cfg.agentApiKey;
  const eleven =
    cfg.elevenAgentApiKey && cfg.publicBaseUrl
      ? new ElevenLine(
          deps,
          {
            apiKey: cfg.elevenAgentApiKey,
            apiBase: cfg.elevenLabsApiBase,
            publicBaseUrl: cfg.publicBaseUrl,
            llm: cfg.elevenAgentLlm,
            cantoneseCode: cfg.elevenAgentCantoneseCode,
            englishModel: cfg.elevenAgentEnglishModel,
            mandarinModel: cfg.elevenAgentMandarinModel,
            detectionOnlyAtStart: cfg.elevenDetectOnlyAtStart,
            silenceHangupSecs: cfg.elevenSilenceHangupSecs,
            toolKey: toolKeyFor(toolSecret),
          },
          toolSecret,
        )
      : null;
  eleven?.ready().catch(() => {}); // logged inside; retried on the first call
  const openAiLine = openAi.mode() !== "none" ? openAiProvider(cfg, openAi) : null;
  const minimax = cfg.minimaxApiKey
    ? new MiniMaxSpeech({
        apiKey: cfg.minimaxApiKey,
        baseUrl: cfg.minimaxBaseUrl,
        groupId: cfg.minimaxGroupId,
        model: cfg.minimaxModel,
        voices: cfg.minimaxVoices,
        speed: cfg.minimaxSpeed,
      })
    : null;
  // Mandarin and Cantonese on the Azure line: the ElevenLabs English voice by default, so callers
  // hear the same voice in every language; MiniMax or Azure's own voices if chosen (CHINESE_VOICE).
  // The same voice and model the ElevenLabs agent speaks each language with: that language's own
  // ElevenLabs voice (CR_<LANG>_VOICE) if it has one, else the English voice.
  const agentVoice = (l: LanguageCode) => [deps.languages[l].voice, deps.languages["en-US"].voice].map((v) => v.split("-")[0]).find(looksLikeElevenLabsVoice);
  const elevenVoices = Object.fromEntries(cfg.minimaxLanguages.map((l) => [l, cfg.elevenChineseVoice || agentVoice(l)]).filter(([, v]) => v));
  const elevenVoice =
    cfg.elevenTtsApiKey && Object.keys(elevenVoices).length === cfg.minimaxLanguages.length
      ? new ElevenSpeech({
          apiKey: cfg.elevenTtsApiKey,
          apiBase: cfg.elevenLabsApiBase,
          voices: elevenVoices,
          models: { "zh-CN": cfg.elevenChineseModel, "zh-HK": "eleven_v4_turbo", "ko-KR": cfg.elevenChineseModel, "en-US": cfg.elevenAgentEnglishModel },
          latency: cfg.elevenAgentLatency,
        })
      : null;
  const choice = cfg.chineseVoice || (elevenVoice ? "elevenlabs" : minimax ? "minimax" : "azure");
  // ElevenLabs with MiniMax as its backup when both are set up.
  const outside: OutsideVoice | null =
    choice === "elevenlabs" ? (elevenVoice && minimax ? new VoiceWithBackup(elevenVoice, minimax) : elevenVoice) : choice === "minimax" ? minimax : null;
  if (choice === "elevenlabs" && !elevenVoice) console.warn("CHINESE_VOICE=elevenlabs needs ELEVENLABS_API_KEY and an ElevenLabs voice id (CR_EN_US_VOICE or ELEVENLABS_CHINESE_VOICE); using Azure's voices");
  if (choice === "minimax" && !minimax) console.warn("CHINESE_VOICE=minimax needs MINIMAX_API_KEY; using Azure's voices");
  if (outside && minimax && choice !== "azure") minimax.checkVoices(cfg.minimaxLanguages).catch((e) => console.warn(`MiniMax voice check skipped: ${(e as Error).message}`));
  if (cfg.azureVoiceLiveEndpoint && cfg.azureVoiceLiveKey) {
    console.log(`  Azure line voices for ${cfg.minimaxLanguages.join(", ")}: ${outside ? `${outside.label} (${cfg.minimaxLanguages.map((l) => outside.voiceFor(l)).join(", ")})` : "Azure's own"}`);
  }
  const azureLine = cfg.azureVoiceLiveEndpoint && cfg.azureVoiceLiveKey ? azureProvider(cfg, outside) : null;
  // Hears each caller sentence on the Azure line and names its language (Cantonese vs Mandarin by ear).
  const audioLanguageId =
    azureLine && openAi.mode() !== "none" && cfg.languageIdModels.length
      ? new AudioLanguageId({ auth: openAi, apiBase: cfg.openAiApiBase, models: cfg.languageIdModels })
      : null;
  if (azureLine) console.log(`  Azure line language check: ${audioLanguageId ? `OpenAI ${cfg.languageIdModels.join(" or ")}, every caller sentence` : "off (needs OpenAI access; LANGUAGE_ID_MODEL)"}`);
  /** Speech-to-speech calls that failed, so /s2s/after can apologize instead of hanging up silently. */
  const s2sFailed = new Map<string, number>();
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

  // Speech-to-speech test lines: point a Twilio number's "A call comes in" at /s2s/twiml (OpenAI
  // Realtime, needs OPENAI_API_KEY or workload identity) or /azure/twiml (Azure Voice Live, needs
  // AZURE_VOICELIVE_ENDPOINT and AZURE_VOICELIVE_API_KEY) to compare them with the main line.
  const realtimeTwiml = (tag: string, provider: RealtimeProvider | null, mediaPath: string, warm?: () => void) =>
    async (req: Request, res: Response, looked?: { language: LanguageCode; known: boolean }) => {
      if (!provider) {
        console.warn(`[${tag}] a call came in, but this line is not set up`);
        res.type("text/xml").send(new twilio.twiml.VoiceResponse().say("This test line is not set up yet.").toString());
        return;
      }
      warm?.();
      const { language, known } = looked ?? (await deps.callers.openingLanguage(req.body?.From, cfg.openingLookupTimeoutMs));
      const callSid = String(req.body?.CallSid ?? "");
      console.log(`[${tag} call ${callSid || "?"}] incoming from ${maskPhone(req.body?.From)}: opening in ${language}`);
      res.type("text/xml").send(
        s2sTwiml({
          wsUrl: publicBase(cfg, req).replace(/^http/, "ws") + mediaPath,
          token: tokenSecret ? relayToken(tokenSecret, callSid) : "dev",
          from: req.body?.From ? String(req.body.From) : undefined,
          to: req.body?.To ? String(req.body.To) : undefined,
          startLanguage: language,
          opening: known ? "returning" : "welcome",
          afterUrl: `${publicBase(cfg, req)}/s2s/after`,
        }),
      );
    };
  // Log in to OpenAI when the call comes in (cached after the first call), so the stream connects at once.
  const openAiTwiml = realtimeTwiml("s2s", openAiLine, S2S_PATH, () =>
    void openAi.bearer().catch((err) => console.error(`[s2s] OpenAI login failed: ${(err as Error).message}`)),
  );
  app.post("/s2s/twiml", verify, (req, res) => openAiTwiml(req, res));
  const azureTwiml = realtimeTwiml("azure", azureLine, AZURE_PATH);
  app.post("/azure/twiml", verify, (req, res) => azureTwiml(req, res));

  // The stream ended: apologize if the call failed (OpenAI login or session), then hang up.
  app.post("/s2s/after", verify, (req, res) => {
    const callSid = String(req.body?.CallSid ?? "");
    const failed = s2sFailed.delete(callSid);
    res.type("text/xml").send(s2sAfterTwiml(failed));
  });

  // ElevenLabs phone agent test line: point a Twilio number's "A call comes in" here.
  const elevenTwiml = async (req: Request, res: Response) => {
    const sorry = (msg: string) => {
      const vr = new twilio.twiml.VoiceResponse();
      vr.say(msg);
      vr.hangup();
      res.type("text/xml").send(vr.toString());
    };
    if (!eleven) {
      console.warn("[eleven] a call came in, but the ElevenLabs agent is off (needs ELEVENLABS_API_KEY and the public URL)");
      return sorry("This test line is not set up yet.");
    }
    const callSid = String(req.body?.CallSid ?? "");
    console.log(`[eleven call ${callSid || "?"}] incoming from ${maskPhone(req.body?.From)}`);
    try {
      const twiml = await eleven.register({ callSid, from: String(req.body?.From ?? ""), to: String(req.body?.To ?? "") });
      res.type("text/xml").send(twiml);
    } catch (err) {
      console.error(`[eleven call ${callSid}] could not start: ${(err as Error).message}`);
      sorry("Sorry, this test line is not working right now. Please try again later.");
    }
  };
  app.post("/eleven/twiml", verify, elevenTwiml);

  // One number for everyone: callers saved as Cantonese go to the Azure line (proper Cantonese
  // voice), and Mandarin callers too when MiniMax speaks Mandarin there; everyone else to the
  // ElevenLabs agent (best English voice). A new caller
  // who speaks Cantonese is saved as Cantonese during the call (set_language) and routed to Azure
  // from their next call. Without one of the two lines, the other takes every call.
  app.post("/route/twiml", verify, async (req, res) => {
    const looked = await deps.callers.openingLanguage(req.body?.From, cfg.openingLookupTimeoutMs);
    // Mandarin too when MiniMax speaks Mandarin on the Azure line.
    const mandarinOnAzure = looked.language === "zh-CN" && !!azureLine?.speaksExternally?.("zh-CN");
    const toAzure = !!azureLine && (looked.language === "zh-HK" || mandarinOnAzure || !eleven);
    console.log(`[route call ${String(req.body?.CallSid ?? "?")}] ${maskPhone(req.body?.From)} saved as ${looked.language}: ${toAzure ? "Azure" : "ElevenLabs"}`);
    if (toAzure) return azureTwiml(req, res, looked);
    return elevenTwiml(req, res);
  });

  // Booking tools for the ElevenLabs agent (its webhook tools), with the same code as the main line.
  app.post("/eleven/tools/:name", express.json({ limit: "64kb" }), async (req, res) => {
    if (!eleven) return void res.status(404).json({ error: "off" });
    const out = await eleven.runTool(req.params.name, { key: req.header("x-cf-tool-key") }, req.body ?? {});
    res.status(out.status).json(out.body);
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
    const realtime = url.pathname === S2S_PATH ? openAiLine : url.pathname === AZURE_PATH ? azureLine : null;
    if (realtime) {
      wss.handleUpgrade(req, socket, head, (ws) =>
        void handleS2sSocket(ws, deps, {
          tokenSecret,
          provider: realtime,
          audioLanguageId: realtime === azureLine ? audioLanguageId : null,
          onFailure: (sid) => {
            const cutoff = Date.now() - 600_000;
            for (const [k, t] of s2sFailed) if (t < cutoff) s2sFailed.delete(k);
            if (sid) s2sFailed.set(sid, Date.now());
          },
        }),
      );
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
