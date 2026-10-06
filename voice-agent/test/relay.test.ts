import type { AddressInfo } from "node:net";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import twilio from "twilio";
import { createServer } from "../src/server.js";
import { relayToken } from "../src/relay/twiml.js";
import { DEMO_PHONES } from "../src/api/mock.js";
import { FakeLlm, testDeps, waitFor, type ScriptedStep } from "./helpers.js";
import type { StreamParams } from "../src/agent/llm.js";

const AUTH = "test_auth_token";
type Frame = Record<string, any>;

const servers: { close: () => void }[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

async function startServer(script: ScriptedStep[] | ((p: StreamParams, i: number) => ScriptedStep), forward = "") {
  const llm = new FakeLlm(script);
  const deps = testDeps({ llm, forward });
  const { server, wss } = createServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  servers.push({
    close: () => {
      for (const c of wss.clients) c.terminate();
      server.close();
    },
  });
  return { deps, llm, port };
}

async function call(port: number, from: string, callSid = `CA${Math.random().toString(36).slice(2)}`, token?: string, params: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`);
  const frames: Frame[] = [];
  let closeCode: number | null = null;
  ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
  ws.on("close", (code) => (closeCode = code));
  await new Promise((r) => ws.once("open", r));
  ws.send(
    JSON.stringify({
      type: "setup",
      sessionId: "VX1",
      callSid,
      from,
      to: "+16044757705",
      direction: "inbound",
      callType: "PSTN",
      callStatus: "RINGING",
      accountSid: "AC1",
      customParameters: { token: token ?? relayToken(AUTH, callSid), ...params },
    }),
  );
  const send = (m: Frame) => ws.send(JSON.stringify(m));
  return {
    ws,
    frames,
    callSid,
    closeCode: () => closeCode,
    prompt: (text: string) => send({ type: "prompt", voicePrompt: text, lang: "en-US", last: true }),
    texts: () => frames.filter((f) => f.type === "text"),
    lastCount: () => frames.filter((f) => f.type === "text" && f.last).length,
    send,
  };
}

function signedPost(port: number, path: string, params: Record<string, string>, sign = true) {
  const url = `http://127.0.0.1:${port}${path}`;
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (sign) headers["x-twilio-signature"] = twilio.getExpectedTwilioSignature(AUTH, url, params);
  return fetch(url, { method: "POST", headers, body: new URLSearchParams(params) });
}

describe("Twilio webhooks", () => {
  it("rejects unsigned webhooks and returns ConversationRelay TwiML for signed ones", async () => {
    const { port } = await startServer([]);
    const unsigned = await signedPost(port, "/twiml", { CallSid: "CA1", From: "+16045550123" }, false);
    expect(unsigned.status).toBe(403);

    const res = await signedPost(port, "/twiml", { CallSid: "CA1", From: "+16045550123" });
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Connect action=\"http://127.0.0.1:");
    expect(xml).toContain("<ConversationRelay");
    expect(xml).toContain(`url="ws://127.0.0.1:${port}/relay"`);
    expect(xml).toContain(`welcomeGreeting="Hi, CF Hair Salon. I'm the virtual assistant."`);
    expect(xml).toContain('language="en-US"');
    expect(xml).toContain('<Parameter name="startLanguage" value="en-US"/>');
    expect(xml).toContain('<Parameter name="opening" value="welcome"/>');
    expect(xml).toContain('interruptible="any"');
    for (const code of ["en-US", "zh-CN", "zh-HK", "ko-KR"]) expect(xml).toContain(`<Language code="${code}"`);
    expect(xml).toContain(`<Parameter name="token" value="${relayToken(AUTH, "CA1")}"/>`);
  });

  it("opens a returning Cantonese caller's call in Cantonese: greeting, voice and speech recognition", async () => {
    const { port, deps } = await startServer([]);
    const xml = await (await signedPost(port, "/twiml", { CallSid: "CA4", From: DEMO_PHONES.returningCantonese })).text();
    const zh = deps.languages["zh-HK"];
    expect(xml).toContain(`welcomeGreeting="${zh.greeting}"`);
    expect(xml).toMatch(/<ConversationRelay[^>]* language="zh-HK"/);
    expect(xml).toMatch(new RegExp(`<ConversationRelay[^>]* voice="${zh.voice}"`));
    expect(xml).toContain('<Parameter name="startLanguage" value="zh-HK"/>');
    expect(xml).toContain('<Parameter name="opening" value="returning"/>');
    // Looking up the caller does not count the call; the session does that once.
    expect(deps.mockApi!.callers.get(DEMO_PHONES.returningCantonese)?.callCount).toBe(3);
  });

  it("opens in English when the website is down", async () => {
    const { port, deps } = await startServer([]);
    deps.mockApi!.offline = true;
    const xml = await (await signedPost(port, "/twiml", { CallSid: "CA5", From: DEMO_PHONES.returningCantonese })).text();
    expect(xml).toMatch(/<ConversationRelay[^>]* language="en-US"/);
    expect(xml).toContain('<Parameter name="opening" value="welcome"/>');
  });

  it("passes Twilio's ForwardedFrom through to the session for the transfer loop guard", async () => {
    const { port } = await startServer([]);
    const xml = await (await signedPost(port, "/twiml", { CallSid: "CA2", From: "+16045550123", ForwardedFrom: "+16044757705" })).text();
    expect(xml).toContain('<Parameter name="forwardedFrom" value="+16044757705"/>');
    const plain = await (await signedPost(port, "/twiml", { CallSid: "CA3", From: "+16045550123" })).text();
    expect(plain).not.toContain('name="forwardedFrom"');
  });

  it("dials the salon on a live-agent handoff and hangs up otherwise", async () => {
    const { port } = await startServer([], "+16045559999");
    const handoff = JSON.stringify({ reasonCode: "live-agent-handoff", summary: "wants owner" });
    const xml = await (await signedPost(port, "/twiml/action", { CallSid: "CA1", HandoffData: handoff })).text();
    expect(xml).toMatch(/<Dial[^>]*action="http:\/\/127\.0\.0\.1:\d+\/twiml\/dial-status"[^>]*><Number>\+16045559999<\/Number><\/Dial>/);
    const bye = await (await signedPost(port, "/twiml/action", { CallSid: "CA1", HandoffData: JSON.stringify({ reasonCode: "end-call" }) })).text();
    expect(bye).toContain("<Hangup/>");
    const noAnswer = await (await signedPost(port, "/twiml/dial-status", { CallSid: "CA1", DialCallStatus: "no-answer" })).text();
    expect(noAnswer).toContain("<ConversationRelay");
    expect(noAnswer).toContain('<Parameter name="resume" value="transfer_failed"/>');
    expect(noAnswer).toMatch(/<ConversationRelay[^>]* language="en-US"/);
  });

  it("brings a missed transfer back in the caller's language", async () => {
    const { port, deps } = await startServer([], "+16045559999");
    const handoff = JSON.stringify({ reasonCode: "live-agent-handoff", summary: "wants owner", language: "zh-HK" });
    const xml = await (await signedPost(port, "/twiml/action", { CallSid: "CA1", HandoffData: handoff })).text();
    expect(xml).toMatch(/<Dial[^>]*action="http:\/\/127\.0\.0\.1:\d+\/twiml\/dial-status\?lang=zh-HK"/);
    const back = await (await signedPost(port, "/twiml/dial-status?lang=zh-HK", { CallSid: "CA1", DialCallStatus: "busy" })).text();
    expect(back).toMatch(/<ConversationRelay[^>]* language="zh-HK"/);
    expect(back).toContain(`welcomeGreeting="${deps.languages["zh-HK"].transferFailed}"`);
    expect(back).toContain('<Parameter name="opening" value="transfer_failed"/>');
  });
});

