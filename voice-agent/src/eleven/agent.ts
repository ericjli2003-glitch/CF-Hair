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

/** Korean, and Mandarin when ElevenLabs refuses Eleven v4 Turbo for it. */
const MODEL_FAST = "eleven_flash_v2_5";
/** English when ElevenLabs refuses Eleven v4 Turbo for an English agent (its rule was v2 models only). */
const MODEL_ENGLISH_FALLBACK = "eleven_turbo_v2";

/** Salon words in Cantonese, Mandarin and Korean, to help speech recognition hear them right. */
/** English phrases that tell men's from women's when "men's" alone is misheard (ElevenLabs line only). */
const SERVICE_HINTS = ["men's haircut", "for a man", "for a guy", "women's haircut", "for a woman", "for a lady"];

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
  /** Model for English (the agent's main language); falls back to eleven_turbo_v2 if refused. */
  englishModel?: string;
  /** Model for the Mandarin preset; falls back to eleven_flash_v2_5 if refused. */
  mandarinModel?: string;
  /** Language detection may switch only in the caller's first two turns. */
  detectionOnlyAtStart?: boolean;
  /** Shared secret the agent sends with every tool call. */
  toolKey: string;
}

/** What the agent is set up with: what was asked for, narrowed to what ElevenLabs accepted. */
export interface AgentSettings {
  englishModel: string;
  mandarinModel: string;
  /** "" when there is no Cantonese language (refused or not set): Cantonese runs on the Mandarin setting. */
  cantoneseCode: string;
  detectionOnlyAtStart: boolean;
}

/**
 * What a new caller hears first: the salon's English greeting plus 你好 (the same word in Mandarin
 * and Cantonese), so Chinese speakers answer in Chinese from their first sentence and the language
 * detection hears it in time. An English-only voice model cannot say Chinese characters, so it gets
 * the sound written out instead.
 */
export function newCallerGreeting(welcome: string, s: Pick<AgentSettings, "englishModel">): string {
  const englishOnly = /_v2$|^eleven_(turbo|flash)_v2$/.test(s.englishModel);
  return `${welcome.trim()} ${englishOnly ? "Nee how!" : "你好！"}`;
}

