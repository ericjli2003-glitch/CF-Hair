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
import { analyzeUtterance, chineseSwitchOk, chineseVariant } from "../agent/langdetect.js";
import { isModelUnavailable, isSetupRejected, type RealtimeProvider } from "./providers.js";
import { SentenceChunker } from "../agent/chunker.js";

/**
 * Speech-to-speech test lines: the caller's audio goes straight to a realtime voice service (OpenAI's
 * Realtime API, or Azure Voice Live with Azure neural voices; see providers.ts), which listens,
 * thinks and speaks, instead of Twilio speech recognition, Claude and a text-to-speech voice. Same salon prompt, same booking tools and the same "never book in the
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
function s2sNote(deps: SessionDeps, provider: RealtimeProvider): string {
  const l = deps.languages;
  return `# This call: speech to speech
You hear the caller's voice directly and speak with your own voice. There is no transcript, no speech recognition and no separate text to speech, so ignore the parts above about transcripts, the phone system switching languages, and ask_caller_language.
- Accents: listen for what the caller most likely means in a salon call, as described above.
- Language: answer in the language the caller speaks (English, Mandarin, Cantonese or Korean). When the caller speaks Mandarin, Cantonese or Korean, or asks for one, switch to it at once and also call set_language once so it is remembered for their next call. Cantonese means spoken Cantonese, not Mandarin.
- Keep replies short (one short sentence), but say them like a real person at the front desk, not a recording.

# Voice and delivery
- Warm, relaxed and friendly, with a smile in your voice. Natural rhythm and intonation that rises and falls, like chatting with a regular client.
- Conversational, not formal: contractions ("you're", "that's"), everyday words, and small natural acknowledgements such as "Sure", "Mm-hm", "Okay, great" where a person would use them, without overdoing it.
- Normal, easy pace: never rushed or clipped, never slow. Brief natural pauses between ideas. Say times and names clearly.
- Match the caller: calmer and slower for an older or hesitant caller, quicker for someone in a hurry.
- In Mandarin, Cantonese and Korean, sound like a friendly local speaker of that language, with natural phrasing, not a translation.${
    deps.config.realtimeAccent === "hong-kong"
      ? `
- You are a Hong Kong-Canadian receptionist who grew up in Hong Kong. In English, speak fluent, natural English with a light, friendly Hong Kong accent. In Cantonese, speak everyday Hong Kong Cantonese and mix in the English words Hong Kong people use, such as "book 個位", "OK 呀", "check 下", "cut 頭髮", "sorry 呀", "perm", "appointment". In Mandarin and Korean, speak normally.`
      : ""
  }
${provider.note ? `${provider.note}
` : ""}- Live transfer is not available on this line; offer to take a message instead.
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
  provider: RealtimeProvider;
  /** For tests: how long to wait for the final playback mark before hanging up anyway. */
  hangupFallbackMs?: number;
  /** Called when the call cannot go on (OpenAI login or session failed), so Twilio can apologize. */
  onFailure?: (callSid: string) => void;
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
  /** Outside-voice (MiniMax) playback per response. */
  private speaking = new Map<string, SpokenReply>();
  /** One playback line for the whole call, so replies spoken by an outside voice never overlap. */
  private readonly voiceLine: VoiceLine = { chain: Promise.resolve() };
  private outsideVoiceOff = false;
  private greetingLogged = false;
  private failed = false;
  /** Some model audio has been sent to the caller. */
  private heardAudio = false;
  /** The first response is the greeting; its transcript was logged when it was requested. */
  private greetingResponseId: string | null = null;
  /** The session settings last sent, without instructions and tools. */
  private sentSettings: Record<string, unknown> = {};
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
    const p = this.opts.provider;
    let target: { url: string; headers: Record<string, string> };
    try {
      target = await p.connect();
    } catch (err) {
      this.tag(`${p.label} login failed: ${(err as Error).message}`, "error");
      this.fail();
      return;
    }
    if (this.closed) return;
    const oai = new WebSocket(target.url, { headers: target.headers });
    this.oai = oai;
    oai.on("open", () => {
      this.oaiOpen = true;
      this.configure();
    });
    oai.on("message", (raw) => this.onOpenAi(raw.toString()));
    oai.on("error", (err) => this.tag(`${p.label} socket error: ${err.message}`, "error"));
    oai.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => this.tag(`${p.label} refused the connection: ${res.statusCode} ${body.slice(0, 300)}`, "error"));
      this.fail();
    });
    oai.on("close", (code, reason) => {
      if (!this.closed) {
        this.tag(`${p.label} closed the session (${code} ${reason.toString()})`, "error");
        this.fail();
      }
    });
  }

  /** Drop the service connection and start a new one (after switching models). */
  private reconnect() {
    const old = this.oai;
    this.oai = null;
    if (old) {
      old.removeAllListeners();
      old.on("error", () => {});
      old.close();
    }
    this.oaiOpen = false;
    this.configured = false;
    this.greetingResponseId = null;
    this.responses.clear();
    this.audioMs = 0;
    this.sent = [];
    void this.connect();
  }

  private tag(msg: string, level: "log" | "warn" | "error" = "log") {
    console[level](`[${this.opts.provider.tag} call ${this.callSid || "?"}] ${msg}`);
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
      model: `${this.opts.provider.tag === "s2s" ? "openai" : this.opts.provider.tag}:${this.opts.provider.model}`,
    });
    if (this.languageSource === "saved") {
      this.log.record.languages.push({ at: new Date().toISOString(), language: this.language, reason: "saved preference (call opened in it)" });
    }
    this.executor = new ToolExecutor(this.deps.api, this.deps.salon, this.hooks());
    this.tag(`stream started (${this.opts.provider.model}, voice ${this.opts.provider.voiceFor(this.language)}), opening in ${this.language}`);
    this.configure();
    void this.loadContext();
  }

  private sendTwilio(msg: Record<string, unknown>) {
    if (this.twilio.readyState === WebSocket.OPEN) this.twilio.send(JSON.stringify({ ...msg, streamSid: this.streamSid }));
  }

  /** Ends the stream; Twilio then runs the next TwiML verb, <Hangup/>. */
  /** The call cannot go on: Twilio apologizes (see /s2s/after) and hangs up. */
  private fail() {
    if (this.failed) return;
    this.failed = true;
    if (this.log) this.log.record.endedBy = "error";
    this.opts.onFailure?.(this.callSid);
    this.hangUp();
  }

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
    return `${base}\n\n${s2sNote(this.deps, this.opts.provider)}\n\n${context}`;
  }

  /** Sends the session settings once both sockets are ready, then has the model say the greeting. */
  private configure() {
    if (this.configured || !this.oaiOpen || !this.log) return;
    this.configured = true;
    const session = this.opts.provider.session({ instructions: this.instructions(this.context), language: this.language, tools: realtimeTools() });
    // For the log if the service refuses them: everything but the long instructions and tools.
    const { instructions: _i, tools: _t, ...rest } = (session.session ?? {}) as Record<string, unknown>;
    this.sentSettings = rest;
    this.sendOai(session);
    for (const chunk of this.audioQueue) this.sendAudio(chunk);
    this.audioQueue = [];
    // The greeting, word for word, in the voice used for the rest of the call.
    this.sendOai({
      type: "response.create",
      response: { instructions: `Say exactly this greeting and nothing else: "${this.greeting}"`, tool_choice: "none" },
    });
    if (!this.greetingLogged) this.log.say("agent", this.greeting, { lang: this.language });
    this.greetingLogged = true;
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
    if (this.configured) this.sendOai(this.opts.provider.instructions(this.instructions(this.context)));
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
        this.tag(`${this.opts.provider.label} error: ${e.error?.code ?? ""} ${e.error?.message ?? ""} ${e.error?.param ? `(param ${e.error.param})` : ""}`.trim(), "error");
        // The model is not offered here (an Azure region without it), or it refuses this call's settings:
        // try the next model in this same call.
        const unavailable = isModelUnavailable(e.error);
        if (!this.heardAudio && (unavailable || isSetupRejected(e.error)) && this.opts.provider.fallback) {
          if (!unavailable) this.tag(`settings sent: ${JSON.stringify(this.sentSettings)}`, "warn");
          const next = this.opts.provider.fallback();
          if (next) {
            const why = unavailable ? "does not offer that model here" : "could not set up the call with that model";
            this.tag(`${this.opts.provider.label} ${why}; switching to ${next} (later calls start with it)`, "warn");
            if (this.log) this.log.record.model = `${this.opts.provider.tag}:${next}`;
            this.reconnect();
            return;
          }
        }
        // Before any audio has played (bad settings, no credits) the caller would only hear silence.
        if (!this.heardAudio) this.fail();
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
        this.followCallerLanguage(text);
        return;
      }
      case "response.output_audio.delta":
      case "response.audio.delta":
        this.playAudio(e.response_id, e.item_id, e.delta);
        return;
      // Text replies for a language spoken by an outside voice (MiniMax).
      case "response.text.delta": {
        const r = this.response(e.response_id);
        r.text += e.delta ?? "";
        this.spoken(e.response_id, e.item_id).push(e.delta ?? "");
        return;
      }
      case "response.text.done": {
        this.spoken(e.response_id, e.item_id).finish();
        const text = String(e.text ?? "").trim();
        if (text && e.response_id !== this.greetingResponseId) {
          this.log?.say("agent", text, { lang: this.language });
          if (this.cfg.logTranscripts) this.tag(`said: "${text}"`);
        }
        return;
      }
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        this.response(e.response_id).text += e.delta ?? "";
        return;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
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

  /** One chunk of reply audio (base64 mu-law) to the caller, with the timing and playback marks. */
  private playAudio(responseId: string, itemId: string, payload: string) {
    const r = this.response(responseId);
    if (!r.firstAudioAt) {
      r.firstAudioAt = Date.now();
      if (this.callerStoppedAt) {
        const fromSpeech = (r.firstAudioAt - this.callerStoppedAt) / 1000;
        const fromTurn = (r.firstAudioAt - this.turnDetectedAt) / 1000;
        this.tag(`reply: first audio ${fromSpeech.toFixed(2)}s after the caller stopped talking (${fromTurn.toFixed(2)}s after the turn was detected)`);
        this.callerStoppedAt = 0;
      }
    }
    if (this.lastAssistantItem !== itemId) {
      this.lastAssistantItem = itemId;
      this.responseStartTs = this.latestMediaTs;
    }
    this.heardAudio = true;
    this.sendTwilio({ event: "media", media: { payload } });
    this.sendTwilio({ event: "mark", mark: { name: "audio" } });
    this.marksOutstanding++;
  }

  /** The outside-voice playback for a text reply, created on its first text. */
  private spoken(responseId: string, itemId: string): SpokenReply {
    let sp = this.speaking.get(responseId);
    if (!sp) {
      const speech = this.opts.provider.speech!;
      const lang = this.language;
      sp = new SpokenReply(
        this.voiceLine,
        (sentence, signal) => speech.mulaw(sentence, lang, signal),
        (chunk) => this.playAudio(responseId, itemId, chunk.toString("base64")),
        (err) => this.outsideVoiceFailed(err),
      );
      this.speaking.set(responseId, sp);
    }
    return sp;
  }

  /** MiniMax failed: switch to the service's own voice for the rest of the call and say the reply again. */
  private outsideVoiceFailed(err: Error) {
    this.tag(`MiniMax voice failed: ${err.message}; using the ${this.opts.provider.label} voice instead`, "error");
    if (this.outsideVoiceOff) return;
    this.outsideVoiceOff = true;
    this.opts.provider.forceInternal?.();
    const update = this.opts.provider.languageVoice(this.language);
    if (update) this.sendOai(update);
    this.sendOai({ type: "response.create", response: { instructions: "Say your last reply to the caller again, exactly as before." } });
  }

  /** The caller started talking: stop what is playing and keep only what they heard. */
  private onBargeIn() {
    this.cancelPendingEnd();
    for (const sp of this.speaking.values()) sp.stop();
    this.speaking.clear();
    if (this.marksOutstanding > 0 && this.lastAssistantItem && this.responseStartTs !== null) {
      const heardMs = Math.max(0, this.latestMediaTs - this.responseStartTs);
      // Only spoken audio can be truncated; a text reply (outside voice) stays as written.
      if (!this.opts.provider.speaksExternally?.(this.language)) {
        this.sendOai({ type: "conversation.item.truncate", item_id: this.lastAssistantItem, content_index: 0, audio_end_ms: heardMs });
      }
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
    // An outside voice may still be speaking this reply: hang-ups wait for it.
    await this.speaking.get(r.id)?.done();
    this.speaking.delete(r.id);
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
        if (!chineseSwitchOk(this.language, code, this.lastCallerText)) {
          this.tag(`kept ${this.language}: set_language ${code} without the caller asking for it`);
          return { saved: "skipped" as const, refused: `the caller did not ask for ${code}; speech recognition writes Cantonese and Mandarin alike` };
        }
        this.setLanguage(code, "set_language (speech to speech)");
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

  /** Language change: noted for the call log and, where each language has its own voice (Azure), the voice. */
  private setLanguage(code: LanguageCode, reason: string) {
    if (code === this.language) return;
    this.language = code;
    this.languageSource = "detected";
    this.log?.record.languages.push({ at: new Date().toISOString(), language: code, reason });
    const update = this.opts.provider.languageVoice(code);
    if (update) this.sendOai(update);
    this.tag(`language now ${code}${update ? `, voice ${this.opts.provider.voiceFor(code)}` : ""}`);
  }

  /**
   * Where the voice depends on the language (Azure), follow the caller from the transcript as a
   * backup for set_language: Chinese characters or Korean script switch the voice at once.
   */
  private followCallerLanguage(text: string) {
    if (!this.opts.provider.languageVoice(this.language)) return;
    const a = analyzeUtterance(text);
    const lang: LanguageCode | null = a.hangul > 0 ? "ko-KR" : a.han > 0 ? chineseVariant(a, null) : null;
    if (!lang || lang === this.language) return;
    // Cantonese written down by speech recognition looks like Mandarin: never switch on that alone.
    if (!chineseSwitchOk(this.language, lang, text)) return;
    this.setLanguage(lang, "heard in the caller's words");
    void this.deps.callers.saveLanguage(this.caller?.phone ?? toE164(this.from) ?? null, lang);
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

/** The call's single playback order for outside-voice audio, shared by all its replies. */
interface VoiceLine {
  chain: Promise<void>;
}

/**
 * A text reply spoken by an outside voice: sentences go to the voice as soon as the model writes
 * them (all fetched at once, played in order), so speech starts after the first few words. Replies
 * queue on the call's one VoiceLine: a reply written while the last one still streams (for example
 * after a tool call) waits its turn instead of mixing its audio into the other's.
 */
class SpokenReply {
  private readonly chunker = new SentenceChunker();
  private readonly abort = new AbortController();
  private last: Promise<void> = Promise.resolve();
  private failed = false;

  constructor(
    private readonly line: VoiceLine,
    private readonly synth: (sentence: string, signal: AbortSignal) => AsyncGenerator<Buffer>,
    private readonly play: (chunk: Buffer) => void,
    private readonly onError: (err: Error) => void,
  ) {}

  push(delta: string) {
    for (const sentence of this.chunker.push(delta)) this.enqueue(sentence);
  }

  finish() {
    const rest = this.chunker.flush();
    if (rest.trim()) this.enqueue(rest);
  }

  stop() {
    this.abort.abort();
  }

  done(): Promise<void> {
    return this.last;
  }

  private enqueue(sentence: string) {
    if (!sentence.trim()) return;
    const clip = prefetch(this.synth(sentence, this.abort.signal));
    this.last = this.line.chain = this.line.chain.then(async () => {
      if (this.abort.signal.aborted || this.failed) return;
      try {
        for await (const chunk of clip()) {
          if (this.abort.signal.aborted) return;
          this.play(chunk);
        }
      } catch (err) {
        if (this.abort.signal.aborted) return;
        this.failed = true;
        this.onError(err as Error);
      }
    });
  }
}

/** Starts reading a stream now and replays it later, so the next sentence loads while one plays. */
function prefetch(gen: AsyncGenerator<Buffer>): () => AsyncGenerator<Buffer> {
  const chunks: Buffer[] = [];
  let finished = false;
  let error: unknown = null;
  const waiter: { wake: (() => void) | null } = { wake: null };
  void (async () => {
    try {
      for await (const c of gen) {
        chunks.push(c);
        waiter.wake?.();
      }
    } catch (err) {
      error = err;
    } finally {
      finished = true;
      waiter.wake?.();
    }
  })();
  return async function* () {
    let i = 0;
    for (;;) {
      if (i < chunks.length) {
        yield chunks[i++];
        continue;
      }
      if (finished) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((r) => (waiter.wake = r));
      waiter.wake = null;
    }
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
