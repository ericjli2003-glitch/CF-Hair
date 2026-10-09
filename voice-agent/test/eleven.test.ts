import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import twilio from "twilio";
import { createServer } from "../src/server.js";
import { AGENT_NAME, agentLanguage, toolKeyFor } from "../src/eleven/agent.js";
import { testDeps, waitFor } from "./helpers.js";

const AUTH = "test_auth_token";
const PUBLIC = "https://voice.test";
const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

/** Stand-in for the ElevenLabs API: agents list/create/update and Twilio register-call. */
async function fakeEleven(opts: { existing?: boolean; refuseCantonese?: boolean; missingVoice?: string; refuseEnglishV4?: boolean; refuseOnlyAtStart?: boolean } = {}) {
  const seen: { method: string; path: string; key: string; body: any }[] = [];
  let saved: any = null;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method!, path: req.url!, key: String(req.headers["xi-api-key"] ?? ""), body });
      const json = (status: number, v: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (req.method === "GET" && req.url!.startsWith("/v1/convai/agents?")) {
        return json(200, { agents: opts.existing ? [{ agent_id: "agent_old", name: AGENT_NAME }] : [], has_more: false });
      }
      if (req.method === "GET" && req.url!.startsWith("/v1/convai/agents/agent_")) return json(200, saved ?? {});
      if (req.url === "/v1/convai/agents/create" || req.url!.startsWith("/v1/convai/agents/agent_")) {
        if (opts.refuseCantonese && body?.conversation_config?.language_presets?.yue) return json(422, { detail: "Unsupported language: yue" });
        if (opts.refuseEnglishV4 && body?.conversation_config?.tts?.model_id === "eleven_v4_turbo") {
          return json(400, { detail: { status: "invalid_tts_model", message: "English Agents must use turbo or flash v2." } });
        }
        if (opts.refuseOnlyAtStart && JSON.stringify(body).includes("only_at_conversation_start")) {
          return json(422, { detail: [{ loc: ["body", "conversation_config", "agent", "prompt", "built_in_tools", "language_detection", "params", "only_at_conversation_start"], msg: "Extra inputs are not permitted" }] });
        }
        if (opts.missingVoice && JSON.stringify(body).includes(opts.missingVoice)) {
          return json(400, { detail: { type: "not_found", code: "voice_not_found", message: `A voice for the voice_id ${opts.missingVoice} was not found.` } });
        }
        saved = body;
        return json(200, { agent_id: opts.existing ? "agent_old" : "agent_new" });
      }
      if (req.url === "/v1/convai/twilio/register-call") {
        res.writeHead(200, { "content-type": "application/xml" });
        return res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://api.elevenlabs.io/x"/></Connect></Response>');
      }
      json(404, { detail: "not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => server.close());
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

async function start(base: string, extra: Record<string, unknown> = {}) {
  const deps = testDeps();
  Object.assign(deps.config, { elevenAgentApiKey: "el-key", elevenLabsApiBase: base, publicBaseUrl: PUBLIC, ...extra });
  const { server } = createServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => server.close());
  return { deps, port: (server.address() as AddressInfo).port };
}

const incoming = (port: number, params: Record<string, string>) =>
  fetch(`http://127.0.0.1:${port}/eleven/twiml`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, `${PUBLIC}/eleven/twiml`, params) },
    body: new URLSearchParams(params),
  });

