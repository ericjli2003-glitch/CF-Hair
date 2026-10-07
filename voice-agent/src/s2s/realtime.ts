import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import WebSocket from "ws";
import type { SessionDeps } from "../agent/session.js";
import { CallLog } from "../agent/calllog.js";
import { callContext, staticSystemPrompt } from "../agent/prompt.js";
import { DEFAULT_PREFETCH, prefetchOpenings } from "../agent/prefetch.js";
import { TOOL_DEFINITIONS, ToolExecutor, type Outcome, type ToolHooks } from "../agent/tools.js";
import type { CallerInfo } from "../callers.js";
import { ApiUnavailableError } from "../api/types.js";
import { DEFAULT_LANGUAGE, normalizeLanguage, type LanguageCode } from "../languages.js";
import { isAnonymousCaller, toE164 } from "../phone.js";
import { verifyRelayToken } from "../relay/twiml.js";
import type { OpenAiAuth } from "./openai-auth.js";

/**
 * Speech-to-speech test line: the caller's audio goes straight to OpenAI's Realtime API, which
 * listens, thinks and speaks in one model, instead of Twilio speech recognition, Claude and a
 * text-to-speech voice. Same salon prompt, same booking tools and the same "never book in the
 * reply that is still asking" rule, so the two lines can be compared side by side.
 *
 * Twilio side: <Connect><Stream> (bidirectional Media Streams). Messages in: connected, start
 * {streamSid, callSid, customParameters}, media {payload, timestamp}, mark {name}, stop.
 * Out: media {payload}, mark {name}, clear.
 *
 * OpenAI side (GA Realtime API, from the official openai SDK types): wss://api.openai.com/v1/realtime
 * ?model=..., header Authorization: Bearer. Audio is G.711 mu-law both ways (audio/pcmu), so Twilio's
 * audio passes through untouched.
 */

/** Tools that act on the caller's behalf, so they must not run in the reply that is still asking. */
const WAITS_FOR_ANSWER = new Set(["book_appointment", "reschedule_booking", "cancel_booking", "end_call"]);

/** Left out on this line: language is heard directly, transfers and the SMS question are not part of the test. */
const SKIPPED_TOOLS = new Set(["ask_caller_language", "record_sms_consent", "transfer_to_human"]);

