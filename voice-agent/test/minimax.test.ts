import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import { createServer } from "../src/server.js";
import { relayToken } from "../src/relay/twiml.js";
import { MiniMaxSpeech, pcmToMulaw } from "../src/tts/minimax.js";
import { testDeps, waitFor } from "./helpers.js";

const AUTH = "test_auth_token";
const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

/** Stand-in for MiniMax t2a_v2: streams PCM as hex in "data:" lines, or an error. */
async function fakeMiniMax(opts: { fail?: boolean; delayMs?: (text: string) => number; level?: (text: string) => number } = {}) {
  const bodies: any[] = [];
  const auth: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url?.startsWith("/v1/get_voice")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ system_voice: [{ voice_id: "female-tianmei" }, { voice_id: "Cantonese_KindWoman" }, { voice_id: "Cantonese_PlayfulMan" }], voice_cloning: [], base_resp: { status_code: 0 } }));
        return;
      }
      bodies.push(JSON.parse(raw));
      auth.push(String(req.headers.authorization));
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (opts.fail) {
        res.end(`data: ${JSON.stringify({ base_resp: { status_code: 2013, status_msg: "invalid voice" } })}\n`);
        return;
      }
      const text = String(bodies[bodies.length - 1].text);
      const level = opts.level?.(text);
      const pcm = Buffer.alloc(320);
      for (let i = 0; i < 160; i++) pcm.writeInt16LE(level ?? (i % 2 ? 1000 : -1000), i * 2);
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ data: { audio: pcm.subarray(0, 161).toString("hex"), status: 1 }, base_resp: { status_code: 0 } })}\n`);
        res.write(`data: ${JSON.stringify({ data: { audio: pcm.subarray(161).toString("hex"), status: 1 }, base_resp: { status_code: 0 } })}\n`);
        // The final event repeats the whole audio, as MiniMax does without exclude_aggregated_audio.
        res.end(`data: ${JSON.stringify({ data: { audio: pcm.toString("hex"), status: 2 }, base_resp: { status_code: 0 } })}\n`);
      }, opts.delayMs?.(text) ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => server.close());
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies, auth };
}

async function fakeAzure() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  closers.push(() => wss.close());
  const events: any[] = [];
  let sock: WebSocket | null = null;
  wss.on("connection", (ws) => {
    sock = ws;
    ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  });
  return {
    base: `http://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    events,
    send: (e: Record<string, unknown>) => sock!.send(JSON.stringify(e)),
  };
}

async function start(extra: Record<string, unknown>) {
  const deps = testDeps();
  Object.assign(deps.config, { openAiApiKey: "", ...extra });
  const { server, wss } = createServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => {
    for (const c of wss.clients) c.terminate();
    server.close();
  });
  return (server.address() as AddressInfo).port;
}

