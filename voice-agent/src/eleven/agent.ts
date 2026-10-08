import crypto from "node:crypto";
import { DateTime } from "luxon";
import type { SessionDeps } from "../agent/session.js";
import { callContext, staticSystemPrompt } from "../agent/prompt.js";
import { DEFAULT_PREFETCH, prefetchOpenings } from "../agent/prefetch.js";
import { TOOL_DEFINITIONS, ToolExecutor, type Outcome, type ToolHooks } from "../agent/tools.js";
import { CallLog } from "../agent/calllog.js";
import { ApiUnavailableError } from "../api/types.js";
import { LANGUAGE_CODES, looksLikeElevenLabsVoice, type LanguageCode } from "../languages.js";
import { isAnonymousCaller, toE164 } from "../phone.js";
import { SPEECH_HINTS } from "../relay/twiml.js";

/**
 * Third test line: ElevenLabs' own phone agent (ElevenLabs Agents). ElevenLabs runs the whole call
 * (listening, turn-taking, the model, and the voice), with the salon's ElevenLabs voices, Eleven v4
 * Turbo for Cantonese, and Claude as the model. This server only:
 *   1. keeps the agent's settings in code: on startup it creates or updates the agent by name;
 *   2. answers the Twilio webhook (POST /eleven/twiml) by registering the call with ElevenLabs,
 *      passing the caller's saved language, name and today's openings, and returning its TwiML;
 *   3. runs the booking tools when the agent calls them (POST /eleven/tools/:name), with the same
 *      code and the same website API as the main line.
 *
 * API shapes from the official @elevenlabs/elevenlabs-js SDK (wire names are snake_case):
 *   GET /v1/convai/agents?search=  POST /v1/convai/agents/create  PATCH /v1/convai/agents/{id}
 *   POST /v1/convai/twilio/register-call {agent_id, from_number, to_number, direction,
 *     conversation_initiation_client_data: {dynamic_variables, conversation_config_override}} -> TwiML
 */

export const AGENT_NAME = "CF Hair Salon phone agent (test)";

/** ElevenLabs requires its English-only models (flash or turbo v2) for an English agent. */
const MODEL_EN = "eleven_flash_v2";
const MODEL_FAST = "eleven_flash_v2_5";

/** Salon words in Cantonese, Mandarin and Korean, to help speech recognition hear them right. */
export const MULTILINGUAL_HINTS = [
  "飛髮", "剪頭髮", "男士剪髮", "女士剪髮", "小朋友剪髮", "洗剪吹", "電髮", "負離子", "焗油", "補色", "染髮", "預約", "聽日", "有冇位",
  "剪头发", "理发", "男士理发", "女士剪发", "儿童剪发", "烫发", "离子烫", "染发", "预约", "明天", "有没有位置",
  "커트", "남자 커트", "여자 커트", "펌", "다운펌", "매직", "염색", "뿌리 염색", "클리닉", "예약", "내일",
];
const MODEL_CANTONESE = "eleven_v4_turbo";

/** Tools the agent can call on this server. Transfers and the SMS question are left out of the test. */
const SKIPPED = new Set(["ask_caller_language", "record_sms_consent", "transfer_to_human", "end_call"]);

export interface ElevenAgentOptions {
  apiKey: string;
  apiBase: string;
  /** https://<this server>, for the tool webhooks. */
  publicBaseUrl: string;
  llm: string;
  /** ElevenLabs' language code for Cantonese in agents ("" leaves Cantonese callers on Mandarin settings). */
  cantoneseCode: string;
  /** Shared secret the agent sends with every tool call. */
  toolKey: string;
}

/** The secret the agent's tool calls carry, derived so no new setting is needed. */
export function toolKeyFor(secret: string): string {
  return crypto.createHmac("sha256", secret || "cf-hair").update("eleven-tools").digest("base64url");
}

/** Call language to ElevenLabs agent language. */
export function agentLanguage(code: LanguageCode, cantoneseCode: string): string {
  return { "en-US": "en", "zh-CN": "zh", "zh-HK": cantoneseCode || "zh", "ko-KR": "ko" }[code];
}

/** Voices ElevenLabs could not find in the account (library voices not added to My Voices). */
export const missingVoices = new Set<string>();

function voiceIdFor(deps: SessionDeps, code: LanguageCode): string | null {
  const id = deps.languages[code].voice.split("-")[0];
  return looksLikeElevenLabsVoice(id) && !missingVoices.has(id) ? id : null;
}

