import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import { createServer } from "../src/server.js";
import { relayToken } from "../src/relay/twiml.js";
import { CallSession } from "../src/agent/session.js";
import { DEMO_PHONES } from "../src/api/mock.js";
import { FakeLlm, testDeps, waitFor } from "./helpers.js";

const AUTH = "test_auth_token";
const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

/** Stand-in for ElevenLabs Scribe realtime: after a few audio chunks, commits a sentence with its language. */
async function fakeScribe(reply: { text: string; language_code: string }) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const seen = { key: "", query: "", chunks: 0 };
  wss.on("connection", (ws, req) => {
    seen.key = String(req.headers["xi-api-key"] ?? "");
    seen.query = req.url ?? "";
    ws.send(JSON.stringify({ message_type: "session_started", session_id: "s1", config: {} }));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.message_type !== "input_audio_chunk") return;
      seen.chunks++;
      if (seen.chunks === 3) {
        ws.send(JSON.stringify({ message_type: "committed_transcript", text: reply.text }));
        ws.send(JSON.stringify({ message_type: "committed_transcript_with_timestamps", text: reply.text, language_code: reply.language_code }));
      }
    });
  });
  closers.push(() => wss.close());
  return { url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, seen };
}

async function startServer(scribeUrl: string, llm: FakeLlm) {
  const deps = testDeps({ llm });
  deps.config.elevenLabsApiKey = "el-test-key";
  deps.config.scribeRealtimeUrl = scribeUrl;
  const { server, wss } = createServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => {
    for (const c of wss.clients) c.terminate();
    server.close();
  });
  return { deps, port: (server.address() as AddressInfo).port };
}

function signedPost(port: number, path: string, params: Record<string, string>) {
  const url = `http://127.0.0.1:${port}${path}`;
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, url, params) },
    body: new URLSearchParams(params),
  });
}

describe("language identified from the call audio (ElevenLabs Scribe)", () => {
  it("asks Twilio for an audio copy only for callers whose language is unknown", async () => {
    const scribe = await fakeScribe({ text: "x", language_code: "eng" });
    const { port } = await startServer(scribe.url, new FakeLlm([]));
    const fresh = await (await signedPost(port, "/twiml", { CallSid: "CAnew", From: "+16045550901" })).text();
    expect(fresh).toMatch(/<Start><Stream url="ws:\/\/127\.0\.0\.1:\d+\/listen" track="inbound_track"><Parameter name="token" value="[^"]+"\/><\/Stream><\/Start><Connect/);
    const known = await (await signedPost(port, "/twiml", { CallSid: "CAknown", From: DEMO_PHONES.returningCantonese })).text();
    expect(known).not.toContain("<Stream");
  });

  it("a new caller who answers in Cantonese is switched and answered, with no keypad", async () => {
    const scribe = await fakeScribe({ text: "你好，我想約聽日剪頭髮", language_code: "yue" });
    const llm = new FakeLlm([{ text: "好呀，聽日幾點？" }]);
    const { port, deps } = await startServer(scribe.url, llm);
    const callSid = "CAyue";
    const caller = "+16045550902";

    // ConversationRelay session (the English call).
    const relay = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    const frames: Record<string, unknown>[] = [];
    relay.on("message", (d) => frames.push(JSON.parse(d.toString())));
    await new Promise((r) => relay.once("open", r));
    relay.send(JSON.stringify({ type: "setup", callSid, from: caller, to: "+16044757705", customParameters: { token: relayToken(AUTH, callSid), startLanguage: "en-US", opening: "welcome" } }));

    // Twilio's copy of the caller audio.
    const listen = new WebSocket(`ws://127.0.0.1:${port}/listen`);
    await new Promise((r) => listen.once("open", r));
    listen.send(JSON.stringify({ event: "connected" }));
    listen.send(JSON.stringify({ event: "start", start: { callSid, customParameters: { token: relayToken(AUTH, callSid) } } }));
    for (let i = 0; i < 5; i++) listen.send(JSON.stringify({ event: "media", media: { payload: Buffer.alloc(160, 0xff).toString("base64") } }));

    await waitFor(() => frames.some((f) => f.type === "text" && f.last === true), 3000);
    expect(scribe.seen.key).toBe("el-test-key");
    expect(scribe.seen.query).toContain("model_id=scribe_v2_realtime");
    expect(scribe.seen.query).toContain("audio_format=ulaw_8000");
    expect(scribe.seen.query).toContain("include_language_detection=true");
    expect(frames.find((f) => f.type === "language")).toEqual({ type: "language", ttsLanguage: "zh-HK", transcriptionLanguage: "zh-HK" });
    expect(frames.filter((f) => f.type === "text").every((f) => f.lang === "zh-HK")).toBe(true);
    const sent = llm.requests[0].messages.find((m) => m.role === "user");
    expect(JSON.stringify(sent)).toContain("你好，我想約聽日剪頭髮");
    await waitFor(() => deps.mockApi!.callers.get(caller)?.preferredLanguage === "zh-HK");
    relay.close();
    listen.close();
  });

  it("leaves English to the English recognizer, and splits Mandarin from Cantonese by the words", async () => {
    const deps = testDeps({ llm: new FakeLlm([{ text: "好的。" }]) });
    const ch = { sendText: () => {}, setLanguage: () => {}, end: () => {} };
    const en = new CallSession(deps, { callSid: "CAeng", from: "+16045550903", to: "+16044757705" }, ch);
    await en.applyDetection({ languageCode: "eng", text: "Can I book a haircut?" });
    expect(en.language).toBe("en-US");
    await en.close();
    const zh = new CallSession(deps, { callSid: "CAzho", from: "+16045550904", to: "+16044757705" }, ch);
    await zh.applyDetection({ languageCode: "zho", text: "你好，请问明天有没有位？" });
    expect(zh.language).toBe("zh-CN");
    await zh.close();
    const yueAsZho = new CallSession(deps, { callSid: "CAyz", from: "+16045550905", to: "+16044757705" }, ch);
    await yueAsZho.applyDetection({ languageCode: "zho", text: "你好，聽日有冇位呀？我唔得閒" });
    expect(yueAsZho.language).toBe("zh-HK");
    await yueAsZho.close();
  });
});