describe("ConversationRelay WebSocket protocol", () => {
  it("rejects a session with a bad token", async () => {
    const { port } = await startServer([]);
    const c = await call(port, "+16045550123", "CA1", "forged");
    await waitFor(() => c.closeCode() !== null);
    expect(c.closeCode()).toBe(1008);
  });

  it("streams the reply sentence by sentence and marks the last token", async () => {
    const { port, llm } = await startServer([{ text: "Sure, I can help with that. What day works for you? We are open until six today." }]);
    const c = await call(port, "+16045550123");
    c.prompt("Hi, I'd like to book a haircut.");
    await waitFor(() => c.lastCount() === 1);
    const texts = c.texts();
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(texts.slice(0, -1).every((t) => t.last === false)).toBe(true);
    expect(texts.at(-1)!.last).toBe(true);
    expect(texts.every((t) => t.lang === "en-US")).toBe(true);
    expect(texts.map((t) => t.token).join("").replace(/\s+/g, " ").trim()).toBe(
      "Sure, I can help with that. What day works for you? We are open until six today.",
    );
    // Prompt caching: static system block cached, per-call context after it, automatic tail caching on.
    const req = llm.requests[0];
    const system = req.system as { text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toMatchObject({ type: "ephemeral" });
    expect(system[1].cache_control).toBeUndefined();
    expect(req.cache_control).toEqual({ type: "ephemeral" });
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.thinking).toEqual({ type: "between_tools" }); // no extended thinking: faster first words
  });

  it("aborts on interrupt and trims history to what the caller heard", async () => {
    const long = "Sure. We have openings at ten. We also have eleven. There is twelve thirty too. And on Friday there is lots of room.";
    const { port, llm } = await startServer([{ text: long, wordDelayMs: 40 }, { text: "Great, two o'clock then?" }]);
    const c = await call(port, "+16045550123");
    c.prompt("What times do you have tomorrow?");
    await waitFor(() => c.texts().some((t) => String(t.token).includes("openings at ten")));
    c.send({ type: "interrupt", utteranceUntilInterrupt: "Sure. We have openings at", durationUntilInterruptMs: 1400 });
    c.prompt("Actually, do you have two?");
    await waitFor(() => c.lastCount() >= 1 && llm.requests.length === 2);
    await waitFor(() => c.texts().some((t) => t.token.includes("two o'clock")));
    const spokenSoFar = c.texts().map((t) => t.token).join("");
    expect(spokenSoFar).not.toContain("Friday");

    const msgs = llm.requests[1].messages;
    const assistant = msgs.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toEqual([{ type: "text", text: "Sure. We have openings at..." }]);
    expect(msgs.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "Actually, do you have two?" }] });
  });

  it("switches language on keypad 3 and remembers it", async () => {
    const { port, deps } = await startServer([]);
    const c = await call(port, "+16045550177");
    await new Promise((r) => setTimeout(r, 50));
    c.send({ type: "dtmf", digit: "3" });
    await waitFor(() => c.lastCount() === 1);
    expect(c.frames.find((f) => f.type === "language")).toEqual({ type: "language", ttsLanguage: "zh-HK", transcriptionLanguage: "zh-HK" });
    expect(c.texts().at(-1)).toMatchObject({ lang: "zh-HK", last: true });
    await waitFor(() => deps.mockApi!.callers.get("+16045550177")?.preferredLanguage === "zh-HK");
  });

  it("continues a call that opened in Cantonese without an extra line, and switches back on request", async () => {
    const { port, llm } = await startServer([
      { text: "好呀，聽日下晝有位。" },
      { tools: [{ name: "set_language", input: { language: "en-US" } }] },
      { text: "Sure, English." },
    ]);
    // Twilio already played the Cantonese greeting from the TwiML (checked above).
    const c = await call(port, DEMO_PHONES.returningCantonese, undefined, undefined, { startLanguage: "zh-HK", opening: "returning" });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.frames).toEqual([]);

    c.prompt("我想約聽日剪頭髮");
    await waitFor(() => c.lastCount() === 1);
    expect(c.texts().at(-1)!.lang).toBe("zh-HK");
    const ctx = (llm.requests[0].system as { text: string }[])[1].text;
    expect(ctx).toContain("Current call language: zh-HK");
    expect(ctx).toContain("Saved language preference: zh-HK");

    // Caller answers in English: the model switches back.
    c.prompt("Sorry, can we speak English?");
    await waitFor(() => c.lastCount() === 2);
    expect(c.frames.filter((f) => f.type === "language").at(-1)).toEqual({ type: "language", ttsLanguage: "en-US", transcriptionLanguage: "en-US" });
    expect(c.texts().at(-1)!.lang).toBe("en-US");
  });

  it("answers several callers at once, each in their own session and language", async () => {
    const { port } = await startServer((p) => {
      const last = JSON.stringify(p.messages.at(-1));
      return { text: /剪/.test(last) ? "好呀，有位。" : "Sure, we have room.", wordDelayMs: 10 };
    });
    const [a, b, d] = await Promise.all([
      call(port, "+16045550401"),
      call(port, DEMO_PHONES.returningCantonese, undefined, undefined, { startLanguage: "zh-HK", opening: "returning" }),
      call(port, "+16045550403"),
    ]);
    a.prompt("Do you have room for a cut today?");
    b.prompt("今日有冇位剪頭髮？");
    d.prompt("Any room this afternoon?");
    await waitFor(() => a.lastCount() === 1 && b.lastCount() === 1 && d.lastCount() === 1);
    expect(a.texts().every((t) => t.lang === "en-US")).toBe(true);
    expect(b.texts().every((t) => t.lang === "zh-HK")).toBe(true);
    expect(b.texts().map((t) => t.token).join("")).toContain("有位");
    expect(d.texts().map((t) => t.token).join("")).toContain("Sure");
  });

  it("hands off to a human with the end message, after the line is spoken", async () => {
    const { port } = await startServer(
      [{ tools: [{ name: "transfer_to_human", input: { reason: "asked for owner", summary: "Caller wants to talk to the owner about a colour job." } }] }, { text: "Connecting you now." }],
      "+16045559999",
    );
    const c = await call(port, "+16045550123");
    c.prompt("Can I talk to a real person?");
    await waitFor(() => c.frames.some((f) => f.type === "end"), 5000);
    const end = c.frames.find((f) => f.type === "end")!;
    expect(JSON.parse(end.handoffData)).toMatchObject({ reasonCode: "live-agent-handoff", callerPhone: "+16045550123" });
    const iEnd = c.frames.indexOf(end);
    const iText = c.frames.findIndex((f) => f.type === "text" && f.token.includes("Connecting"));
    expect(iText).toBeGreaterThanOrEqual(0);
    expect(iText).toBeLessThan(iEnd);
  });

  it("writes a call log and posts a callback when the caller hangs up mid-booking", async () => {
    const { port, deps } = await startServer([
      { tools: [{ name: "check_availability", input: { service_id: "mens-cut", date: "2026-10-08" } }] },
      { text: "Tomorrow I have ten, ten thirty or eleven. Which works?" },
    ]);
    const c = await call(port, "+16045550123");
    c.prompt("Men's cut tomorrow please.");
    await waitFor(() => c.lastCount() === 1);
    c.ws.close();
    await waitFor(() => fs.existsSync(deps.config.logDir) && fs.readdirSync(deps.config.logDir).length === 1);
    const log = JSON.parse(fs.readFileSync(`${deps.config.logDir}/${fs.readdirSync(deps.config.logDir)[0]}`, "utf8"));
    expect(log.outcome).toBe("abandoned");
    expect(log.toolCalls[0].name).toBe("check_availability");
    expect(log.transcript.map((t: { role: string }) => t.role)).toEqual(["agent", "caller", "agent"]);
    await waitFor(() => deps.mockApi!.messages.length === 1);
    expect(deps.mockApi!.messages[0]).toMatchObject({ phone: "+16045550123", urgency: "low" });
  });
});