describe("ElevenLabs phone agent line", () => {
  it("creates the agent on startup with the salon prompt, voices, tools and phone audio", async () => {
    const el = await fakeEleven();
    await start(el.base);
    await waitFor(() => el.seen.some((s) => s.path === "/v1/convai/agents/create"));
    const create = el.seen.find((s) => s.path === "/v1/convai/agents/create")!;
    expect(create.key).toBe("el-key");
    const cc = create.body.conversation_config;
    expect(create.body.name).toBe(AGENT_NAME);
    expect(cc.asr.user_input_audio_format).toBe("ulaw_8000");
    expect(cc.asr.keywords).toEqual(expect.arrayContaining(["men's cut", "Henderson Place"]));
    // Salon words in Cantonese, Mandarin and Korean help recognition too.
    expect(cc.asr.keywords).toEqual(expect.arrayContaining(["飛髮", "理发", "离子烫", "다운펌"]));
    // The prompt tells the model how each service is asked for in every language.
    expect(cc.agent.prompt.prompt).toContain("男士理发");
    expect(cc.agent.prompt.prompt).toContain("負離子");
    expect(cc.agent.prompt.prompt).toContain("남자 커트");
    expect(cc.tts.agent_output_audio_format).toBe("ulaw_8000");
    expect(cc.agent.prompt.llm).toBe("claude-haiku-4-5");
    expect(cc.agent.prompt.prompt).toContain("{{call_context}}");
    expect(cc.agent.prompt.prompt).toContain("Henderson Place");
    // Cantonese as its own language, Eleven v4 Turbo for English, Mandarin and Cantonese.
    expect(Object.keys(cc.language_presets).sort()).toEqual(["ko", "yue", "zh"]);
    expect(cc.language_presets.zh.overrides.tts.model_id).toBe("eleven_v4_turbo");
    expect(cc.language_presets.yue.overrides.tts.model_id).toBe("eleven_v4_turbo");
    expect(cc.tts.model_id).toBe("eleven_v4_turbo");
    // Language detection switches only in the caller's first two turns.
    expect(cc.agent.prompt.built_in_tools.language_detection.params).toEqual({ system_tool_type: "language_detection", only_at_conversation_start: true });
    expect(cc.turn.turn_eagerness).toBe("normal");
    // Spoken Hong Kong Cantonese, not standard written Chinese; never announce a switch.
    expect(cc.agent.prompt.prompt).toContain("好呀，聽日幾點方便呀？");
    expect(cc.agent.prompt.prompt).toContain("never name the language");
    expect(cc.agent.first_message).toBe("Hi, CF Hair Salon. 你好！");
    expect(cc.agent.prompt.built_in_tools.end_call.description).toContain("same reply as your goodbye");
    expect(cc.agent.prompt.prompt).toContain("A men's cut at three. Is this for Eric?");
    expect(cc.agent.prompt.prompt).not.toContain("for a man, at three");
    // Full questions for the time and the name, in every language.
    expect(cc.agent.prompt.prompt).toContain("How does three o'clock sound?");
    expect(cc.agent.prompt.prompt).toContain("三点钟怎么样？");
    expect(cc.agent.prompt.prompt).toContain("係咪幫Eric約呀？");
    expect(cc.agent.prompt.prompt).toContain("您想什么时候过来？");
    expect(cc.agent.prompt.prompt).toContain("你想幾時過嚟呀？");
    expect(cc.agent.prompt.prompt).toContain("男士剪髮，三點鐘。係咪幫Eric約呀？");
    expect(cc.agent.prompt.prompt).toContain("Once a caller speaks Mandarin, every reply is Mandarin");
    // The time comes first, before men's or women's.
    expect(cc.agent.prompt.prompt).toContain('1. Time first: unless the caller already said when, your first question is always "When would you like to come in?"');
    expect(cc.asr.keywords).toEqual(expect.arrayContaining(["for a man", "for a woman"]));
    expect(cc.tts.optimize_streaming_latency).toBe(1);
    const names = cc.agent.prompt.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["check_availability", "book_appointment", "take_message", "set_language"]));
    expect(names).not.toContain("transfer_to_human");
    const book = cc.agent.prompt.tools.find((t: { name: string }) => t.name === "book_appointment");
    expect(book.api_schema.url).toBe(`${PUBLIC}/eleven/tools/book_appointment`);
    expect(book.pre_tool_speech).toBe("off");
    expect(book.api_schema.request_headers["x-cf-tool-key"]).toBe(toolKeyFor(AUTH));
    expect(book.api_schema.request_body_schema.properties.call_sid).toEqual({ type: "string", dynamic_variable: "call_sid" });
    expect(book.api_schema.request_body_schema.properties.service_id.description).toBeTruthy();
    expect(cc.agent.prompt.built_in_tools.end_call.params.system_tool_type).toBe("end_call");
    // No English filler lines on a Chinese or Korean call.
    expect(cc.turn.soft_timeout_config).toEqual({ timeout_seconds: -1 });
    expect(cc.agent.prompt.built_in_tools.language_detection.pre_tool_speech).toBe("off");
  });

  it("updates the existing agent instead of making a second one, and drops Cantonese if refused", async () => {
    const el = await fakeEleven({ existing: true, refuseCantonese: true });
    await start(el.base, { elevenAgentCantoneseCode: "yue" });
    await waitFor(() => el.seen.filter((s) => s.method === "PATCH").length === 2);
    const patches = el.seen.filter((s) => s.method === "PATCH");
    expect(patches[0].path).toBe("/v1/convai/agents/agent_old");
    expect(patches[1].body.conversation_config.language_presets.yue).toBeUndefined();
    expect(el.seen.some((s) => s.path === "/v1/convai/agents/create")).toBe(false);
  });

  it("registers an incoming call with the caller's context and returns ElevenLabs' TwiML", async () => {
    const el = await fakeEleven();
    const { port } = await start(el.base);
    const res = await incoming(port, { CallSid: "CA_el1", From: "+16045550777", To: "+12365550100" });
    expect(await res.text()).toContain("wss://api.elevenlabs.io/x");
    const reg = el.seen.find((s) => s.path === "/v1/convai/twilio/register-call")!;
    expect(reg.body).toMatchObject({ agent_id: "agent_new", from_number: "+16045550777", to_number: "+12365550100", direction: "inbound" });
    const vars = reg.body.conversation_initiation_client_data.dynamic_variables;
    expect(vars.call_sid).toBe("CA_el1");
    expect(vars.caller_phone).toBe("+16045550777");
    expect(vars.call_context).toContain("Current date and time");
    // New callers hear 你好 after the English greeting, so Chinese speakers answer in Chinese.
    expect(reg.body.conversation_initiation_client_data.conversation_config_override.agent).toEqual({ language: "en", first_message: "Hi, CF Hair Salon. 你好！" });
  });

  it("runs the booking tools for the agent, and refuses calls without the keys", async () => {
    const el = await fakeEleven();
    const { port } = await start(el.base);
    await incoming(port, { CallSid: "CA_el2", From: "+16045550189", To: "+12365550100" });
    const reg = el.seen.find((s) => s.path === "/v1/convai/twilio/register-call")!;
    const callKey = reg.body.conversation_initiation_client_data.dynamic_variables.call_key;
    const tool = (name: string, body: Record<string, unknown>, key = toolKeyFor(AUTH)) =>
      fetch(`http://127.0.0.1:${port}/eleven/tools/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cf-tool-key": key },
        body: JSON.stringify({ call_sid: "CA_el2", call_key: callKey, caller_phone: "+16045550189", ...body }),
      });
    const avail: any = await (await tool("check_availability", { service_id: "mens-cut", date: "2026-10-08" })).json();
    const slots = avail.slots ?? avail.openings ?? avail.available;
    expect(slots.length).toBeGreaterThan(0);
    const booked: any = await (
      await tool("book_appointment", { service_id: "mens-cut", start: slots[0].start, customer_name: "Eleven Test", confirmed_with_caller: true })
    ).json();
    expect(booked.ok).toBe(true);
    expect((await tool("get_services", {}, "wrong")).status).toBe(401);
    const forged = await fetch(`http://127.0.0.1:${port}/eleven/tools/get_services`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cf-tool-key": toolKeyFor(AUTH) },
      body: JSON.stringify({ call_sid: "CA_el2", call_key: "forged" }),
    });
    expect(forged.status).toBe(403);
  });

  it("opens a returning Cantonese caller on the Mandarin setting with the Cantonese voice model when there is no Cantonese language", async () => {
    const el = await fakeEleven();
    const { port } = await start(el.base, { elevenAgentCantoneseCode: "" });
    await incoming(port, { CallSid: "CA_el_yue", From: "+16045550188", To: "+12365550100" });
    const reg = el.seen.find((s) => s.path === "/v1/convai/twilio/register-call")!;
    const o = reg.body.conversation_initiation_client_data.conversation_config_override;
    expect(o.agent.language).toBe("zh");
    expect(o.agent.first_message).toBe("你好，CF Hair Salon。");
    expect(o.tts.model_id).toBe("eleven_v4_turbo");
  });

  it("keeps Mandarin once chosen: a first slip to Cantonese is refused, asking again goes through", async () => {
    const el = await fakeEleven();
    const { port } = await start(el.base);
    await incoming(port, { CallSid: "CA_el_lock", From: "+16045550190", To: "+12365550100" });
    const reg = el.seen.find((s) => s.path === "/v1/convai/twilio/register-call")!;
    const callKey = reg.body.conversation_initiation_client_data.dynamic_variables.call_key;
    const setLanguage = async (language: string) =>
      (await (
        await fetch(`http://127.0.0.1:${port}/eleven/tools/set_language`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-cf-tool-key": toolKeyFor(AUTH) },
          body: JSON.stringify({ call_sid: "CA_el_lock", call_key: callKey, caller_phone: "+16045550190", language }),
        })
      ).json()) as any;
    expect((await setLanguage("zh-CN")).ok).toBe(true);
    const slip = await setLanguage("zh-HK");
    expect(slip.ok).not.toBe(true);
    expect(JSON.stringify(slip)).toContain("settled at the start");
    expect((await setLanguage("zh-HK")).ok).toBe(true); // asked again: the caller means it
    expect((await setLanguage("en-US")).ok).toBe(true); // English is never held back
  });

  it("greets a returning English caller with 你好 too", async () => {
    const el = await fakeEleven();
    const { port, deps } = await start(el.base);
    await deps.callers.beginCall("+16045550191"); // has called before
    await incoming(port, { CallSid: "CA_el_ret", From: "+16045550191", To: "+12365550100" });
    const o = el.seen.find((s) => s.path === "/v1/convai/twilio/register-call")!.body.conversation_initiation_client_data.conversation_config_override;
    expect(o.agent).toEqual({ language: "en", first_message: "Hi, CF Hair Salon. 你好！" });
  });

  it("opens a returning Cantonese caller in Cantonese (yue) with Eleven v4 Turbo", async () => {
    const el = await fakeEleven();
    const { port } = await start(el.base);
    await incoming(port, { CallSid: "CA_el_yue2", From: "+16045550188", To: "+12365550100" });
    const o = el.seen.find((s) => s.path === "/v1/convai/twilio/register-call")!.body.conversation_initiation_client_data.conversation_config_override;
    expect(o.agent.language).toBe("yue");
    expect(o.tts.model_id).toBe("eleven_v4_turbo");
  });

  it("falls back to eleven_turbo_v2 for English when ElevenLabs refuses Eleven v4 Turbo, logging its reply", async () => {
    const el = await fakeEleven({ refuseEnglishV4: true });
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => void warned.push(a.join(" "));
    try {
      await start(el.base);
      await waitFor(() => el.seen.filter((s) => s.path === "/v1/convai/agents/create").length === 2);
    } finally {
      console.warn = warn;
    }
    const [first, second] = el.seen.filter((s) => s.path === "/v1/convai/agents/create");
    expect(first.body.conversation_config.tts.model_id).toBe("eleven_v4_turbo");
    expect(second.body.conversation_config.tts.model_id).toBe("eleven_turbo_v2");
    // Only English changes: Cantonese stays.
    expect(second.body.conversation_config.language_presets.yue).toBeTruthy();
    expect(warned.join("\n")).toContain("English Agents must use turbo or flash v2.");
    // An English-only voice cannot read 你好: it gets the sound written out.
    expect(second.body.conversation_config.agent.first_message).toBe("Hi, CF Hair Salon. Nee how!");
  });

  it("drops only-at-start language detection if ElevenLabs refuses it, and says so", async () => {
    const el = await fakeEleven({ refuseOnlyAtStart: true });
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => void warned.push(a.join(" "));
    try {
      await start(el.base);
      await waitFor(() => el.seen.filter((s) => s.path === "/v1/convai/agents/create").length === 2);
    } finally {
      console.warn = warn;
    }
    const second = el.seen.filter((s) => s.path === "/v1/convai/agents/create")[1];
    expect(second.body.conversation_config.agent.prompt.built_in_tools.language_detection.params).toEqual({ system_tool_type: "language_detection" });
    expect(second.body.conversation_config.language_presets.yue).toBeTruthy();
    expect(warned.join("\n")).toContain("Extra inputs are not permitted");
  });

  it("registers Cantonese callers on the Mandarin setting after ElevenLabs refused yue", async () => {
    const el = await fakeEleven({ refuseCantonese: true });
    const { port } = await start(el.base);
    await waitFor(() => el.seen.filter((s) => s.path === "/v1/convai/agents/create").length === 2);
    await incoming(port, { CallSid: "CA_el_yue3", From: "+16045550188", To: "+12365550100" });
    const o = el.seen.find((s) => s.path === "/v1/convai/twilio/register-call")!.body.conversation_initiation_client_data.conversation_config_override;
    expect(o.agent.language).toBe("zh");
    expect(o.tts.model_id).toBe("eleven_v4_turbo");
  });

  it("reads the agent back and logs what ElevenLabs kept", async () => {
    const el = await fakeEleven();
    const logged: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      await start(el.base);
      await waitFor(() => logged.some((l) => l.includes("agent settings as saved")));
    } finally {
      console.log = log;
    }
    const line = logged.find((l) => l.includes("agent settings as saved"))!;
    expect(line).toContain("English model eleven_v4_turbo");
    expect(line).toContain('Cantonese "yue" kept (eleven_v4_turbo)');
    expect(line).toContain("language detection only at conversation start");
  });

  it("leaves out a voice that is not in the account instead of failing the agent", async () => {
    const el = await fakeEleven({ missingVoice: "gAMZphRyrWJnLMDnom6H" });
    const deps = testDeps();
    deps.languages["en-US"] = { ...deps.languages["en-US"], voice: "gAMZphRyrWJnLMDnom6H-flash_v2_5" };
    Object.assign(deps.config, { elevenAgentApiKey: "el-key", elevenLabsApiBase: el.base, publicBaseUrl: PUBLIC });
    const { server } = createServer(deps);
    closers.push(() => server.close());
    await waitFor(() => el.seen.filter((s) => s.path === "/v1/convai/agents/create").length === 2);
    const last = el.seen.filter((s) => s.path === "/v1/convai/agents/create")[1];
    expect(last.body.conversation_config.tts.voice_id).toBeUndefined();
  });

  it("maps call languages to ElevenLabs agent languages", () => {
    expect(agentLanguage("zh-HK", "yue")).toBe("yue");
    expect(agentLanguage("zh-HK", "")).toBe("zh");
    expect(agentLanguage("ko-KR", "yue")).toBe("ko");
  });
});