export function realtimeTools() {
  return TOOL_DEFINITIONS.filter((t) => !SKIPPED_TOOLS.has(t.name)).map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

/** Overrides for the parts of the shared prompt that describe the Claude line's phone system. */
function s2sNote(deps: SessionDeps): string {
  const l = deps.languages;
  return `# This call: speech to speech
You hear the caller's voice directly and speak with your own voice. There is no transcript, no speech recognition and no separate text to speech, so ignore the parts above about transcripts, the phone system switching languages, and ask_caller_language.
- Accents: listen for what the caller most likely means in a salon call, as described above.
- Language: answer in the language the caller speaks (English, Mandarin, Cantonese or Korean). When the caller speaks Mandarin, Cantonese or Korean, or asks for one, switch to it at once and also call set_language once so it is remembered for their next call. Cantonese means spoken Cantonese, not Mandarin.
- Speak fast and short, like a busy front desk. Never more than one short sentence.
- Live transfer is not available on this line; offer to take a message instead.
- Goodbyes: in this mode nobody adds a "bye" for you. When the call is done, say a short goodbye ending with "${l["en-US"].byes}" (Mandarin or Cantonese: "${l["zh-CN"].byes}", Korean: "${l["ko-KR"].byes}") and call end_call in the same reply.`;
}

interface SentChunk {
  /** Caller audio sent to OpenAI so far, in ms, at the end of this chunk. */
  audioMs: number;
  /** When it arrived from Twilio. */
  at: number;
}

interface ResponseState {
  id: string;
  text: string;
  tools: Promise<void>[];
  toolNames: string[];
  /** A tool result the model has to speak about, so a new response is needed. */
  followUp: boolean;
  firstAudioAt: number;
}

export interface S2sOptions {
  tokenSecret: string;
  auth: OpenAiAuth;
  /** For tests: how long to wait for the final playback mark before hanging up anyway. */
  hangupFallbackMs?: number;
}

export function handleS2sSocket(twilioWs: WebSocket, deps: SessionDeps, opts: S2sOptions): RealtimeCall {
  return new RealtimeCall(twilioWs, deps, opts);
}

export class RealtimeCall {
  private readonly cfg: SessionDeps["config"];
  private readonly now: () => DateTime;
  private oai: WebSocket | null = null;
  private oaiOpen = false;
  /** Caller details and openings once loaded (the first instructions go out without them). */
  private context: { caller: CallerInfo | null; openings: string | null } = { caller: null, openings: null };
  private streamSid = "";
  callSid = "";
  private from: string | null = null;
  private to: string | null = null;
  language: LanguageCode = DEFAULT_LANGUAGE;
  private languageSource: "default" | "saved" | "detected" = "default";
  private greeting = "";
  private caller: CallerInfo | null = null;
  log: CallLog | null = null;
  private executor: ToolExecutor | null = null;
  private audioQueue: { payload: string; at: number }[] = [];
  private audioMs = 0;
  private sent: SentChunk[] = [];
  private configured = false;
  /** The first response is the greeting; its transcript was logged when it was requested. */
  private greetingResponseId: string | null = null;
  private closed = false;

  // Playback, for barge-in and hang-up.
  private latestMediaTs = 0;
  private responseStartTs: number | null = null;
  private lastAssistantItem: string | null = null;
  private marksOutstanding = 0;

  // Timing: when the caller stopped talking, by the audio clock and by when VAD said so.
  private callerStoppedAt = 0;
  private turnDetectedAt = 0;
  private responses = new Map<string, ResponseState>();
  private pendingEnd: string | null = null;
  private hangupTimer: NodeJS.Timeout | null = null;
  private callerTurns = 0;
  private lastCallerText = "";
  /** Resolves when the Calls record has been posted or queued (tests). */
  reported: Promise<void> = Promise.resolve();

  constructor(
    private readonly twilio: WebSocket,
    private readonly deps: SessionDeps,
    private readonly opts: S2sOptions,
  ) {
    this.cfg = deps.config;
    this.now = deps.now ?? (() => DateTime.now());
    // Connect to OpenAI right away, while Twilio is still sending its start message.
    void this.connect();
    twilio.on("message", (raw) => this.onTwilio(raw.toString()));
    twilio.on("close", () => void this.close("caller"));
    twilio.on("error", (err) => this.tag(`Twilio socket error: ${err.message}`, "error"));
  }

  private async connect() {
    let bearer: string;
    try {
      bearer = await this.opts.auth.bearer();
    } catch (err) {
      this.tag(`OpenAI login failed: ${(err as Error).message}`, "error");
      this.hangUp();
      return;
    }
    if (this.closed) return;
    const url = `${this.cfg.realtimeUrl}?model=${encodeURIComponent(this.cfg.realtimeModel)}`;
    const oai = new WebSocket(url, { headers: { Authorization: `Bearer ${bearer}` } });
    this.oai = oai;
    oai.on("open", () => {
      this.oaiOpen = true;
      this.configure();
    });
    oai.on("message", (raw) => this.onOpenAi(raw.toString()));
    oai.on("error", (err) => this.tag(`OpenAI socket error: ${err.message}`, "error"));
    oai.on("close", (code, reason) => {
      if (!this.closed) {
        this.tag(`OpenAI closed the session (${code} ${reason.toString()})`, "error");
        this.hangUp();
      }
    });
  }

  private tag(msg: string, level: "log" | "warn" | "error" = "log") {
    console[level](`[s2s call ${this.callSid || "?"}] ${msg}`);
    if (level === "error") this.log?.record.errors.push(msg);
  }

  // ---------------------------------------------------------------- Twilio

  private onTwilio(raw: string) {
    let m: {
      event?: string;
      streamSid?: string;
      start?: { streamSid?: string; callSid?: string; customParameters?: Record<string, string> };
      media?: { payload?: string; timestamp?: string | number };
      mark?: { name?: string };
    };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.event) {
      case "start":
        return this.onStart(m.start ?? {}, m.streamSid);
      case "media": {
        if (!this.log || !m.media?.payload) return;
        this.latestMediaTs = Number(m.media.timestamp ?? this.latestMediaTs) || this.latestMediaTs;
        const chunk = { payload: m.media.payload, at: Date.now() };
        if (this.configured && this.oaiOpen) this.sendAudio(chunk);
        else if (this.audioQueue.length < 250) this.audioQueue.push(chunk); // about 5 s
        return;
      }
      case "mark":
        if (this.marksOutstanding > 0) this.marksOutstanding--;
        if (m.mark?.name === "end") this.hangUp();
        return;
      case "stop":
        void this.close("caller");
        return;
    }
  }

  private onStart(start: { streamSid?: string; callSid?: string; customParameters?: Record<string, string> }, sid?: string) {
    const p = start.customParameters ?? {};
    this.callSid = start.callSid ?? "";
    this.streamSid = start.streamSid ?? sid ?? "";
    if (this.opts.tokenSecret && !verifyRelayToken(this.opts.tokenSecret, this.callSid, p.token)) {
      this.tag("rejected stream: bad or missing token", "warn");
      this.closed = true;
      this.oai?.close();
      this.twilio.close(1008, "unauthorized");
      return;
    }
    this.from = p.from || null;
    this.to = p.to || null;
    const lang = normalizeLanguage(p.startLanguage);
    if (lang && lang !== DEFAULT_LANGUAGE) {
      this.language = lang;
      this.languageSource = "saved";
    }
    this.greeting = p.opening === "returning" ? this.deps.languages[this.language].greeting : this.cfg.welcomeGreeting;
    this.log = new CallLog(this.cfg.logDir, {
      callSid: this.callSid,
      from: this.from,
      to: this.to,
      anonymous: isAnonymousCaller(this.from),
      model: `openai:${this.cfg.realtimeModel}`,
    });
    if (this.languageSource === "saved") {
      this.log.record.languages.push({ at: new Date().toISOString(), language: this.language, reason: "saved preference (call opened in it)" });
    }
    this.executor = new ToolExecutor(this.deps.api, this.deps.salon, this.hooks());
    this.tag(`stream started (${this.cfg.realtimeModel}, voice ${this.cfg.realtimeVoice}), opening in ${this.language}`);
    this.configure();
    void this.loadContext();
  }

  private sendTwilio(msg: Record<string, unknown>) {
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify({ ...msg, streamSid: this.streamSid }));
  }

  /** Ends the stream; Twilio then runs the next TwiML verb, <Hangup/>. */
  private hangUp() {
    if (this.hangupTimer) clearTimeout(this.hangupTimer);
    this.hangupTimer = null;
    if (this.log && !this.log.record.endedBy) this.log.record.endedBy = "agent";
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.close();
    void this.close("agent");
  }

  // ---------------------------------------------------------------- OpenAI

  private sendOai(msg: Record<string, unknown>) {
    if (this.oai?.readyState === WebSocket.OPEN) this.oai.send(JSON.stringify(msg));
  }

  private sendAudio(chunk: { payload: string; at: number }) {
    this.sendOai({ type: "input_audio_buffer.append", audio: chunk.payload });
    // mu-law at 8 kHz: one byte per sample, 8 bytes per ms.
    this.audioMs += Buffer.byteLength(chunk.payload, "base64") / 8;
    this.sent.push({ audioMs: this.audioMs, at: chunk.at });
    if (this.sent.length > 3000) this.sent.splice(0, 1000); // about a minute of history is plenty
  }

  /** When the caller audio up to `audioMs` arrived from Twilio. */
  private wallTimeAt(audioMs: number): number {
    for (const c of this.sent) if (c.audioMs >= audioMs) return c.at;
    return Date.now();
  }

  private instructions(extra: { caller: CallerInfo | null; openings: string | null }): string {
    const c = extra.caller;
    const context = callContext({
      salon: this.deps.salon,
      now: this.now(),
      callerPhone: c?.phone ?? (isAnonymousCaller(this.from) ? null : toE164(this.from)),
      callerAnonymous: c ? c.anonymous : isAnonymousCaller(this.from),
      callerName: c?.name ?? null,
      callCount: c?.callCount ?? 0,
      preferredLanguage: c?.preferredLanguage ?? this.language,
      currentLanguage: this.deps.languages[this.language],
      greeting: this.greeting,
      openedInSavedLanguage: this.languageSource === "saved",
      spokenAfterGreeting: null,
      transferAvailable: false,
      bookingWebsiteSpoken: this.cfg.bookingWebsiteSpoken,
      openings: extra.openings,
    });
    const base = this.deps.staticPrompt ?? staticSystemPrompt(this.deps.salon);
    return `${base}\n\n${s2sNote(this.deps)}\n\n${context}`;
  }

  /** Sends the session settings once both sockets are ready, then has the model say the greeting. */
  private configure() {
    if (this.configured || !this.oaiOpen || !this.log) return;
    this.configured = true;
    const reasoning = /^gpt-realtime-2/.test(this.cfg.realtimeModel) && this.cfg.realtimeReasoning !== "off";
    const transcribe = this.cfg.realtimeTranscribeModel !== "off";
    this.sendOai({
      type: "session.update",
      session: {
        type: "realtime",
        model: this.cfg.realtimeModel,
        output_modalities: ["audio"],
        instructions: this.instructions(this.context),
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: this.cfg.realtimeSilenceMs,
              create_response: true,
              interrupt_response: true,
            },
            ...(transcribe ? { transcription: { model: this.cfg.realtimeTranscribeModel } } : {}),
          },
          output: { format: { type: "audio/pcmu" }, voice: this.cfg.realtimeVoice },
        },
        tools: realtimeTools(),
        tool_choice: "auto",
        ...(reasoning ? { reasoning: { effort: this.cfg.realtimeReasoning } } : {}),
      },
    });
    for (const chunk of this.audioQueue) this.sendAudio(chunk);
    this.audioQueue = [];
    // The greeting, word for word, in the voice used for the rest of the call.
    this.sendOai({
      type: "response.create",
      response: { instructions: `Say exactly this greeting and nothing else: "${this.greeting}"`, tool_choice: "none" },
    });
    this.log.say("agent", this.greeting, { lang: this.language });
  }

  /** Caller lookup and openings load while the greeting plays, then the instructions are updated. */
  private async loadContext() {
    const t0 = Date.now();
    const ids = this.cfg.prefetchServiceIds;
    const [caller, openings] = await Promise.all([
      this.deps.callers.beginCall(this.from),
      ids.length ? prefetchOpenings(this.deps.api, this.deps.salon, this.now(), { ...DEFAULT_PREFETCH, serviceIds: ids }).catch(() => null) : null,
    ]);
    this.caller = caller;
    this.context = { caller, openings };
    if (this.closed) return;
    this.tag(`caller and openings loaded in ${Date.now() - t0}ms`);
    // Not configured yet: configure() sends these instructions itself.
    if (this.configured) this.sendOai({ type: "session.update", session: { type: "realtime", instructions: this.instructions(this.context) } });
  }

  private response(id: string): ResponseState {
    let r = this.responses.get(id);
    if (!r) {
      r = { id, text: "", tools: [], toolNames: [], followUp: false, firstAudioAt: 0 };
      this.responses.set(id, r);
    }
    return r;
  }

  private onOpenAi(raw: string) {
    let e: any;
    try {
      e = JSON.parse(raw);
    } catch {
      return;
    }
    switch (e.type) {
      case "error":
        this.tag(`OpenAI error: ${e.error?.code ?? ""} ${e.error?.message ?? ""} ${e.error?.param ? `(param ${e.error.param})` : ""}`.trim(), "error");
        return;
      case "response.created":
        this.greetingResponseId ??= e.response?.id ?? null;
        return;
      case "input_audio_buffer.speech_started":
        return this.onBargeIn();
      case "input_audio_buffer.speech_stopped":
        this.callerTurns++;
        this.turnDetectedAt = Date.now();
        this.callerStoppedAt = typeof e.audio_end_ms === "number" ? this.wallTimeAt(e.audio_end_ms) : this.turnDetectedAt;
        return;
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(e.transcript ?? "").trim();
        if (!text) return;
        this.lastCallerText = text;
        this.log?.say("caller", text);
        if (this.cfg.logTranscripts) this.tag(`heard: "${text}"`);
        return;
      }
      case "response.output_audio.delta": {
        const r = this.response(e.response_id);
        if (!r.firstAudioAt) {
          r.firstAudioAt = Date.now();
          if (this.callerStoppedAt) {
            const fromSpeech = (r.firstAudioAt - this.callerStoppedAt) / 1000;
            const fromTurn = (r.firstAudioAt - this.turnDetectedAt) / 1000;
            this.tag(`reply: first audio ${fromSpeech.toFixed(2)}s after the caller stopped talking (${fromTurn.toFixed(2)}s after the turn was detected)`);
            this.callerStoppedAt = 0;
          }
        }
        if (this.lastAssistantItem !== e.item_id) {
          this.lastAssistantItem = e.item_id;
          this.responseStartTs = this.latestMediaTs;
        }
        this.sendTwilio({ event: "media", media: { payload: e.delta } });
        this.sendTwilio({ event: "mark", mark: { name: "audio" } });
        this.marksOutstanding++;
        return;
      }
      case "response.output_audio_transcript.delta":
        this.response(e.response_id).text += e.delta ?? "";
        return;
      case "response.output_audio_transcript.done": {
        const text = String(e.transcript ?? "").trim();
        if (text && e.response_id !== this.greetingResponseId) {
          this.log?.say("agent", text, { lang: this.language });
          if (this.cfg.logTranscripts) this.tag(`said: "${text}"`);
        }
        return;
      }
      case "response.function_call_arguments.done":
        return this.onToolCall(e);
      case "response.done":
        void this.onResponseDone(e.response ?? {});
        return;
    }
  }

  /** The caller started talking: stop what is playing and keep only what they heard. */
  private onBargeIn() {
    this.cancelPendingEnd();
    if (this.marksOutstanding > 0 && this.lastAssistantItem && this.responseStartTs !== null) {
      const heardMs = Math.max(0, this.latestMediaTs - this.responseStartTs);
      this.sendOai({ type: "conversation.item.truncate", item_id: this.lastAssistantItem, content_index: 0, audio_end_ms: heardMs });
      this.sendTwilio({ event: "clear" });
      this.log?.trimLastAgentLine("(cut off by the caller)");
    }
    this.marksOutstanding = 0;
    this.lastAssistantItem = null;
    this.responseStartTs = null;
  }

  private onToolCall(e: { response_id: string; call_id: string; name: string; arguments: string }) {
    const r = this.response(e.response_id);
    r.toolNames.push(e.name);
    const t0 = Date.now();
    let input: unknown = {};
    try {
      input = JSON.parse(e.arguments || "{}");
    } catch {
      /* validated below */
    }
    const job = (async () => {
      let content: string;
      let isError = false;
      const asking = /[?？]\s*$/.test(r.text.trim());
      if (WAITS_FOR_ANSWER.has(e.name) && asking) {
        // Same rule as the Claude line: the reply that asks a question cannot also act on the answer.
        content = JSON.stringify({
          error: "REFUSED_WAIT_FOR_ANSWER",
          instruction: "You just asked the caller a question in this same reply. Stop and wait for their answer; do not call this again until they reply.",
        });
        isError = true;
        this.tag(`refused ${e.name}: the same reply ended with a question`);
      } else {
        const res = await this.executor!.run(e.name, input);
        content = res.content;
        isError = res.isError;
        // end_call needs nothing more; everything else is spoken about.
        if (e.name !== "end_call") r.followUp = true;
      }
      this.log?.tool({ name: e.name, input, result: safeJson(content), isError, ms: Date.now() - t0 });
      this.sendOai({ type: "conversation.item.create", item: { type: "function_call_output", call_id: e.call_id, output: content } });
    })().catch((err) => this.tag(`tool ${e.name} failed: ${(err as Error).message}`, "error"));
    r.tools.push(job);
  }

  private async onResponseDone(resp: { id?: string; status?: string; usage?: { input_tokens?: number; output_tokens?: number; input_token_details?: { cached_tokens?: number } } }) {
    const r = this.response(resp.id ?? "");
    await Promise.all(r.tools);
    this.responses.delete(r.id);
    if (resp.usage && this.log) {
      this.log.addUsage({
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
        cache_read_input_tokens: resp.usage.input_token_details?.cached_tokens,
      });
    }
    if (r.toolNames.length) this.tag(`tools: ${r.toolNames.join(", ")}${r.firstAudioAt ? "" : " (no audio before the tools)"}`);
    if (this.closed) return;
    if (r.followUp) {
      this.sendOai({ type: "response.create" });
      return;
    }
    if (this.pendingEnd && resp.status !== "cancelled") {
      // Hang up once everything already sent has played.
      this.sendTwilio({ event: "mark", mark: { name: "end" } });
      this.hangupTimer = setTimeout(() => this.hangUp(), this.opts.hangupFallbackMs ?? 15_000);
      this.hangupTimer.unref?.();
    }
  }

  private cancelPendingEnd() {
    if (!this.pendingEnd) return;
    this.pendingEnd = null;
    if (this.hangupTimer) clearTimeout(this.hangupTimer);
    this.hangupTimer = null;
  }

  // ---------------------------------------------------------------- tools

  private hooks(): ToolHooks {
    return {
      callSid: this.callSid,
      callerPhone: isAnonymousCaller(this.from) ? null : toE164(this.from),
      currentLanguage: () => this.language,
      switchLanguage: async (code) => {
        if (code !== this.language) {
          this.language = code;
          this.languageSource = "detected";
          this.log?.record.languages.push({ at: new Date().toISOString(), language: code, reason: "set_language (speech to speech)" });
          this.tag(`language now ${code}`);
        }
        const saved = await this.deps.callers.saveLanguage(this.caller?.phone ?? toE164(this.from) ?? null, code);
        return { saved };
      },
      requestEnd: (reason) => {
        this.pendingEnd = reason;
        if (this.log) this.log.record.endReason = reason;
      },
      requestTransfer: () => ({ ok: false, why: "Live transfer is not available on this line. Offer to take a message." }),
      recordOutcome: (outcome: Outcome, detail) => {
        this.log?.record.outcomes.push({ outcome, at: new Date().toISOString(), detail });
      },
      rememberName: (name) => void this.deps.callers.saveName(this.caller?.phone ?? null, name),
      sendMessage: (m) => this.postMessage(m),
      now: () => this.now(),
    };
  }

  private async postMessage(m: { callerName: string; phone: string; message: string; urgency: "low" | "normal" | "high" }) {
    try {
      const res = (await this.deps.api.postMessage(m)) as { id?: unknown; message?: { id?: unknown } } | undefined;
      const id = res?.message?.id ?? res?.id;
      if (id !== undefined && id !== null && this.log) this.log.record.messageId = String(id);
      return "sent" as const;
    } catch (err) {
      try {
        fs.mkdirSync(this.cfg.dataDir, { recursive: true });
        fs.appendFileSync(
          path.join(this.cfg.dataDir, "pending-messages.jsonl"),
          JSON.stringify({ ...m, queuedAt: new Date().toISOString(), error: (err as Error).message }) + "\n",
        );
      } catch {
        /* ignore */
      }
      this.log?.record.errors.push(`postMessage failed: ${(err as Error).message}`);
      if (!(err instanceof ApiUnavailableError)) this.tag(`message POST failed: ${(err as Error).message}`, "warn");
      return "queued" as const;
    }
  }

  // ---------------------------------------------------------------- end

  async close(endedBy: "caller" | "agent"): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.hangupTimer) clearTimeout(this.hangupTimer);
    if (this.oai?.readyState === WebSocket.OPEN || this.oai?.readyState === WebSocket.CONNECTING) this.oai.close();
    if (!this.log) return;
    await Promise.all([...this.responses.values()].flatMap((r) => r.tools));
    const rec = this.log.record;
    rec.endedAt = new Date().toISOString();
    rec.endedBy = rec.endedBy ?? endedBy;
    const seen = new Set(rec.outcomes.map((o) => o.outcome));
    rec.outcome = (["booked", "rescheduled", "cancelled", "message"] as Outcome[]).find((o) => seen.has(o)) ?? (this.callerTurns === 0 ? "abandoned" : "info-only");
    if (this.deps.reporter) {
      this.reported = this.deps.reporter
        .submit({ record: rec, language: this.language, languageSource: this.languageSource, timezone: this.deps.salon.timezone })
        .catch((err) => this.tag(`call report failed: ${(err as Error).message}`, "error"));
    }
    try {
      const file = this.log.write();
      this.tag(`ended: ${rec.outcome} (log ${file})`);
    } catch (err) {
      this.tag(`failed to write log: ${(err as Error).message}`, "error");
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
