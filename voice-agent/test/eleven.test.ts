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
async function fakeEleven(opts: { existing?: boolean; refuseCantonese?: boolean } = {}) {
  const seen: { method: string; path: string; key: string; body: any }[] = [];
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
      if (req.url === "/v1/convai/agents/create" || req.url!.startsWith("/v1/convai/agents/agent_")) {
        if (opts.refuseCantonese && body?.conversation_config?.language_presets?.yue) return json(422, { detail: "Unsupported language: yue" });
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

async function start(base: string) {
  const deps = testDeps();
  Object.assign(deps.config, { elevenAgentApiKey: "el-key", elevenLabsApiBase: base, publicBaseUrl: PUBLIC });
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
    expect(cc.tts.agent_output_audio_format).toBe("ulaw_8000");
    expect(cc.agent.prompt.llm).toBe("claude-haiku-4-5");
    expect(cc.agent.prompt.prompt).toContain("{{call_context}}");
    expect(cc.agent.prompt.prompt).toContain("Henderson Place");
    expect(Object.keys(cc.language_presets).sort()).toEqual(["ko", "yue", "zh"]);
    expect(cc.language_presets.yue.overrides.tts.model_id).toBe("eleven_v4_turbo");
    const names = cc.agent.prompt.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["check_availability", "book_appointment", "take_message", "set_language"]));
    expect(names).not.toContain("transfer_to_human");
    const book = cc.agent.prompt.tools.find((t: { name: string }) => t.name === "book_appointment");
    expect(book.api_schema.url).toBe(`${PUBLIC}/eleven/tools/book_appointment`);
    expect(book.api_schema.request_headers["x-cf-tool-key"]).toBe(toolKeyFor(AUTH));
    expect(book.api_schema.request_body_schema.properties.call_sid).toEqual({ type: "string", dynamic_variable: "call_sid" });
    expect(book.api_schema.request_body_schema.properties.service_id.description).toBeTruthy();
    expect(cc.agent.prompt.built_in_tools.end_call.params.system_tool_type).toBe("end_call");
  });

  it("updates the existing agent instead of making a second one, and drops Cantonese if refused", async () => {
    const el = await fakeEleven({ existing: true, refuseCantonese: true });
    await start(el.base);
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
    expect(reg.body.conversation_initiation_client_data.conversation_config_override.agent).toEqual({ language: "en", first_message: "Hi, CF Hair Salon." });
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

  it("maps call languages to ElevenLabs agent languages", () => {
    expect(agentLanguage("zh-HK", "yue")).toBe("yue");
    expect(agentLanguage("zh-HK", "")).toBe("zh");
    expect(agentLanguage("ko-KR", "yue")).toBe("ko");
  });
});
