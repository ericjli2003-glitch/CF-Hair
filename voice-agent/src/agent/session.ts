import fs from "node:fs";
import { transferBlockReason } from "../transfer-guard.js";
import path from "node:path";
import { DateTime } from "luxon";
import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "../config.js";
import type { SalonData } from "../salon.js";
import { openStatus } from "../salon.js";
import { ApiUnavailableError, type BookingApi } from "../api/types.js";
import type { CallerInfo, CallerMemory } from "../callers.js";
import { DEFAULT_LANGUAGE, DTMF_LANGUAGES, type LanguageCode, type RelayLanguage } from "../languages.js";
import { isAnonymousCaller, toE164 } from "../phone.js";
import { SentenceChunker } from "./chunker.js";
import { CallLog } from "./calllog.js";
import {
  isAbortError,
  modelOptions,
  type ContentBlockParam,
  type LlmClient,
  type LlmMessage,
  type MessageParam,
  type StreamParams,
} from "./llm.js";
import { callContext, staticSystemPrompt } from "./prompt.js";
import { TOOL_DEFINITIONS, ToolExecutor, type Outcome, type ToolHooks } from "./tools.js";
import { smsOptInWording } from "./sms-optin.js";
import { LanguageDetector, analyzeUtterance, languageEvidence } from "./langdetect.js";
import type { CallReporter } from "../calls.js";

/** How the call's current language was chosen. */
export type LanguageSource = "default" | "saved" | "detected" | "keypad" | "asked";

/** Where the agent's words go: Twilio ConversationRelay in production, the terminal in simulate/demo. */
export interface CallChannel {
  /** Speak a chunk. `last` marks the end of the agent's reply. */
  sendText(token: string, last: boolean, lang: LanguageCode): void;
  /** Switch text-to-speech and transcription language. */
  setLanguage(code: LanguageCode): void;
  /** End the ConversationRelay session (Twilio then calls the <Connect> action URL). */
  end(handoffData: Record<string, unknown>): void;
}

export interface SessionDeps {
  config: AppConfig;
  salon: SalonData;
  api: BookingApi;
  callers: CallerMemory;
  llm: LlmClient;
  languages: Record<LanguageCode, RelayLanguage>;
  now?: () => DateTime;
  /** Pass a precomputed prompt so every call shares the exact same cached bytes. */
  staticPrompt?: string;
  /** Posts the finished call to the website's Calls tab. Optional (absent in some tests). */
  reporter?: CallReporter;
}

export interface SessionInit {
  callSid: string;
  from: string | null;
  to: string | null;
  resumeReason?: string | null;
  /** Twilio ForwardedFrom: the number that forwarded this call here, when known. */
  forwardedFrom?: string | null;
  /** Language the call opened in (the TwiML start language): the saved one for a returning caller. */
  startLanguage?: LanguageCode;
  /** The opening line ConversationRelay already played, in startLanguage. */
  greeting?: string;
}

const MAX_STEPS = 8;

const TROUBLE: Record<LanguageCode, string> = {
  "en-US": "Sorry, I'm having a little trouble on my end. Could you say that again?",
  "zh-CN": "抱歉，我这边出了点问题。可以请您再说一遍吗？",
  "zh-HK": "唔好意思，我呢邊有啲問題。可唔可以再講多次？",
  "ko-KR": "죄송합니다, 잠시 문제가 있었어요. 다시 한 번 말씀해 주시겠어요?",
};

const GIVE_UP: Record<LanguageCode, string> = {
  "en-US": "I'm sorry, I'm having technical trouble. I've let the team know, and someone will call you back. Goodbye for now.",
  "zh-CN": "非常抱歉，系统出了技术问题。我已经通知团队，稍后会有人给您回电。再见。",
  "zh-HK": "非常抱歉，系統有技術問題。我已經通知咗同事，稍後會有人覆你電話。拜拜。",
  "ko-KR": "정말 죄송합니다. 기술적인 문제가 있어서 직원에게 알렸고, 곧 다시 연락드릴게요. 안녕히 계세요.",
};

