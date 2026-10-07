import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import twilio from "twilio";
import { createServer } from "../src/server.js";
import { relayToken } from "../src/relay/twiml.js";
import { DEMO_PHONES } from "../src/api/mock.js";
import { FakeLlm, testDeps, waitFor } from "./helpers.js";

const AUTH = "test_auth_token";
const VOICE = "CCCCCCCCCCCCCCCCCCCC";
const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

/** Stand-in for the ElevenLabs text-to-speech stream endpoint. */
async function fakeElevenLabs() {
  const calls: { path: string; key: string; body: { text: string; model_id: string; language_code?: string } }[] = [];
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ path: req.url ?? "", key: String(req.headers["xi-api-key"] ?? ""), body: JSON.parse(raw || "{}") });
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from("ID3-fake-mp3"));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  closers.push(() => srv.close());
  return { base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, calls };
}

async function startServer(apiBase: string, llm: FakeLlm) {
  const deps = testDeps({ llm });
  deps.config.elevenLabsApiKey = "el-key";
  deps.config.elevenLabsApiBase = apiBase;
  deps.config.directTtsLanguages = ["zh-HK"];
  deps.languages["zh-HK"] = { ...deps.languages["zh-HK"], ttsProvider: "ElevenLabs", voice: VOICE };
  const { server, wss } = createServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  deps.config.publicBaseUrl = `http://127.0.0.1:${port}`;
  closers.push(() => {
    for (const c of wss.clients) c.terminate();
    server.close();
  });
  return { deps, port };
}

describe("Cantonese spoken by ElevenLabs directly (Eleven v4 Turbo)", () => {
  it("plays the greeting and replies as ElevenLabs clips, and leaves the greeting out of the TwiML", async () => {
    const el = await fakeElevenLabs();
    const { port } = await startServer(el.base, new FakeLlm([{ text: "好呀，聽日幾點？" }]));

    const params = { CallSid: "CAdirect", From: DEMO_PHONES.returningCantonese };
    const url = `http://127.0.0.1:${port}/twiml`;
    const xml = await (
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, url, params) },
        body: new URLSearchParams(params),
      })
    ).text();
    expect(xml).toMatch(/<ConversationRelay[^>]* language="zh-HK"/);
    expect(xml).not.toContain("welcomeGreeting");

    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    const frames: Record<string, unknown>[] = [];
    ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "setup", callSid: "CAdirect", from: DEMO_PHONES.returningCantonese, to: "+16044757705", customParameters: { token: relayToken(AUTH, "CAdirect"), startLanguage: "zh-HK", opening: "returning" } }));
    await waitFor(() => frames.some((f) => f.type === "play"));
    const greeting = frames.find((f) => f.type === "play")!;
    expect(greeting).toMatchObject({ type: "play", interruptible: true, preemptible: false });
    expect(String(greeting.source)).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/tts/[0-9a-f-]{36}\\.mp3$`));

    ws.send(JSON.stringify({ type: "prompt", voicePrompt: "我想約聽日剪頭髮", lang: "zh-HK", last: true }));
    await waitFor(() => frames.filter((f) => f.type === "play").length >= 3);
    expect(frames.some((f) => f.type === "text")).toBe(false); // nothing Cantonese goes to Twilio's own voice

    // Twilio fetches each clip once; the audio streams from ElevenLabs.
    const clip = await fetch(String(frames.filter((f) => f.type === "play")[1].source));
    expect(clip.status).toBe(200);
    expect(clip.headers.get("content-type")).toContain("audio/mpeg");
    expect(await clip.text()).toBe("ID3-fake-mp3");
    expect((await fetch(String(frames.filter((f) => f.type === "play")[1].source))).status).toBe(404);

    const reply = el.calls.find((c) => c.body.text.includes("好呀"))!;
    expect(reply.path).toBe(`/v1/text-to-speech/${VOICE}/stream?output_format=mp3_22050_32`);
    expect(reply.key).toBe("el-key");
    expect(reply.body).toMatchObject({ model_id: "eleven_v4_turbo", language_code: "yue" });
    ws.close();
  });

  it("keeps English on Twilio's voice", async () => {
    const el = await fakeElevenLabs();
    const { port } = await startServer(el.base, new FakeLlm([{ text: "Sure. When can you come?" }]));
    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    const frames: Record<string, unknown>[] = [];
    ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "setup", callSid: "CAen2", from: "+16045550123", to: "+16044757705", customParameters: { token: relayToken(AUTH, "CAen2") } }));
    ws.send(JSON.stringify({ type: "prompt", voicePrompt: "Can I book a haircut?", lang: "en-US", last: true }));
    await waitFor(() => frames.some((f) => f.type === "text" && f.last === true));
    expect(frames.some((f) => f.type === "play")).toBe(false);
    expect(el.calls).toHaveLength(0);
    ws.close();
  });
});