export function requestedSettings(opts: ElevenAgentOptions): AgentSettings {
  return {
    englishModel: opts.englishModel || MODEL_ENGLISH_FALLBACK,
    mandarinModel: opts.mandarinModel || MODEL_FAST,
    cantoneseCode: opts.cantoneseCode,
    detectionOnlyAtStart: opts.detectionOnlyAtStart ?? true,
  };
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
- Language: always answer in the language the caller speaks (English, Mandarin, Cantonese or Korean). When they speak another of these, use the language detection tool, and call set_language once so their next call opens in it. Do both silently: never say that you are switching, never name the language ("let me switch to Cantonese"), just carry on in their language. There is no ask_caller_language or keypad here.
- Your greeting ends with 你好 so Chinese speakers can answer in Chinese; it does not mean the caller speaks Chinese. Answer in whatever language they reply in.
- Mandarin and Cantonese are decided once, from how the caller speaks in their first turns. After that, never move between them (with language detection or set_language) unless the caller asks for the other one in words, such as 講廣東話 or 说普通话. A Mandarin speaker's word that looks Cantonese, or the other way round, is not a reason to switch.
- Stay in the caller's language for the whole call, even after a tool result, a long pause or a booking. Once a caller speaks Cantonese, every reply is Cantonese: never drift into Mandarin or English. Once a caller speaks Mandarin, every reply is Mandarin: never drift into Cantonese or English. The same for English. Change only when the caller changes.
- Men's or women's: speech recognition often confuses "men's" and "women's" (one sounds inside the other). Never change the service the caller chose on your own, and never assume it from the name on file or the voice. Name the service clearly in the quick check before booking ("A men's cut at three. Is this for Eric?"), and if the caller corrects it, use their correction.
- Live transfer is not available on this line; offer to take a message instead.
- Never call book_appointment, cancel_booking or reschedule_booking in the same reply that asks the caller to confirm. Ask, stop, and only act after they say yes.
- Goodbyes: when the call is done, say one short goodbye ending with "${l["en-US"].byes}" (Mandarin or Cantonese: "${l["zh-CN"].byes}", Korean: "${l["ko-KR"].byes}") and call end_call in that same reply, so the call hangs up right after it. Say goodbye once; never wait for the caller to say it back.

${SPOKEN_STYLE}

{{call_context}}`;
}

/**
 * How each language should sound. The voice reads your words exactly as written, so Cantonese must be
 * written as it is spoken in Hong Kong, not as standard written Chinese read aloud in Cantonese.
 */
export const SPOKEN_STYLE = `# Sound like a real person at the front desk
- Everything you write is spoken aloud exactly as written. Write the way people talk on the phone, not the way they write.
- Short replies, one question at a time. Brief natural acknowledgements, and vary them.
- Never use stock customer-service lines such as "Certainly, I'd be happy to assist", "How may I assist you today?", "您好，请问有什么可以帮您", "請問有什麼可以幫到您".
- English: a relaxed Vancouver receptionist. Contractions and everyday words: "Yeah, sure.", "Sounds good.", "Got it.", "When would you like to come in?", "How does three o'clock sound?", "Is this for Eric?", "You're all set for three."
- Mandarin: everyday spoken Mandarin, the way people in Vancouver talk, not formal or translated: "好的。", "行。", "没问题。", "您看几点方便？", "三点钟怎么样？", "是帮Eric约的吗？"
- Cantonese: genuine spoken Hong Kong Cantonese in traditional characters, never standard written Chinese. Use spoken words: 係 (not 是), 唔 (not 不), 冇 (not 沒有), 嘅 (not 的), 咗, 啲, 喺, 佢, 而家 (not 現在), 聽日 (not 明天), 幾點 (not 什麼時候), 邊位, 咩, 呀, 喇. Mix in the English words Hong Kong people use: "book 個位", "OK 呀", "check 吓", "cut 頭髮".
  Say: "好呀，聽日幾點方便呀？" not "好的，明天什麼時間方便？"
  Say: "三點鐘得唔得呀？" not "三點？"
  Say: "係咪幫Eric約呀？" not "Eric？"
  Say: "三點有位，幫你book 咗佢好唔好？" not "三點有空位，我可以為您預約嗎？"
  Say: "冇問題，搞掂喇。" not "沒有問題，已經完成了。"
  Acknowledgements: "好呀。", "得。", "冇問題。", "OK 呀。", "唔該晒。"`;

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
export function agentConfig(deps: SessionDeps, opts: ElevenAgentOptions, s: AgentSettings = requestedSettings(opts)) {
  const en = voiceIdFor(deps, "en-US");
  const presets: Record<string, unknown> = {};
  for (const code of LANGUAGE_CODES) {
    // Without a Cantonese language code, Cantonese shares "zh" with Mandarin: the Mandarin preset stays,
    // and a Cantonese caller gets their voice and Eleven v4 Turbo when the call starts (register()).
    if (code === "en-US" || (code === "zh-HK" && !s.cantoneseCode)) continue;
    const lang = agentLanguage(code, s.cantoneseCode);
    const voice = voiceIdFor(deps, code);
    presets[lang] = {
      overrides: {
        agent: { language: lang, first_message: deps.languages[code].greeting },
        tts: { ...(voice ? { voice_id: voice } : {}), model_id: modelFor(code, s) },
      },
    };
  }
  const base = deps.staticPrompt ?? staticSystemPrompt(deps.salon);
  return {
    name: AGENT_NAME,
    tags: ["cf-hair"],
    conversation_config: {
      asr: { quality: "high", user_input_audio_format: "ulaw_8000", keywords: [...SPEECH_HINTS.split(","), ...SERVICE_HINTS, ...MULTILINGUAL_HINTS] },
      // No canned English fillers ("Alright, I'll jump in") while the model thinks: they ignore the
      // caller's language.
      // "normal" eagerness: a short pause mid-sentence is not taken as the end of the caller's turn.
      turn: { turn_timeout: 7, turn_eagerness: deps.config.elevenAgentEagerness, speculative_turn: true, soft_timeout_config: { timeout_seconds: -1 } },
      tts: {
        model_id: s.englishModel,
        ...(en ? { voice_id: en } : {}),
        agent_output_audio_format: "ulaw_8000",
        optimize_streaming_latency: deps.config.elevenAgentLatency,
      },
      conversation: { max_duration_seconds: 600 },
      language_presets: presets,
      agent: {
        first_message: newCallerGreeting(deps.config.welcomeGreeting, s),
        language: "en",
        prompt: {
          prompt: `${base}\n\n${agentNote(deps)}`,
          llm: opts.llm,
          temperature: 0.3,
          tools: agentTools(opts),
          built_in_tools: {
            end_call: {
              name: "end_call",
              description: "Hang up. Call it in the same reply as your goodbye, right after the goodbye words: the call ends once they have been spoken. Never wait for the caller to say goodbye back.",
              pre_tool_speech: "off",
              params: { system_tool_type: "end_call" },
            },
            language_detection: {
              name: "language_detection",
              description:
                "Switch to the language the caller is speaking: English, Mandarin, Cantonese or Korean. Use it in the caller's first turns. Once the call is in Mandarin or Cantonese, never use it to move between those two because of a word, an accent or a short reply; only if the caller asks for the other one in words (講廣東話, 说普通话).",
              pre_tool_speech: "off",
              // Only in the caller's first two turns, so a word in another language later on does not
              // flip the call (ElevenLabs' "Only at start of conversation").
              params: { system_tool_type: "language_detection", ...(s.detectionOnlyAtStart ? { only_at_conversation_start: true } : {}) },
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
  if (!r.ok) throw Object.assign(new Error(`ElevenLabs ${method} ${path} failed: ${r.status} ${text.slice(0, 2000)}`), { status: r.status, body: text });
  const type = r.headers.get("content-type") ?? "";
  return (type.includes("json") ? JSON.parse(text) : text) as T;
}

/** The TTS model for a call language under these settings. */
function modelFor(code: LanguageCode, s: AgentSettings): string {
  return code === "en-US" ? s.englishModel : code === "zh-CN" ? s.mandarinModel : code === "zh-HK" ? MODEL_CANTONESE : MODEL_FAST;
}

/**
 * Creates the agent, or updates the one with our name, so its settings always match this code. A
 * setting ElevenLabs refuses is narrowed and the save retried, with ElevenLabs' exact reply logged:
 * Eleven v4 Turbo for English falls back to eleven_turbo_v2 (and for Mandarin to Flash v2.5), the
 * Cantonese language ("yue") is dropped (Cantonese then runs on the Mandarin setting), "only at
 * conversation start" for language detection is dropped, and a voice missing from the account is
 * left out. Returns the agent id and what it was set up with.
 */
export async function upsertAgent(deps: SessionDeps, opts: ElevenAgentOptions): Promise<{ agentId: string; settings: AgentSettings }> {
  const list = await el<{ agents?: { agent_id: string; name: string }[] }>(opts, "GET", `/v1/convai/agents?${new URLSearchParams({ search: AGENT_NAME, page_size: "30" })}`);
  const existing = list.agents?.find((a) => a.name === AGENT_NAME);
  const s = requestedSettings(opts);
  const refused = (what: string, err: Error) => console.warn(`[eleven] ElevenLabs refused ${what}; retrying without it. ElevenLabs said: ${err.message}`);
  for (let attempt = 0; ; attempt++) {
    try {
      const body = agentConfig(deps, opts, s);
      let agentId: string;
      if (existing) {
        await el(opts, "PATCH", `/v1/convai/agents/${encodeURIComponent(existing.agent_id)}`, body);
        agentId = existing.agent_id;
      } else {
        agentId = (await el<{ agent_id: string }>(opts, "POST", "/v1/convai/agents/create", body)).agent_id;
      }
      return { agentId, settings: s };
    } catch (err) {
      const e = err as Error & { status?: number };
      const msg = e.message;
      const status = e.status ?? 0;
      if (attempt >= 8 || status < 400 || status >= 500) throw err;
      // A voice that is not in the account fails the whole agent: leave it out (ElevenLabs' default
      // voice is used for that language) and say which one, so it can be added under My Voices.
      const voice = /voice_id (\w+) was not found/.exec(msg);
      if (voice && !missingVoices.has(voice[1])) {
        missingVoices.add(voice[1]);
        console.warn(`[eleven] voice ${voice[1]} is not in this ElevenLabs account (add it under Voices > My Voices); using the default voice for now`);
        continue;
      }
      if (s.detectionOnlyAtStart && /only_at_conversation_start|built_in_tools|language_detection|system_tool/i.test(msg)) {
        refused('"only at conversation start" for language detection', e);
        s.detectionOnlyAtStart = false;
        continue;
      }
      const aboutModel = /model/i.test(msg) || /eleven_(v\d|turbo|flash|multilingual)/i.test(msg);
      if (aboutModel && s.englishModel !== MODEL_ENGLISH_FALLBACK && /english|\ben\b|tts\.model_id|"tts"/i.test(msg)) {
        refused(`${s.englishModel} for English (using ${MODEL_ENGLISH_FALLBACK})`, e);
        s.englishModel = MODEL_ENGLISH_FALLBACK;
        continue;
      }
      if (s.cantoneseCode && (new RegExp(`cantonese|"${s.cantoneseCode}"|\\b${s.cantoneseCode}\\b`, "i").test(msg) || (!aboutModel && /language/i.test(msg)))) {
        refused(`the Cantonese language "${s.cantoneseCode}" (Cantonese callers use the Mandarin setting with the Cantonese voice)`, e);
        s.cantoneseCode = "";
        continue;
      }
      if (aboutModel && s.englishModel !== MODEL_ENGLISH_FALLBACK) {
        refused(`${s.englishModel} for English (using ${MODEL_ENGLISH_FALLBACK})`, e);
        s.englishModel = MODEL_ENGLISH_FALLBACK;
        continue;
      }
      if (aboutModel && s.mandarinModel !== MODEL_FAST) {
        refused(`${s.mandarinModel} for Mandarin (using ${MODEL_FAST})`, e);
        s.mandarinModel = MODEL_FAST;
        continue;
      }
      throw err;
    }
  }
}

/** Reads the saved agent back and says what ElevenLabs kept, so a silently dropped setting shows. */
export async function describeAgent(opts: ElevenAgentOptions, agentId: string, asked: AgentSettings): Promise<string> {
  const a = await el<any>(opts, "GET", `/v1/convai/agents/${encodeURIComponent(agentId)}`);
  const cc = a?.conversation_config ?? {};
  const presets = cc.language_presets ?? {};
  const detection = cc.agent?.prompt?.built_in_tools?.language_detection;
  const onlyAtStart = JSON.stringify(detection ?? {}).includes('"only_at_conversation_start":true');
  const parts = [
    `English model ${cc.tts?.model_id ?? "?"}`,
    `Mandarin ${presets.zh?.overrides?.tts?.model_id ?? "?"}`,
    asked.cantoneseCode ? `Cantonese "${asked.cantoneseCode}" ${presets[asked.cantoneseCode] ? `kept (${presets[asked.cantoneseCode]?.overrides?.tts?.model_id ?? "?"})` : "NOT kept"}` : "Cantonese on the Mandarin setting",
    `language detection ${detection ? (onlyAtStart ? "only at conversation start" : asked.detectionOnlyAtStart ? "on, but ElevenLabs did NOT keep only-at-start (turn it on in the agent's Tools tab)" : "on, any time") : "missing"}`,
  ];
  return parts.join("; ");
}

/** Per-call state for the tool webhooks: the caller and the same tool code as the main line. */
interface ElevenCall {
  executor: ToolExecutor;
  log: CallLog;
  phone: string | null;
  language: LanguageCode;
  created: number;
  /** A Chinese language chosen during this call (not the saved one the call opened in). */
  chineseChosen?: LanguageCode;
  /** A switch to the other Chinese, refused once: asked again, it goes through. */
  chineseSwitchAsked?: LanguageCode;
}

export class ElevenLine {
  private agentId: Promise<string> | null = null;
  /** What the agent was set up with (after any refused setting was dropped). */
  private settings: AgentSettings;
  private readonly calls = new Map<string, ElevenCall>();
  private readonly secret: string;

  constructor(
    private readonly deps: SessionDeps,
    private readonly opts: ElevenAgentOptions,
    secret: string,
  ) {
    this.secret = secret;
    this.settings = requestedSettings(opts);
  }

  /** Sets up the agent (once; retried on the next call if it failed). */
  ready(): Promise<string> {
    if (!this.agentId) {
      const t0 = Date.now();
      this.agentId = upsertAgent(this.deps, this.opts).then(
        ({ agentId: id, settings }) => {
          this.settings = settings;
          console.log(`[eleven] agent ready: ${id} (${this.opts.llm}) in ${Date.now() - t0}ms`);
          describeAgent(this.opts, id, settings).then(
            (d) => console.log(`[eleven] agent settings as saved: ${d}`),
            (err) => console.warn(`[eleven] could not read the agent back: ${(err as Error).message}`),
          );
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
    // Every call that opens in English ends its greeting with 你好, returning English callers too (a
    // shared phone, a family member who speaks Chinese); a caller saved as Chinese hears their own.
    const greeting = language === "en-US" ? newCallerGreeting(deps.config.welcomeGreeting, this.settings) : deps.languages[language].greeting;
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
          agent: { language: agentLanguage(language, this.settings.cantoneseCode), first_message: greeting },
          ...(language !== "en-US" ? { tts: { ...(voice ? { voice_id: voice } : {}), model_id: modelFor(language, this.settings) } } : {}),
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
    const arg = name === "set_language" ? ` ${String(input.language ?? "")}${res.isError ? " refused" : ""}` : "";
    console.log(`[eleven call ${callSid}] tool ${name}${arg}${res.isError && !arg ? " (error)" : ""} in ${Date.now() - t0}ms`);
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
        // Mandarin and Cantonese are told apart once, early in the call. After that the model tends to
        // drift between them; a switch to the other one goes through only if it is asked for again
        // (the caller insisting, or asking in words), not on the first slip.
        const chinese = (c: LanguageCode) => c === "zh-CN" || c === "zh-HK";
        if (chinese(code) && call.chineseChosen && call.chineseChosen !== code && call.chineseSwitchAsked !== code) {
          call.chineseSwitchAsked = code;
          const now = deps.languages[call.chineseChosen].englishName;
          return {
            saved: "skipped",
            refused: `this call is in ${now}. Mandarin and Cantonese were settled at the start; switch only if the caller asks for the other one in words (then call set_language again)`,
          };
        }
        if (chinese(code)) call.chineseChosen = code;
        call.chineseSwitchAsked = undefined;
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