describe("one number: Cantonese callers to Azure, everyone else to ElevenLabs", () => {
  const route = (port: number, params: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/route/twiml`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, `${PUBLIC}/route/twiml`, params) },
      body: new URLSearchParams(params),
    }).then((r) => r.text());

  it("sends a caller saved as Cantonese to the Azure line and others to the ElevenLabs agent", async () => {
    const el = await fakeEleven();
    const { port } = await start(el.base, { azureVoiceLiveEndpoint: "https://az.test", azureVoiceLiveKey: "az-key" });
    // The mock booking API has this number saved as a returning Cantonese caller.
    const cantonese = await route(port, { CallSid: "CA_r1", From: "+16045550188", To: "+12365550100" });
    expect(cantonese).toContain(`<Stream url="wss://voice.test/azure/media">`);
    expect(cantonese).toContain('<Parameter name="startLanguage" value="zh-HK"/>');
    const english = await route(port, { CallSid: "CA_r2", From: "+16045550777", To: "+12365550100" });
    expect(english).toContain("wss://api.elevenlabs.io/x");
  });

  it("sends everyone to ElevenLabs when the Azure line is not set up", async () => {
    const el = await fakeEleven();
    const { port } = await start(el.base);
    expect(await route(port, { CallSid: "CA_r3", From: "+16045550188", To: "+12365550100" })).toContain("wss://api.elevenlabs.io/x");
  });
});