async function call(port: number, callSid: string, startLanguage: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/azure/media`);
  const got: any[] = [];
  ws.on("message", (raw) => got.push(JSON.parse(raw.toString())));
  await new Promise<void>((r) => ws.once("open", () => r()));
  ws.send(JSON.stringify({ event: "start", streamSid: "MZm", start: { streamSid: "MZm", callSid, customParameters: { token: relayToken(AUTH, callSid), from: "+16045550168", startLanguage, opening: "returning" } } }));
  closers.push(() => ws.close());
  return got;
}

describe("MiniMax voice", () => {
  it("converts 16-bit PCM to G.711 mu-law", () => {
    const pcm = Buffer.alloc(6);
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(32767, 2);
    pcm.writeInt16LE(-32768, 4);
    expect([...pcmToMulaw(pcm)]).toEqual([0xff, 0x80, 0x00]);
  });

  it("asks for 8 kHz PCM with the language's voice and streams it as mu-law, across split chunks", async () => {
    const mm = await fakeMiniMax();
    const speech = new MiniMaxSpeech({ apiKey: "mm-key", baseUrl: mm.base, groupId: "", model: "speech-2.8-turbo", voices: { "en-US": "e", "zh-CN": "female-tianmei", "zh-HK": "c", "ko-KR": "k" }, speed: 1 });
    const out: Buffer[] = [];
    for await (const c of speech.mulaw("您好", "zh-CN", new AbortController().signal)) out.push(c);
    expect(Buffer.concat(out).length).toBe(160); // 320 bytes of PCM, split mid-sample, gives 160 samples
    expect(mm.auth[0]).toBe("Bearer mm-key");
    expect(mm.bodies[0]).toMatchObject({
      model: "speech-2.8-turbo",
      text: "您好",
      stream: true,
      voice_setting: { voice_id: "female-tianmei" },
      audio_setting: { sample_rate: 8000, format: "pcm", channel: 1 },
      language_boost: "Chinese",
    });
  });

  it("speaks a Mandarin caller's replies with MiniMax on the Azure line", async () => {
    const mm = await fakeMiniMax();
    const az = await fakeAzure();
    const port = await start({ azureVoiceLiveEndpoint: az.base, azureVoiceLiveKey: "k", minimaxApiKey: "mm-key", minimaxBaseUrl: mm.base });
    const got = await call(port, "CA_mm1", "zh-CN");
    await waitFor(() => az.events.some((e) => e.type === "response.create"));
    expect(az.events.find((e) => e.type === "session.update").session.modalities).toEqual(["text"]);
    az.send({ type: "response.created", response: { id: "r1" } });
    az.send({ type: "response.text.delta", response_id: "r1", item_id: "i1", delta: "您好，CF Hair Salon。" });
    az.send({ type: "response.text.done", response_id: "r1", item_id: "i1", text: "您好，CF Hair Salon。" });
    await waitFor(() => got.some((m) => m.event === "media"));
    await waitFor(() => mm.bodies.map((b) => b.text).join("") === "您好，CF Hair Salon。");
    expect(Buffer.from(got.find((m) => m.event === "media").media.payload, "base64").length).toBeGreaterThan(0);
  });

  it("speaks a Cantonese caller's replies with MiniMax too, boosted for Cantonese", async () => {
    const mm = await fakeMiniMax();
    const az = await fakeAzure();
    const port = await start({ azureVoiceLiveEndpoint: az.base, azureVoiceLiveKey: "k", minimaxApiKey: "mm-key", minimaxBaseUrl: mm.base });
    const got = await call(port, "CA_mm3", "zh-HK");
    await waitFor(() => az.events.some((e) => e.type === "response.create"));
    const session = az.events.find((e) => e.type === "session.update").session;
    expect(session.modalities).toEqual(["text"]);
    // Azure rejects its echo cancellation with text only (ec_not_supported, 2026-10-08).
    expect(session.input_audio_echo_cancellation).toBeUndefined();
    az.send({ type: "response.text.delta", response_id: "r1", item_id: "i1", delta: "你好，CF Hair Salon。" });
    az.send({ type: "response.text.done", response_id: "r1", item_id: "i1", text: "你好，CF Hair Salon。" });
    await waitFor(() => got.some((m) => m.event === "media"));
    await waitFor(() => mm.bodies.map((b) => b.text).join("") === "你好，CF Hair Salon。");
    expect(mm.bodies.every((b) => b.language_boost === "Chinese,Yue")).toBe(true);
  });

  it("keeps a Cantonese call in Cantonese when the transcript reads like Mandarin", async () => {
    const mm = await fakeMiniMax();
    const az = await fakeAzure();
    const port = await start({ azureVoiceLiveEndpoint: az.base, azureVoiceLiveKey: "k", minimaxApiKey: "mm-key", minimaxBaseUrl: mm.base });
    await call(port, "CA_mm6", "zh-HK");
    await waitFor(() => az.events.some((e) => e.type === "response.create"));
    const updates = () => az.events.filter((e) => e.type === "session.update").length;
    const before = updates();
    az.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "我想明天下午剪头发的" });
    await new Promise((r) => setTimeout(r, 100));
    expect(updates()).toBe(before);
    az.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "可以讲普通话吗" });
    await waitFor(() => az.events.some((e) => e.type === "session.update" && e.session.voice?.name === "zh-CN-YunxiNeural"));
  });

  it("swaps a voice the account does not have for a man's voice of that language", async () => {
    const mm = await fakeMiniMax();
    const speech = new MiniMaxSpeech({ apiKey: "mm-key", baseUrl: mm.base, groupId: "", model: "m", voices: { "en-US": "e", "zh-CN": "female-tianmei", "zh-HK": "Cantonese_Missing", "ko-KR": "k" }, speed: 1 });
    await speech.checkVoices(["zh-CN", "zh-HK"]);
    expect(speech.voiceFor("zh-CN")).toBe("female-tianmei");
    expect(speech.voiceFor("zh-HK")).toBe("Cantonese_PlayfulMan");
  });

  it("plays replies one after another, never mixed, even when a later one loads first", async () => {
    // The first reply's audio arrives late (a slow sentence); the next reply's is ready at once.
    const mm = await fakeMiniMax({ delayMs: (t) => (t.includes("一") ? 300 : 0), level: (t) => (t.includes("一") ? 1000 : -1000) });
    const az = await fakeAzure();
    const port = await start({ azureVoiceLiveEndpoint: az.base, azureVoiceLiveKey: "k", minimaxApiKey: "mm-key", minimaxBaseUrl: mm.base });
    const got = await call(port, "CA_mm5", "zh-HK");
    await waitFor(() => az.events.some((e) => e.type === "response.create"));
    for (const [id, text] of [["r1", "第一句。"], ["r2", "第二句。"]]) {
      az.send({ type: "response.created", response: { id } });
      az.send({ type: "response.text.delta", response_id: id, item_id: `i_${id}`, delta: text });
      az.send({ type: "response.text.done", response_id: id, item_id: `i_${id}`, text });
    }
    await waitFor(() => got.filter((m) => m.event === "media").length >= 4);
    await new Promise((r) => setTimeout(r, 100));
    const bytes = Buffer.concat(got.filter((m) => m.event === "media").map((m) => Buffer.from(m.media.payload, "base64")));
    // 160 samples per sentence, the repeated final audio left out; all of the first before the second.
    expect(bytes.length).toBe(320);
    expect(bytes.subarray(0, 160).every((b) => b === bytes[0])).toBe(true);
    expect(bytes.subarray(160).every((b) => b === bytes[160])).toBe(true);
    expect(bytes[0]).not.toBe(bytes[160]);
  });

  it("falls back to the Azure voice and repeats the reply if MiniMax fails", async () => {
    const mm = await fakeMiniMax({ fail: true });
    const az = await fakeAzure();
    const port = await start({ azureVoiceLiveEndpoint: az.base, azureVoiceLiveKey: "k", minimaxApiKey: "mm-key", minimaxBaseUrl: mm.base });
    await call(port, "CA_mm2", "zh-CN");
    await waitFor(() => az.events.some((e) => e.type === "response.create"));
    az.send({ type: "response.text.delta", response_id: "r1", item_id: "i1", delta: "您好。" });
    az.send({ type: "response.text.done", response_id: "r1", item_id: "i1", text: "您好。" });
    await waitFor(() => az.events.some((e) => e.type === "session.update" && e.session.modalities?.includes("audio") && e.session.voice));
    await waitFor(() => az.events.some((e) => e.type === "response.create" && /again/.test(e.response?.instructions ?? "")));
  });

  it("routes Mandarin callers to the Azure line when MiniMax speaks Mandarin, others to ElevenLabs", async () => {
    const deps = testDeps();
    Object.assign(deps.config, {
      openAiApiKey: "",
      publicBaseUrl: "https://voice.test",
      azureVoiceLiveEndpoint: "https://az.test",
      azureVoiceLiveKey: "k",
      minimaxApiKey: "mm-key",
      elevenAgentApiKey: "el-key",
      elevenLabsApiBase: "http://127.0.0.1:9", // unreachable: the ElevenLabs side answers with an apology
    });
    await deps.callers.saveLanguage("+16045550111", "zh-CN");
    const { server } = createServer(deps);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    closers.push(() => server.close());
    const port = (server.address() as AddressInfo).port;
    const route = async (from: string) => {
      const params = { CallSid: `CA_${from.slice(-4)}`, From: from, To: "+12365550100" };
      return (
        await fetch(`http://127.0.0.1:${port}/route/twiml`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, "https://voice.test/route/twiml", params) },
          body: new URLSearchParams(params),
        })
      ).text();
    };
    const mandarin = await route("+16045550111");
    expect(mandarin).toContain("wss://voice.test/azure/media");
    expect(mandarin).toContain('<Parameter name="startLanguage" value="zh-CN"/>');
    expect(await route("+16045550222")).not.toContain("/azure/media");
  });
});