const REFUSAL: Record<LanguageCode, string> = {
  "en-US": "Sorry, I can't help with that one. Is there anything else about the salon I can help with?",
  "zh-CN": "抱歉，这个我帮不上忙。还有其他关于沙龙的问题吗？",
  "zh-HK": "唔好意思，呢樣我幫唔到你。仲有冇其他關於髮型屋嘅嘢可以幫你？",
  "ko-KR": "죄송하지만 그건 도와드리기 어려워요. 미용실 관련해서 다른 도움이 필요하신가요?",
};

interface Segment {
  /** Index into messages for a pushed assistant message, or -1 for the in-flight (aborted) one. */
  index: number;
  text: string;
}

class Turn {
  readonly controller = new AbortController();
  segments: Segment[] = [];
  inflight = "";
  firstSentAt = 0;
  chars = 0;
  done: Promise<void> = Promise.resolve();
  interruptUtterance: string | null = null;
  trimmed = false;
  get signal() {
    return this.controller.signal;
  }
}

/**
 * One phone call: conversation history, the Claude streaming loop with tools, barge-in handling,
 * language switching and call logging. Transport agnostic: the same class runs behind Twilio,
 * in the terminal simulator, in the scripted demo and in tests.
 */
export class CallSession {
  readonly log: CallLog;
  readonly messages: MessageParam[] = [];
  language: LanguageCode = DEFAULT_LANGUAGE;
  caller: CallerInfo | null = null;
  ended = false;

  private readonly now: () => DateTime;
  private readonly executor: ToolExecutor;
  private readonly staticPrompt: string;
  private readonly greeting: string;
  private contextText = "";
  private startPromise: Promise<void> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private activeTurn: Turn | null = null;
  private lastTurn: Turn | null = null;
  private pendingEnd: { reason: string } | null = null;
  private pendingTransfer: { reason: string; summary: string } | null = null;
  private endTimer: NodeJS.Timeout | null = null;
  private callerUtterances = 0;
  private consecutiveErrors = 0;
  private spokenAfterGreeting: string | null = null;
  private smsOptInOffered = false;
  private closed = false;
  private readonly detector: LanguageDetector;
  private lastCallerText = "";
  /** Set by ask_caller_language: end the turn after this step's tools. */
  private stopAfterTools = false;
  languageSource: LanguageSource = "default";

  constructor(
    private readonly deps: SessionDeps,
    readonly init: SessionInit,
    private readonly channel: CallChannel,
  ) {
    this.now = deps.now ?? (() => DateTime.now());
    this.staticPrompt = deps.staticPrompt ?? staticSystemPrompt(deps.salon);
    this.greeting = init.greeting ?? deps.config.welcomeGreeting;
    const anonymous = isAnonymousCaller(init.from);
    this.log = new CallLog(deps.config.logDir, {
      callSid: init.callSid,
      from: init.from,
      to: init.to,
      anonymous,
      model: deps.config.anthropicModel,
    });
    if (init.startLanguage && init.startLanguage !== DEFAULT_LANGUAGE) {
      // Twilio already opened the call in this language (greeting, voice, speech recognition).
      this.language = init.startLanguage;
      this.languageSource = "saved";
      this.log.record.languages.push({ at: new Date().toISOString(), language: this.language, reason: "saved preference (call opened in it)" });
    }
    this.log.say("agent", this.greeting, { lang: this.language });
    this.executor = new ToolExecutor(deps.api, deps.salon, this.hooks());
    this.detector = new LanguageDetector({ askEnabled: deps.config.askLanguageQuestion, maxAsks: 2 });
  }

  /** Called on the ConversationRelay `setup` message. Looks up the caller while the greeting plays. */
  start(): Promise<void> {
    this.startPromise ??= this.doStart();
    return this.startPromise;
  }

  private async doStart() {
    void this.deps.reporter?.flush(); // retry any Calls records queued while the website was down
    this.caller = await this.deps.callers.beginCall(this.init.from);
    const pref = this.caller.preferredLanguage;
    if (pref !== DEFAULT_LANGUAGE && pref !== this.language && this.languageSource === "default" && !this.ended) {
      // Fallback: the opening lookup was too slow, so the call opened in English. Add one short
      // line in the saved language and switch.
      const lang = this.deps.languages[pref];
      this.spokenAfterGreeting = lang.continueOffer;
      this.channel.sendText(lang.continueOffer, true, pref);
      this.applyLanguage(pref, "saved preference");
      this.languageSource = "saved";
      this.log.say("agent", lang.continueOffer, { lang: pref });
    }
    this.contextText = callContext({
      salon: this.deps.salon,
      now: this.now(),
      callerPhone: this.caller.phone,
      callerAnonymous: this.caller.anonymous,
      callerName: this.caller.name,
      callCount: this.caller.callCount,
      preferredLanguage: pref,
      currentLanguage: this.deps.languages[this.language],
      greeting: this.greeting,
      openedInSavedLanguage: this.languageSource === "saved" && !this.spokenAfterGreeting,
      spokenAfterGreeting: this.spokenAfterGreeting,
      transferAvailable: this.transferAvailable(),
      resumeReason: this.init.resumeReason,
    });
  }