function agentNote(deps: SessionDeps): string {
  const l = deps.languages;
  return `# This call: ElevenLabs phone agent
You hear the caller through speech recognition and speak with your own voice.
- Language: answer in the language the caller speaks (English, Mandarin, Cantonese or Korean). If they speak another of these, switch with the language detection tool, and also call set_language once so it is remembered for their next call. There is no ask_caller_language or keypad here.
- Live transfer is not available on this line; offer to take a message instead.
- Never call book_appointment, cancel_booking or reschedule_booking in the same reply that asks the caller to confirm. Ask, stop, and only act after they say yes.
- Goodbyes: when the call is done, say a short goodbye ending with "${l["en-US"].byes}" (Mandarin or Cantonese: "${l["zh-CN"].byes}", Korean: "${l["ko-KR"].byes}"), then use end_call.

{{call_context}}`;
}

/** JSON Schema (the main line's tool inputs) to ElevenLabs' tool body schema. */
function bodySchema(schema: { properties?: Record<string, any>; required?: string[] }) {
  const properties: Record<string, unknown> = {
    call_sid: { type: "string", dynamic_variable: "call_sid" },
    call_key: { type: "string", dynamic_variable: "call_key" },
    caller_phone: { type: "string", dynamic_variable: "caller_phone" },
  };
  for (const [name, p] of Object.entries(schema.properties ?? {})) {
    properties[name] = {
      type: p.type ?? "string",
      description: p.description || name.replace(/_/g, " "),
      ...(Array.isArray(p.enum) ? { enum: p.enum } : {}),
    };
  }
  return { type: "object", required: [...(schema.required ?? []), "call_sid", "call_key"], properties };
}

export function agentTools(opts: Pick<ElevenAgentOptions, "publicBaseUrl" | "toolKey">) {
  return TOOL_DEFINITIONS.filter((t) => !SKIPPED.has(t.name)).map((t) => ({
    type: "webhook",
    name: t.name,
    description: t.description ?? t.name,
    response_timeout_secs: 20,
    // No "one moment" filler before a lookup; the answer follows straight away.
    pre_tool_speech: "off",
    api_schema: {
      url: `${opts.publicBaseUrl}/eleven/tools/${t.name}`,
      method: "POST",
      request_headers: { "x-cf-tool-key": opts.toolKey },
      request_body_schema: bodySchema(t.input_schema as never),
    },
  }));
}

/** The whole agent, as sent to ElevenLabs on create and update. */
export function agentConfig(deps: SessionDeps, opts: ElevenAgentOptions, withCantonese = true) {
  const en = voiceIdFor(deps, "en-US");
  const presets: Record<string, unknown> = {};
  for (const code of LANGUAGE_CODES) {
    // Without a Cantonese language code, Cantonese shares "zh" with Mandarin: the Mandarin preset stays,
    // and a Cantonese caller gets their voice and Eleven v4 Turbo when the call starts (register()).
    if (code === "en-US" || (code === "zh-HK" && (!withCantonese || !opts.cantoneseCode))) continue;
    const lang = agentLanguage(code, opts.cantoneseCode);
    const voice = voiceIdFor(deps, code);
    presets[lang] = {
      overrides: {
        agent: { language: lang, first_message: deps.languages[code].greeting },
        tts: { ...(voice ? { voice_id: voice } : {}), model_id: code === "zh-HK" ? MODEL_CANTONESE : MODEL_FAST },
      },
    };
  }
  const base = deps.staticPrompt ?? staticSystemPrompt(deps.salon);
  return {
    name: AGENT_NAME,
    tags: ["cf-hair"],
    conversation_config: {
      asr: { quality: "high", user_input_audio_format: "ulaw_8000", keywords: [...SPEECH_HINTS.split(","), ...MULTILINGUAL_HINTS] },
      turn: { turn_timeout: 7, turn_eagerness: "eager", speculative_turn: true },
      tts: {
        model_id: MODEL_EN,
        ...(en ? { voice_id: en } : {}),
        agent_output_audio_format: "ulaw_8000",
        optimize_streaming_latency: 3,
      },
      conversation: { max_duration_seconds: 600 },
      language_presets: presets,
      agent: {
        first_message: deps.config.welcomeGreeting,
        language: "en",
        prompt: {
          prompt: `${base}\n\n${agentNote(deps)}`,
          llm: opts.llm,
          temperature: 0.3,
          tools: agentTools(opts),
          built_in_tools: {
            end_call: { name: "end_call", description: "End the call after the goodbye has been said.", params: { system_tool_type: "end_call" } },
            language_detection: {
              name: "language_detection",
              description: "Switch to the language the caller is speaking: English, Mandarin, Cantonese or Korean.",
              params: { system_tool_type: "language_detection" },
            },
          },
        },
      },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { first_message: true, language: true },
          tts: { voice_id: true, model_id: true },
        },
      },
    },
  };
}

async function el<T>(opts: ElevenAgentOptions, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${opts.apiBase}${path}`, {
    method,
    headers: { "xi-api-key": opts.apiKey, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`ElevenLabs ${method} ${path} failed: ${r.status} ${text.slice(0, 600)}`), { status: r.status });
  const type = r.headers.get("content-type") ?? "";
  return (type.includes("json") ? JSON.parse(text) : text) as T;
}

/** Creates the agent, or updates the one with our name, so its settings always match this code. */
export async function upsertAgent(deps: SessionDeps, opts: ElevenAgentOptions): Promise<string> {
  const list = await el<{ agents?: { agent_id: string; name: string }[] }>(opts, "GET", `/v1/convai/agents?${new URLSearchParams({ search: AGENT_NAME, page_size: "30" })}`);
  const existing = list.agents?.find((a) => a.name === AGENT_NAME);
  const send = async (withCantonese: boolean) => {
    const body = agentConfig(deps, opts, withCantonese);
    if (existing) {
      await el(opts, "PATCH", `/v1/convai/agents/${encodeURIComponent(existing.agent_id)}`, body);
      return existing.agent_id;
    }
    const r = await el<{ agent_id: string }>(opts, "POST", "/v1/convai/agents/create", body);
    return r.agent_id;
  };
  // A voice that is not in the account fails the whole agent: leave it out (ElevenLabs' default voice
  // is used for that language) and say which one, so it can be added under My Voices.
  const sendSkippingMissingVoices = async (withCantonese: boolean): Promise<string> => {
    for (let i = 0; ; i++) {
      try {
        return await send(withCantonese);
      } catch (err) {
        const m = /voice_id (\w+) was not found/.exec((err as Error).message);
        if (!m || i >= 4 || missingVoices.has(m[1])) throw err;
        missingVoices.add(m[1]);
        console.warn(`[eleven] voice ${m[1]} is not in this ElevenLabs account (add it under Voices > My Voices); using the default voice for now`);
      }
    }
  };
  try {
    return await sendSkippingMissingVoices(true);
  } catch (err) {
    // If ElevenLabs does not take the Cantonese language code, keep the rest working.
    const status = (err as { status?: number }).status ?? 0;
    const aboutLanguage = new RegExp(`language|"${opts.cantoneseCode}"`, "i").test((err as Error).message);
    if (status >= 400 && status < 500 && opts.cantoneseCode && aboutLanguage) {
      console.warn(`[eleven] agent settings refused with Cantonese (${opts.cantoneseCode}); retrying without it: ${(err as Error).message}`);
      return sendSkippingMissingVoices(false);
    }
    throw err;
  }
}

/** Per-call state for the tool webhooks: the caller and the same tool code as the main line. */
interface ElevenCall {
  executor: ToolExecutor;
  log: CallLog;
  phone: string | null;
  language: LanguageCode;
  created: number;
}

export class ElevenLine {
  private agentId: Promise<string> | null = null;
  private readonly calls = new Map<string, ElevenCall>();
  private readonly secret: string;

  constructor(
    private readonly deps: SessionDeps,
    private readonly opts: ElevenAgentOptions,
    secret: string,
  ) {
    this.secret = secret;
  }

  /** Sets up the agent (once; retried on the next call if it failed). */
  ready(): Promise<string> {
    if (!this.agentId) {
      const t0 = Date.now();
      this.agentId = upsertAgent(this.deps, this.opts).then(
        (id) => {
          console.log(`[eleven] agent ready: ${id} (${this.opts.llm}) in ${Date.now() - t0}ms`);
          return id;
        },
        (err) => {
          this.agentId = null;
          console.error(`[eleven] agent setup failed: ${(err as Error).message}`);
          throw err;
        },
      );
    }
    return this.agentId;
  }

  callKey(callSid: string): string {
    return crypto.createHmac("sha256", this.secret || "cf-hair").update(`eleven:${callSid}`).digest("base64url");
  }

  /** POST /eleven/twiml: registers the call with ElevenLabs and returns its TwiML. */
  async register(p: { callSid: string; from: string; to: string }): Promise<string> {
    const deps = this.deps;
    const now = deps.now?.() ?? DateTime.now();
    const ids = deps.config.prefetchServiceIds;
    const [agentId, caller, openings] = await Promise.all([
      this.ready(),
      deps.callers.beginCall(p.from),
      ids.length
        ? prefetchOpenings(deps.api, deps.salon, now, { ...DEFAULT_PREFETCH, serviceIds: ids, timeoutMs: 1500 }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const language = caller.preferredLanguage;
    const known = caller.preferredLanguage !== "en-US" || caller.callCount > 0;
    const greeting = known ? deps.languages[language].greeting : deps.config.welcomeGreeting;
    this.track(p.callSid, p.from, p.to, language);
    const context = callContext({
      salon: deps.salon,
      now,
      callerPhone: caller.phone,
      callerAnonymous: caller.anonymous,
      callerName: caller.name,
      callCount: caller.callCount,
      preferredLanguage: language,
      currentLanguage: deps.languages[language],
      greeting,
      openedInSavedLanguage: language !== "en-US",
      spokenAfterGreeting: null,
      transferAvailable: false,
      bookingWebsiteSpoken: deps.config.bookingWebsiteSpoken,
      openings,
    });
    const voice = voiceIdFor(deps, language);
    const twiml = await el<string>(this.opts, "POST", "/v1/convai/twilio/register-call", {
      agent_id: agentId,
      from_number: p.from,
      to_number: p.to,
      direction: "inbound",
      conversation_initiation_client_data: {
        dynamic_variables: { call_sid: p.callSid, call_key: this.callKey(p.callSid), caller_phone: caller.phone ?? "", call_context: context },
        conversation_config_override: {
          agent: { language: agentLanguage(language, this.opts.cantoneseCode), first_message: greeting },
          ...(language !== "en-US" ? { tts: { ...(voice ? { voice_id: voice } : {}), model_id: language === "zh-HK" ? MODEL_CANTONESE : MODEL_FAST } } : {}),
        },
      },
    });
    console.log(`[eleven call ${p.callSid}] registered with ElevenLabs, opening in ${language}`);
    return twiml;
  }

  private track(callSid: string, from: string | null, to: string | null, language: LanguageCode): ElevenCall {
    // Calls are forgotten after two hours.
    const cutoff = Date.now() - 2 * 3600_000;
    for (const [k, c] of this.calls) if (c.created < cutoff) this.calls.delete(k);
    const phone = isAnonymousCaller(from) ? null : toE164(from);
    const log = new CallLog(this.deps.config.logDir, {
      callSid,
      from,
      to,
      anonymous: !phone,
      model: `elevenlabs:${this.opts.llm}`,
    });
    const call: ElevenCall = { log, phone, language, created: Date.now(), executor: null as never };
    call.executor = new ToolExecutor(this.deps.api, this.deps.salon, this.hooks(callSid, call));
    this.calls.set(callSid, call);
    return call;
  }

  /** POST /eleven/tools/:name from the agent. Returns what the model sees. */
  async runTool(name: string, headers: { key?: string }, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    if (!headers.key || headers.key !== this.opts.toolKey) return { status: 401, body: { error: "unauthorized" } };
    const callSid = typeof body.call_sid === "string" ? body.call_sid : "";
    if (!callSid || body.call_key !== this.callKey(callSid)) return { status: 403, body: { error: "unknown call" } };
    // After a server restart mid-call, pick up with what the tool call carries.
    const phone = typeof body.caller_phone === "string" && body.caller_phone ? body.caller_phone : null;
    const call = this.calls.get(callSid) ?? this.track(callSid, phone, null, "en-US");
    const { call_sid: _s, call_key: _k, caller_phone: _p, ...input } = body;
    void [_s, _k, _p];
    const t0 = Date.now();
    const res = await call.executor.run(name, input);
    call.log.tool({ name, input, result: safeJson(res.content), isError: res.isError, ms: Date.now() - t0 });
    console.log(`[eleven call ${callSid}] tool ${name}${res.isError ? " (error)" : ""} in ${Date.now() - t0}ms`);
    return { status: 200, body: safeJson(res.content) };
  }

  private hooks(callSid: string, call: ElevenCall): ToolHooks {
    const deps = this.deps;
    return {
      callSid,
      get callerPhone() {
        return call.phone;
      },
      currentLanguage: () => call.language,
      switchLanguage: async (code) => {
        call.language = code;
        return { saved: await deps.callers.saveLanguage(call.phone, code) };
      },
      requestEnd: () => {},
      requestTransfer: () => ({ ok: false, why: "Live transfer is not available on this line. Offer to take a message." }),
      recordOutcome: (outcome: Outcome, detail) => {
        call.log.record.outcomes.push({ outcome, at: new Date().toISOString(), detail });
      },
      rememberName: (n) => void deps.callers.saveName(call.phone, n),
      sendMessage: async (m) => {
        try {
          await deps.api.postMessage(m);
          return "sent" as const;
        } catch (err) {
          if (!(err instanceof ApiUnavailableError)) console.warn(`[eleven call ${callSid}] message POST failed: ${(err as Error).message}`);
          return "queued" as const;
        }
      },
      now: () => deps.now?.() ?? DateTime.now(),
    };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