  private transferAvailable(): boolean {
    return this.transferBlocked() === null && openStatus(this.deps.salon, this.now()).isOpen;
  }

  /** Why a transfer would be unsafe on this call (a loop back to the salon's own line), or null. */
  private transferBlocked(): string | null {
    return transferBlockReason({
      target: this.deps.config.salonForwardNumber,
      mainNumber: this.deps.config.salonMainNumber || this.deps.salon.phone,
      forwardedFrom: this.init.forwardedFrom ?? null,
      alreadyTried: this.init.resumeReason === "transfer_failed",
    });
  }

  private applyLanguage(code: LanguageCode, reason: string) {
    this.language = code;
    this.channel.setLanguage(code);
    this.detector.reset();
    this.log.record.languages.push({ at: new Date().toISOString(), language: code, reason });
  }

  /**
   * A final transcript from the caller. `providerLang` is the prompt message's `lang`: the
   * transcription language, or the detected language when transcription runs in "multi" mode.
   */
  handlePrompt(text: string, providerLang: string | null = null): Promise<void> {
    if (this.ended || !text.trim()) return Promise.resolve();
    if (this.activeTurn) this.interrupt(null); // caller spoke over a reply that had not started playing
    this.cancelPendingEnd();
    const run = async () => {
      await this.start();
      if (this.ended) return;
      this.callerUtterances++;
      this.lastCallerText = text;
      // Log in the language the caller spoke, which is what detection is about to decide.
      const decision = this.deps.config.autoDetectLanguage
        ? this.detector.observe(text, this.language, providerLang)
        : ({ action: "none" } as const);
      const spokenLang = decision.action === "switch" ? decision.to : this.language;
      this.log.say("caller", text, { lang: spokenLang });
      if (decision.action === "ask") {
        this.askLanguageQuestion(text, decision.reason);
        return;
      }
      let notice: string | undefined;
      if (decision.action === "switch") {
        const named = analyzeUtterance(text).explicitNative === decision.to;
        const { saved } = await this.switchLanguage(decision.to, `auto-detect: ${decision.reason}`, named ? "asked" : "detected");
        const l = this.deps.languages[decision.to];
        this.log.say("system", `auto-detect: ${decision.reason}; switched to ${decision.to} (saved: ${saved})`);
        notice =
          `Phone system note: the caller is speaking ${l.englishName}, so speech recognition and the voice are now ${decision.to}. ` +
          `Reply only in ${l.englishName} from now on. Do not call set_language for this.`;
      }
      await this.runTurn([{ type: "text", text }], notice);
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  /** Keypad press. 1 to 4 pick a language; anything else is passed to the model. */
  handleDtmf(digit: string): Promise<void> {
    if (this.ended) return Promise.resolve();
    const code = DTMF_LANGUAGES[digit];
    const run = async () => {
      await this.start();
      if (this.ended) return;
      if (code) {
        if (this.activeTurn) this.interrupt(null);
        const lang = this.deps.languages[code];
        const saved = await this.switchLanguage(code, `keypad ${digit}`, "keypad");
        this.messages.push({ role: "user", content: [{ type: "text", text: `(The caller pressed ${digit} on the keypad to choose ${lang.englishName}.)` }] });
        this.messages.push({ role: "assistant", content: [{ type: "text", text: lang.switchedConfirmation }] });
        this.channel.sendText(lang.switchedConfirmation, true, code);
        this.log.say("system", `keypad ${digit}: switched to ${code} (saved: ${saved.saved})`);
        this.log.say("agent", lang.switchedConfirmation, { lang: code });
        return;
      }
      await this.runTurn([{ type: "text", text: `(The caller pressed ${digit} on the keypad.)` }]);
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  /**
   * Barge-in. Stops the reply that is generating or playing, and trims history to what the
   * caller actually heard. `utterance` is ConversationRelay's utteranceUntilInterrupt.
   */
  interrupt(utterance: string | null) {
    this.cancelPendingEnd();
    const turn = this.activeTurn ?? this.lastTurn;
    if (!turn || turn.trimmed) return;
    // Keep Twilio's utterance if a prompt arrives right after the interrupt frame.
    if (utterance !== null || !turn.signal.aborted) turn.interruptUtterance = utterance;
    if (this.activeTurn === turn) {
      turn.controller.abort();
      // The turn's loop finishes trimming (the in-flight text is only known there).
    } else {
      this.trimTurn(turn);
    }
  }

  /** The caller hung up or the socket closed. Writes the call log. */
  async close(endedBy: "caller" | "agent" | "transfer" | "error" = "caller"): Promise<string | null> {
    if (this.closed) return null;
    this.closed = true;
    this.activeTurn?.controller.abort();
    if (this.endTimer) clearTimeout(this.endTimer);
    await this.chain.catch(() => {});
    const rec = this.log.record;
    rec.endedAt = new Date().toISOString();
    rec.endedBy = rec.endedBy ?? endedBy;
    rec.outcome = this.finalOutcome(endedBy);
    if (rec.outcome === "abandoned" && this.deps.config.callbackOnAbandon && this.callerUtterances > 0 && this.caller?.phone) {
      const lastCaller = [...rec.transcript].reverse().find((t) => t.role === "caller")?.text ?? "";
      const r = await this.postMessage({
        callerName: this.caller.name ?? "Unknown caller",
        phone: this.caller.phone,
        message: `[abandoned] Caller hung up before finishing with the phone agent. Last thing they said: "${lastCaller.slice(0, 200)}" (call ${this.init.callSid})`,
        urgency: "low",
      });
      rec.callbackPosted = r === "sent" || r === "queued";
    }
    // Calls tab: summary and POST happen after the call, off its critical path.
    if (this.deps.reporter) {
      this.reported = this.deps.reporter
        .submit({ record: rec, language: this.language, languageSource: this.languageSource, timezone: this.deps.salon.timezone })
        .catch((err) => console.error(`[call ${this.init.callSid}] call report failed: ${(err as Error).message}`));
    }
    try {
      return this.log.write();
    } catch (err) {
      console.error(`[call ${this.init.callSid}] failed to write log: ${(err as Error).message}`);
      return null;
    }
  }

  /** Resolves when the Calls record has been posted or queued (for tests and the demo). */
  reported: Promise<void> = Promise.resolve();

  private finalOutcome(endedBy: string): Outcome {
    const rec = this.log.record;
    const seen = new Set(rec.outcomes.map((o) => o.outcome));
    for (const o of ["transferred", "booked", "rescheduled", "cancelled", "message"] as Outcome[]) {
      if (seen.has(o)) return o;
    }
    if (this.callerUtterances === 0) return "abandoned";
    if (endedBy === "caller" && rec.endedBy !== "agent") {
      // Hung up without a goodbye. Abandoned if they were left mid-question or mid-booking.
      const t = rec.transcript;
      const lastIsCaller = t[t.length - 1]?.role === "caller";
      const wasBooking = rec.toolCalls.some((c) => ["check_availability", "lookup_bookings"].includes(c.name));
      if (lastIsCaller || wasBooking) return "abandoned";
    }
    return "info-only";
  }

  // ---------------------------------------------------------------- tools wiring

  private hooks(): ToolHooks {
    return {
      callSid: this.init.callSid,
      callerPhone: isAnonymousCaller(this.init.from) ? null : toE164(this.init.from),
      currentLanguage: () => this.language,
      switchLanguage: async (code) => {
        if (code === this.language) return this.switchLanguage(code, "set_language tool (no change)");
        const ev = languageEvidence(this.lastCallerText, code);
        if (!ev.ok) {
          this.log.say("system", `set_language ${code} refused: ${ev.reason}`);
          return { saved: "skipped" as const, refused: ev.reason };
        }
        const a = analyzeUtterance(this.lastCallerText);
        const named = a.explicitNative === code || a.explicitEnglish === code;
        return this.switchLanguage(code, `set_language tool: ${ev.reason}`, named ? "asked" : "detected");
      },
      askLanguage: () => {
        if (!this.detector.canAsk()) return { ok: false as const, spoken: "" };
        this.stopAfterTools = true;
        return { ok: true as const, spoken: this.speakLanguageQuestion(true) };
      },
      requestEnd: (reason) => {
        this.pendingEnd = { reason };
        this.log.record.endReason = reason;
      },
      requestTransfer: (reason, summary) => {
        const blocked = this.transferBlocked();
        if (blocked) return { ok: false, why: blocked };
        if (!openStatus(this.deps.salon, this.now()).isOpen) return { ok: false, why: "The salon is closed, so no one can pick up." };
        this.pendingTransfer = { reason, summary };
        return { ok: true };
      },
      recordOutcome: (outcome, detail) => {
        this.log.record.outcomes.push({ outcome, at: new Date().toISOString(), detail });
      },
      rememberName: (name) => {
        void this.deps.callers.saveName(this.caller?.phone ?? null, name);
      },
      sendMessage: (m) => this.postMessage(m),
      now: () => this.now(),
      smsOptIn: {
        eligible: () => !this.smsOptInOffered && !!this.caller?.phone && !this.caller.anonymous && this.caller.smsOptInAskable,
        offered: () => this.smsOptInOffered,
        markOffered: () => {
          this.smsOptInOffered = true;
        },
        record: (accepted, language) => this.recordSmsConsent(accepted, language),
      },
    };
  }

  /** Saves the caller's answer to the promotional text question, with the exact wording spoken. */
  private async recordSmsConsent(accepted: boolean, language: LanguageCode): Promise<"saved" | "failed"> {
    const phone = this.caller?.phone;
    if (!phone) return "failed";
    try {
      await this.deps.api.recordSmsConsent({
        phone,
        status: accepted ? "express" : "declined",
        source: "phone",
        wording: smsOptInWording(this.deps.salon.name, language, accepted),
        language,
        detail: { callSid: this.init.callSid },
      });
      this.log.record.smsOptIn = { accepted, language, saved: true };
      return "saved";
    } catch (err) {
      this.log.record.smsOptIn = { accepted, language, saved: false };
      this.log.record.errors.push(`recordSmsConsent failed: ${(err as Error).message}`);
      return "failed";
    }
  }

  /**
   * The four-language question: one short line per language, each spoken in its own voice
   * (per-token `lang`), pointing at the keypad shortcuts. Used instead of guessing.
   */
  private speakLanguageQuestion(final: boolean): string {
    const order: LanguageCode[] = ["en-US", "zh-CN", "zh-HK", "ko-KR"];
    const parts = order.map((c) => ({ c, t: this.deps.languages[c].questionPart }));
    parts.forEach(({ c, t }, i) => this.channel.sendText(i === 0 ? t : ` ${t}`, final && i === parts.length - 1, c));
    this.detector.noteAsked();
    const text = parts.map((p) => p.t).join(" ");
    this.log.say("agent", text, { lang: "multi" });
    return text;
  }

  /** Detector found weak signs of another language: ask, without a model call. */
  private askLanguageQuestion(callerText: string, reason: string) {
    this.log.say("system", `language unclear (${reason}); asked which language`);
    const question = this.speakLanguageQuestion(true);
    this.messages.push({ role: "user", content: [{ type: "text", text: callerText }] });
    this.messages.push({ role: "assistant", content: [{ type: "text", text: question }] });
  }

  private async switchLanguage(
    code: LanguageCode,
    reason: string,
    source: LanguageSource = "detected",
  ): Promise<{ saved: "api" | "local" | "skipped" }> {
    if (code !== this.language) {
      this.applyLanguage(code, reason);
      this.languageSource = source;
    }
    const saved = await this.deps.callers.saveLanguage(this.caller?.phone ?? null, code);
    return { saved };
  }

  private async postMessage(m: { callerName: string; phone: string; message: string; urgency: "low" | "normal" | "high" }) {
    try {
      const res = (await this.deps.api.postMessage(m)) as { id?: unknown; message?: { id?: unknown } } | undefined;
      const id = res?.message?.id ?? res?.id;
      if (id !== undefined && id !== null) this.log.record.messageId = String(id);
      return "sent" as const;
    } catch (err) {
      // Keep it so it is not lost; an operator can replay data/pending-messages.jsonl.
      try {
        fs.mkdirSync(this.deps.config.dataDir, { recursive: true });
        fs.appendFileSync(
          path.join(this.deps.config.dataDir, "pending-messages.jsonl"),
          JSON.stringify({ ...m, queuedAt: new Date().toISOString(), error: (err as Error).message }) + "\n",
        );
      } catch {
        /* ignore */
      }
      this.log.record.errors.push(`postMessage failed: ${(err as Error).message}`);
      if (!(err instanceof ApiUnavailableError)) console.warn(`[call ${this.init.callSid}] message POST failed: ${(err as Error).message}`);
      return "queued" as const;
    }
  }

  // ---------------------------------------------------------------- the agent loop

  private buildParams(): StreamParams {
    const opts = modelOptions(this.deps.config);
    const ttl = (process.env.PROMPT_CACHE_TTL === "5m" ? "5m" : "1h") as "5m" | "1h";
    return {
      model: this.deps.config.anthropicModel,
      max_tokens: this.deps.config.maxTokens,
      system: [
        { type: "text", text: this.staticPrompt, cache_control: { type: "ephemeral", ttl } },
        { type: "text", text: this.contextText },
      ],
      tools: TOOL_DEFINITIONS,
      messages: this.messages,
      cache_control: { type: "ephemeral" },
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      ...(opts.fallbacks ? { fallbacks: "default" as const, betas: ["server-side-fallback-2026-07-01"] } : {}),
    };
  }

  private speak(turn: Turn, text: string, last: boolean) {
    if (!text && !last) return;
    if (!turn.firstSentAt && text) turn.firstSentAt = Date.now();
    turn.chars += text.length;
    this.channel.sendText(text, last, this.language);
  }

  private async runTurn(content: ContentBlockParam[], notice?: string) {
    const turn = new Turn();
    this.activeTurn = turn;
    this.lastTurn = turn;
    let resolveDone!: () => void;
    turn.done = new Promise((r) => (resolveDone = r));
    if (notice && modelOptions(this.deps.config).systemMessages) {
      // Harness notice as a mid-conversation system message, kept separate from the caller's words.
      this.messages.push({ role: "user", content });
      this.messages.push({ role: "system", content: notice });
    } else {
      this.messages.push({ role: "user", content: notice ? [...content, { type: "text", text: `(${notice})` }] : content });
    }
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (turn.signal.aborted) break;
        const res = await this.streamStep(turn);
        if (res.kind === "aborted") break;
        if (res.kind === "error") {
          await this.onModelError(turn, res.error);
          break;
        }
        this.consecutiveErrors = 0;
        const msg = res.message;
        const blocks = sanitizeAssistantContent(msg);
        const toolUses = blocks.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use");

        if (msg.stop_reason === "refusal") {
          const text = REFUSAL[this.language];
          this.speak(turn, text, true);
          this.messages.push({ role: "assistant", content: [{ type: "text", text }] });
          this.log.say("agent", text, { lang: this.language });
          break;
        }
        const truncatedTool = msg.stop_reason === "max_tokens" && toolUses.length > 0;
        const isFinal = toolUses.length === 0 || truncatedTool;
        const spokenText = res.sent + res.rest;
        this.speak(turn, res.rest, isFinal);
        if (truncatedTool) {
          this.log.record.errors.push("tool input truncated at max_tokens; tools not run");
          const text = TROUBLE[this.language];
          this.speak(turn, text, true);
          this.messages.push({ role: "assistant", content: [{ type: "text", text }] });
          break;
        }
        if (blocks.some((b) => b.type === "text" || b.type === "tool_use")) {
          this.messages.push({ role: "assistant", content: blocks });
          if (spokenText) turn.segments.push({ index: this.messages.length - 1, text: spokenText });
        }
        this.log.say("agent", spokenText, { lang: this.language });
        if (isFinal) break;

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          const t0 = Date.now();
          const r = await this.executor.run(tu.name, tu.input);
          this.log.tool({ name: tu.name, input: tu.input, result: safeJson(r.content), isError: r.isError, ms: Date.now() - t0 });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
        }
        this.messages.push({ role: "user", content: results });
        if (turn.signal.aborted) break; // interrupted while tools ran: keep results, let the caller talk
        if (this.stopAfterTools) {
          // ask_caller_language already spoke the question and ended the reply.
          this.stopAfterTools = false;
          break;
        }
        // The goodbye or handoff line was already said in this step: no need for another model call.
        if ((this.pendingEnd || this.pendingTransfer) && spokenText.trim()) {
          this.speak(turn, "", true);
          break;
        }
      }
    } finally {
      if (turn.signal.aborted) this.trimTurn(turn);
      this.activeTurn = null;
      resolveDone();
    }
    if (!turn.signal.aborted) this.scheduleEndIfRequested(turn);
  }

  private async streamStep(
    turn: Turn,
    attempt = 0,
  ): Promise<{ kind: "ok"; message: LlmMessage; sent: string; rest: string } | { kind: "aborted" } | { kind: "error"; error: unknown }> {
    const chunker = new SentenceChunker();
    let sent = "";
    let sawText = false;
    turn.inflight = "";
    try {
      const stream = this.deps.llm.stream(this.buildParams(), { signal: turn.signal });
      for await (const ev of stream) {
        if (ev.type === "content_block_start" && ev.content_block.type === "text") {
          if (sawText) for (const s of chunker.push(" ")) this.emit(turn, s), (sent += s);
          sawText = true;
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          for (const s of chunker.push(ev.delta.text)) {
            this.emit(turn, s);
            sent += s;
          }
        }
      }
      const message = await stream.finalMessage();
      this.log.addUsage(message.usage);
      turn.inflight = "";
      return { kind: "ok", message, sent, rest: chunker.flush() };
    } catch (err) {
      if (isAbortError(err, turn.signal)) return { kind: "aborted" };
      const isApi = err instanceof Anthropic.APIError;
      if (!isApi && attempt < 1 && !sent) {
        // Unparseable streamed tool input (eager input streaming): re-issue the step once.
        return this.streamStep(turn, attempt + 1);
      }
      return { kind: "error", error: err };
    }
  }

  private emit(turn: Turn, sentence: string) {
    this.speak(turn, sentence, false);
    turn.inflight += sentence;
  }

  private async onModelError(turn: Turn, err: unknown) {
    this.consecutiveErrors++;
    const msg = err instanceof Anthropic.APIError ? `Claude API ${err.status}: ${err.message}` : String((err as Error)?.message ?? err);
    console.error(`[call ${this.init.callSid}] model error: ${msg}`);
    this.log.record.errors.push(msg);
    if (this.consecutiveErrors >= 2) {
      const text = GIVE_UP[this.language];
      this.speak(turn, text, true);
      this.log.say("agent", text, { lang: this.language });
      if (this.caller?.phone) {
        await this.postMessage({
          callerName: this.caller.name ?? "Unknown caller",
          phone: this.caller.phone,
          message: `[technical] The phone agent hit an error and could not finish this call. Please call back. (call ${this.init.callSid})`,
          urgency: "normal",
        });
        this.log.record.outcomes.push({ outcome: "message", at: new Date().toISOString(), detail: { reason: "technical" } });
      }
      this.pendingEnd = { reason: "technical_error" };
      return;
    }
    const text = TROUBLE[this.language];
    this.speak(turn, text, true);
    this.log.say("agent", text, { lang: this.language });
  }

  /** Make history match what the caller actually heard before they cut in. */
  private trimTurn(turn: Turn) {
    if (turn.trimmed) return;
    turn.trimmed = true;
    const segments = [...turn.segments];
    if (turn.inflight) segments.push({ index: -1, text: turn.inflight });
    const full = segments.map((s) => s.text).join("");
    if (!full) return;
    const heard = turn.interruptUtterance === null ? full.length : spokenLength(full, turn.interruptUtterance);
    let remaining = heard;
    let lastHeard = "";
    for (const seg of segments) {
      const keep = Math.max(0, Math.min(seg.text.length, remaining));
      remaining -= keep;
      if (keep === seg.text.length && seg.index >= 0) {
        lastHeard = seg.text;
        continue;
      }
      const kept = seg.text.slice(0, keep).trimEnd();
      const replacement = !kept ? "" : keep < seg.text.length ? `${kept.replace(/[,.;:!?，。、]+$/u, "")}...` : kept;
      if (seg.index === -1) {
        if (replacement) this.messages.push({ role: "assistant", content: [{ type: "text", text: replacement }] });
      } else {
        this.replaceText(seg.index, replacement);
      }
      lastHeard = replacement;
    }
    if (turn.interruptUtterance !== null || turn.inflight) this.log.trimLastAgentLine(lastHeard);
  }

  /** Replace the text of an assistant message, keeping thinking and tool_use blocks unchanged. */
  private replaceText(index: number, text: string) {
    const m = this.messages[index];
    if (!m || m.role !== "assistant" || typeof m.content === "string") return;
    const out: ContentBlockParam[] = [];
    let placed = false;
    for (const b of m.content) {
      if (b.type === "text") {
        if (!placed && text) out.push({ type: "text", text });
        placed = true;
      } else {
        out.push(b);
      }
    }
    const meaningful = out.some((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
    if (!meaningful && index === this.messages.length - 1) {
      this.messages.pop();
    } else {
      this.messages[index] = { role: "assistant", content: out.length ? out : [{ type: "text", text: "..." }] };
    }
  }

  private cancelPendingEnd() {
    if (this.endTimer && !this.ended) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    if (!this.ended) {
      this.pendingEnd = null;
      this.pendingTransfer = null;
    }
  }

  private scheduleEndIfRequested(turn: Turn) {
    if (!this.pendingEnd && !this.pendingTransfer) return;
    const lang = this.deps.languages[this.language];
    const speechMs = turn.chars * lang.msPerChar;
    const elapsed = turn.firstSentAt ? Date.now() - turn.firstSentAt : 0;
    const wait = Math.max(0, speechMs - elapsed) + this.deps.config.endCallGraceMs;
    const doEnd = () => {
      this.endTimer = null;
      if (this.ended) return;
      this.ended = true;
      if (this.pendingTransfer) {
        this.log.record.outcomes.push({ outcome: "transferred", at: new Date().toISOString(), detail: { ...this.pendingTransfer } });
        this.log.record.endedBy = "transfer";
        this.channel.end({
          reasonCode: "live-agent-handoff",
          reason: this.pendingTransfer.reason,
          summary: this.pendingTransfer.summary,
          callerPhone: this.caller?.phone ?? null,
          language: this.language,
        });
      } else {
        this.log.record.endedBy = "agent";
        this.channel.end({ reasonCode: "end-call", reason: this.pendingEnd?.reason ?? "completed" });
      }
    };
    this.endTimer = setTimeout(doEnd, wait);
  }
}

/** Drop fallback markers and pre-boundary blocks the API says not to echo back. */
export function sanitizeAssistantContent(msg: LlmMessage): ContentBlockParam[] {
  const blocks = msg.content as unknown as ContentBlockParam[];
  const lastFallback = blocks.map((b) => b.type).lastIndexOf("fallback");
  return blocks.filter((b, i) => {
    if (b.type === "fallback") return false;
    if (lastFallback >= 0 && i < lastFallback && ["thinking", "redacted_thinking", "tool_use"].includes(b.type)) return false;
    return true;
  });
}

/**
 * How many characters of `full` the caller heard, given ConversationRelay's
 * utteranceUntilInterrupt. Matching ignores case, spacing and punctuation.
 */
export function spokenLength(full: string, utterance: string): number {
  const norm: number[] = []; // index in full for each kept char
  let nf = "";
  for (let i = 0; i < full.length; i++) {
    const c = full[i].toLowerCase();
    if (/[\p{L}\p{N}]/u.test(c)) {
      nf += c;
      norm.push(i);
    }
  }
  const nu = [...utterance.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join("");
  if (!nu) return 0;
  let idx = nf.indexOf(nu);
  let len = nu.length;
  if (idx < 0) {
    // Try shorter tails of the utterance (it may include words from before this turn).
    for (let k = 1; k < nu.length && idx < 0; k++) {
      const tail = nu.slice(k);
      if (tail.length < 4) break;
      idx = nf.indexOf(tail);
      len = tail.length;
    }
  }
  if (idx < 0) return Math.min(full.length, utterance.length);
  const end = norm[idx + len - 1] + 1;
  // Include trailing punctuation that belongs to the last heard word.
  let j = end;
  while (j < full.length && /[^\s\p{L}\p{N}]/u.test(full[j])) j++;
  return j;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
