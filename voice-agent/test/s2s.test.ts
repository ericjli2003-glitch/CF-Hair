import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import { createServer } from "../src/server.js";
import { relayToken } from "../src/relay/twiml.js";
import { realtimeTools } from "../src/s2s/realtime.js";
import http from "node:http";
import os from "node:os";
import { OpenAiAuth } from "../src/s2s/openai-auth.js";
import { testDeps, waitFor } from "./helpers.js";

const AUTH = "test_auth_token";
const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

/** Stand-in for the OpenAI Realtime API: records what the bridge sends and lets the test reply. */
async function fakeRealtime() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const seen = { auth: "", url: "", events: [] as any[] };
  let sock: WebSocket | null = null;
  wss.on("connection", (ws, req) => {
    sock = ws;
    seen.auth = String(req.headers.authorization ?? "");
    seen.url = req.url ?? "";
    ws.on("message", (raw) => seen.events.push(JSON.parse(raw.toString())));
  });
  closers.push(() => wss.close());
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    seen,
    send: (e: Record<string, unknown>) => sock!.send(JSON.stringify(e)),
    of: (type: string) => seen.events.filter((e) => e.type === type),
  };
}

async function startServer(realtimeUrl: string, auth?: Partial<ReturnType<typeof testDeps>["config"]>) {
  const deps = testDeps();
  deps.config.openAiApiKey = "sk-test";
  Object.assign(deps.config, auth ?? {});
  deps.config.realtimeUrl = realtimeUrl;
  const { server, wss } = createServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => {
    for (const c of wss.clients) c.terminate();
    server.close();
  });
  return { deps, port: (server.address() as AddressInfo).port };
}

/** Plays Twilio's side of a bidirectional media stream. */
async function twilioCall(port: number, callSid = "CA_s2s_1") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/s2s/media`);
  const got: any[] = [];
  ws.on("message", (raw) => got.push(JSON.parse(raw.toString())));
  await new Promise<void>((r) => ws.once("open", () => r()));
  ws.send(JSON.stringify({ event: "connected" }));
  ws.send(
    JSON.stringify({
      event: "start",
      streamSid: "MZ1",
      start: {
        streamSid: "MZ1",
        callSid,
        customParameters: { token: relayToken(AUTH, callSid), from: "+16045550199", to: "+12367078998", startLanguage: "en-US", opening: "welcome" },
      },
    }),
  );
  const closed = new Promise<void>((r) => ws.once("close", () => r()));
  return { ws, got, closed, media: (ts: number) => ws.send(JSON.stringify({ event: "media", media: { payload: Buffer.alloc(160, 0xff).toString("base64"), timestamp: String(ts) } })) };
}

describe("speech-to-speech test line", () => {
  it("answers /s2s/twiml with a two-way stream, then a hang-up", async () => {
    const oai = await fakeRealtime();
    const { port } = await startServer(oai.url);
    const params = { CallSid: "CA_tw", From: "+16045550199", To: "+12367078998" };
    const url = `http://127.0.0.1:${port}/s2s/twiml`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, url, params) },
      body: new URLSearchParams(params),
    });
    const xml = await res.text();
    expect(xml).toContain(`<Connect><Stream url="ws://127.0.0.1:${port}/s2s/media">`);
    expect(xml).toContain(`<Parameter name="token" value="${relayToken(AUTH, "CA_tw")}"/>`);
    expect(xml).toContain('<Parameter name="opening" value="welcome"/>');
    expect(xml).toMatch(/<\/Connect><Redirect method="POST">http:\/\/127\.0\.0\.1:\d+\/s2s\/after<\/Redirect><\/Response>$/);
  });

  it("sets up the session in mu-law with the booking tools and says the greeting", async () => {
    const oai = await fakeRealtime();
    const { port } = await startServer(oai.url);
    const call = await twilioCall(port);
    await waitFor(() => oai.of("response.create").length === 1);
    expect(oai.seen.auth).toBe("Bearer sk-test");
    expect(oai.seen.url).toContain("model=gpt-realtime-2.1");
    const s = oai.of("session.update")[0].session;
    expect(s.audio.input.format).toEqual({ type: "audio/pcmu" });
    expect(s.audio.output).toEqual({ format: { type: "audio/pcmu" }, voice: "marin", speed: 1 });
    expect(s.instructions).toContain("Voice and delivery");
    expect(s.instructions).toContain("light, friendly Hong Kong accent");
    expect(s.instructions).toContain("book 個位");
    expect(s.audio.input.turn_detection.type).toBe("server_vad");
    expect(s.reasoning).toEqual({ effort: "low" });
    const names = s.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("book_appointment");
    expect(names).not.toContain("transfer_to_human");
    expect(names).not.toContain("ask_caller_language");
    expect(s.instructions).toContain("speech to speech");
    expect(s.instructions).toContain("Bye bye!");
    expect(oai.of("response.create")[0].response.instructions).toContain("Hi, CF Hair Salon.");

    call.media(20);
    await waitFor(() => oai.of("input_audio_buffer.append").length === 1);
    // Today's openings reach the model: in the first settings, or in an update once loaded.
    await waitFor(() => oai.of("session.update").some((e) => String(e.session.instructions).includes("[start=")));

    oai.send({ type: "response.output_audio.delta", response_id: "r1", item_id: "i1", delta: "AAAA" });
    await waitFor(() => call.got.some((m) => m.event === "media"));
    expect(call.got.find((m) => m.event === "media")).toEqual({ event: "media", streamSid: "MZ1", media: { payload: "AAAA" } });
    expect(call.got.some((m) => m.event === "mark")).toBe(true);
    call.ws.close();
  });

  it("refuses to book in the same reply that asks the caller to confirm", async () => {
    const oai = await fakeRealtime();
    const { port } = await startServer(oai.url);
    const call = await twilioCall(port);
    await waitFor(() => oai.of("response.create").length === 1);
    oai.send({ type: "response.output_audio_transcript.delta", response_id: "r2", delta: "Men's cut at three, Eric?" });
    oai.send({
      type: "response.function_call_arguments.done",
      response_id: "r2",
      call_id: "c1",
      name: "book_appointment",
      arguments: JSON.stringify({ service_id: "mens-cut", start: "2026-10-07T15:00:00-07:00", customer_name: "Eric", confirmed_with_caller: true }),
    });
    oai.send({ type: "response.done", response: { id: "r2", status: "completed" } });
    await waitFor(() => oai.of("conversation.item.create").length === 1);
    const out = oai.of("conversation.item.create")[0].item;
    expect(out.call_id).toBe("c1");
    expect(out.output).toContain("REFUSED_WAIT_FOR_ANSWER");
    await new Promise((r) => setTimeout(r, 50));
    expect(oai.of("response.create")).toHaveLength(1); // only the greeting: the model waits for the answer
    call.ws.close();
  });

  it("runs a lookup tool and asks the model to speak about the result", async () => {
    const oai = await fakeRealtime();
    const { port } = await startServer(oai.url);
    const call = await twilioCall(port);
    await waitFor(() => oai.of("response.create").length === 1);
    oai.send({
      type: "response.function_call_arguments.done",
      response_id: "r3",
      call_id: "c2",
      name: "check_availability",
      arguments: JSON.stringify({ service_id: "mens-cut", date: "2026-10-08" }),
    });
    oai.send({ type: "response.done", response: { id: "r3", status: "completed" } });
    await waitFor(() => oai.of("response.create").length === 2);
    const out = oai.of("conversation.item.create")[0].item;
    expect(out.type).toBe("function_call_output");
    expect(JSON.parse(out.output).error).toBeUndefined();
    call.ws.close();
  });

  it("clears Twilio's audio and trims the reply when the caller talks over it", async () => {
    const oai = await fakeRealtime();
    const { port } = await startServer(oai.url);
    const call = await twilioCall(port);
    await waitFor(() => oai.of("response.create").length === 1);
    call.media(1000);
    oai.send({ type: "response.output_audio.delta", response_id: "r4", item_id: "item_a", delta: "AAAA" });
    await waitFor(() => call.got.some((m) => m.event === "media"));
    call.media(1600);
    await waitFor(() => oai.of("input_audio_buffer.append").length === 2);
    oai.send({ type: "input_audio_buffer.speech_started", audio_start_ms: 500, item_id: "u1" });
    await waitFor(() => oai.of("conversation.item.truncate").length === 1);
    expect(oai.of("conversation.item.truncate")[0]).toEqual({ type: "conversation.item.truncate", item_id: "item_a", content_index: 0, audio_end_ms: 600 });
    expect(call.got.some((m) => m.event === "clear")).toBe(true);
    call.ws.close();
  });

  it("hangs up after the goodbye has played and reports the call", async () => {
    const oai = await fakeRealtime();
    const { port, deps } = await startServer(oai.url);
    const call = await twilioCall(port);
    await waitFor(() => oai.of("response.create").length === 1);
    oai.send({ type: "response.created", response: { id: "r_greet" } });
    oai.send({ type: "response.output_audio_transcript.done", response_id: "r_greet", transcript: "Hi, CF Hair Salon." });
    oai.send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 0, item_id: "u1" });
    oai.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Thanks, bye." });
    oai.send({ type: "response.output_audio_transcript.delta", response_id: "r5", delta: "OK, see you. Bye bye!" });
    oai.send({ type: "response.output_audio_transcript.done", response_id: "r5", transcript: "OK, see you. Bye bye!" });
    oai.send({ type: "response.function_call_arguments.done", response_id: "r5", call_id: "c3", name: "end_call", arguments: JSON.stringify({ reason: "completed" }) });
    oai.send({ type: "response.done", response: { id: "r5", status: "completed" } });
    await waitFor(() => call.got.some((m) => m.event === "mark" && m.mark.name === "end"));
    expect(oai.of("response.create")).toHaveLength(1); // nothing more to say
    call.ws.send(JSON.stringify({ event: "mark", streamSid: "MZ1", mark: { name: "end" } }));
    await call.closed;
    const logFile = () => (fs.existsSync(deps.config.logDir) ? fs.readdirSync(deps.config.logDir)[0] : undefined);
    await waitFor(() => !!logFile());
    const rec = JSON.parse(fs.readFileSync(path.join(deps.config.logDir, logFile()!), "utf8"));
    expect(rec.endedBy).toBe("agent");
    expect(rec.endReason).toBe("completed");
    expect(rec.model).toBe("openai:gpt-realtime-2.1");
    expect(rec.transcript.map((t: { role: string }) => t.role)).toEqual(["agent", "caller", "agent"]);
  });
});

describe("realtimeTools", () => {
  it("converts the shared tool definitions to Realtime function tools", () => {
    const t = realtimeTools().find((x) => x.name === "check_availability")!;
    expect(t.type).toBe("function");
    expect((t.parameters as { type: string }).type).toBe("object");
  });
});

/** Stand-in for https://auth.openai.com/oauth/token. */
async function fakeTokenEndpoint(expiresIn = 3600) {
  const bodies: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ access_token: `oai-access-${bodies.length}`, expires_in: expiresIn, token_type: "Bearer" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => server.close());
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth/token`, bodies };
}

function tokenFile(contents: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfhair-oidc-"));
  const file = path.join(dir, "token");
  fs.writeFileSync(file, contents + "\n");
  return file;
}

describe("OpenAI workload identity", () => {
  it("exchanges Render's token and connects with the OpenAI access token, no API key", async () => {
    const tokens = await fakeTokenEndpoint();
    const oai = await fakeRealtime();
    const { port } = await startServer(oai.url, {
      openAiApiKey: "",
      openAiIdentityProviderId: "idp_test",
      openAiServiceAccountId: "user-svc",
      openAiIdentityTokenFile: tokenFile("render.jwt.value"),
      openAiTokenUrl: tokens.url,
    });
    const call = await twilioCall(port);
    await waitFor(() => oai.of("response.create").length === 1);
    expect(oai.seen.auth).toBe("Bearer oai-access-1");
    expect(tokens.bodies[0]).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "render.jwt.value",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      identity_provider_id: "idp_test",
      service_account_id: "user-svc",
    });
    call.ws.close();
  });

  it("reuses the access token until it is close to expiring, re-reading the rotated file", async () => {
    const tokens = await fakeTokenEndpoint(3600);
    const file = tokenFile("first");
    const auth = new OpenAiAuth({ apiKey: "", identityProviderId: "idp", serviceAccountId: "sa", tokenFile: file, tokenUrl: tokens.url });
    expect(auth.mode()).toBe("federation");
    expect(await auth.bearer()).toBe("oai-access-1");
    expect(await auth.bearer()).toBe("oai-access-1");
    expect(tokens.bodies).toHaveLength(1);

    const short = await fakeTokenEndpoint(1); // expires at once: the next call exchanges again
    fs.writeFileSync(file, "second");
    const auth2 = new OpenAiAuth({ apiKey: "", identityProviderId: "idp", serviceAccountId: "sa", tokenFile: file, tokenUrl: short.url });
    await auth2.bearer();
    await new Promise((r) => setTimeout(r, 1100));
    await auth2.bearer();
    expect(short.bodies.map((b) => b.subject_token)).toEqual(["second", "second"]);
  });

  it("prefers workload identity over a leftover API key and reports what is missing", () => {
    const full = new OpenAiAuth({ apiKey: "sk-old", identityProviderId: "idp", serviceAccountId: "sa", tokenFile: "/x", tokenUrl: "" });
    expect(full.mode()).toBe("federation");
    const partial = new OpenAiAuth({ apiKey: "", identityProviderId: "idp", serviceAccountId: "", tokenFile: "", tokenUrl: "" });
    expect(partial.mode()).toBe("none");
    expect(partial.missing()).toEqual(["OPENAI_SERVICE_ACCOUNT_ID", "OPENAI_IDENTITY_TOKEN_FILE (set by Render)"]);
  });
});

describe("when the speech-to-speech call fails", () => {
  it("apologizes instead of hanging up in silence when the OpenAI login is refused", async () => {
    const refused = http.createServer((_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "audience mismatch" }));
    });
    await new Promise<void>((r) => refused.listen(0, "127.0.0.1", () => r()));
    closers.push(() => refused.close());
    const oai = await fakeRealtime();
    const { port } = await startServer(oai.url, {
      openAiApiKey: "",
      openAiIdentityProviderId: "idp_test",
      openAiServiceAccountId: "user-svc",
      openAiIdentityTokenFile: tokenFile("render.jwt"),
      openAiTokenUrl: `http://127.0.0.1:${(refused.address() as AddressInfo).port}/oauth/token`,
    });
    const call = await twilioCall(port, "CA_fail");
    await call.closed; // the stream is closed by the server
    const url = `http://127.0.0.1:${port}/s2s/after`;
    const post = (sid: string) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, url, { CallSid: sid }) },
        body: new URLSearchParams({ CallSid: sid }),
      }).then((r) => r.text());
    expect(await post("CA_fail")).toContain("<Say>Sorry, this test line is not working right now.");
    // A normal end just hangs up.
    expect(await post("CA_other")).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });
});

describe("Azure Voice Live line", () => {
  async function azureCall(port: number, callSid: string, startLanguage = "en-US") {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/azure/media`);
    const got: any[] = [];
    ws.on("message", (raw) => got.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.once("open", () => r()));
    ws.send(
      JSON.stringify({
        event: "start",
        streamSid: "MZaz",
        start: { streamSid: "MZaz", callSid, customParameters: { token: relayToken(AUTH, callSid), from: "+16045550199", startLanguage, opening: "welcome" } },
      }),
    );
    return { ws, got };
  }

  async function startAzure() {
    const az = await fakeRealtime();
    const { port, deps } = await startServer("ws://unused", {
      openAiApiKey: "",
      azureVoiceLiveEndpoint: az.url.replace("ws://", "http://"),
      azureVoiceLiveKey: "az-key",
    });
    return { az, port, deps };
  }

  it("answers /azure/twiml with a stream to /azure/media", async () => {
    const { port } = await startAzure();
    const params = { CallSid: "CA_az0", From: "+16045550199", To: "+12365550100" };
    const url = `http://127.0.0.1:${port}/azure/twiml`;
    const xml = await (
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilio.getExpectedTwilioSignature(AUTH, url, params) },
        body: new URLSearchParams(params),
      })
    ).text();
    expect(xml).toContain(`<Stream url="ws://127.0.0.1:${port}/azure/media">`);
  });

  it("connects with the api key and sets up mu-law audio, an Azure voice and Azure turn detection", async () => {
    const { az, port } = await startAzure();
    const call = await azureCall(port, "CA_az1", "zh-HK");
    await waitFor(() => az.of("response.create").length === 1);
    expect(az.seen.url).toBe("/voice-live/realtime?api-version=2026-07-15&model=gpt-realtime");
    const s = az.of("session.update")[0].session;
    expect(s.input_audio_format).toBe("g711_ulaw");
    expect(s.output_audio_format).toBe("g711_ulaw");
    // A returning Cantonese caller starts with the Cantonese voice.
    expect(s.voice).toEqual({ type: "azure-standard", name: "zh-HK-WanLungNeural" });
    expect(s.turn_detection.type).toBe("azure_semantic_vad_multilingual");
    expect(s.input_audio_noise_reduction).toEqual({ type: "azure_deep_noise_suppression" });
    expect(s.input_audio_transcription.model).toBe("azure-speech");
    expect(s.instructions).toContain("Each language has its own voice");
    // Older event names carry the audio.
    az.send({ type: "response.audio.delta", response_id: "r1", item_id: "i1", delta: "BBBB" });
    await waitFor(() => call.got.some((m) => m.event === "media"));
    expect(call.got.find((m) => m.event === "media").media.payload).toBe("BBBB");
    call.ws.close();
  });

  it("switches to the matching Azure voice when the caller changes language", async () => {
    const { az, port } = await startAzure();
    const call = await azureCall(port, "CA_az2");
    await waitFor(() => az.of("response.create").length === 1);
    expect(az.of("session.update")[0].session.voice.name).toBe("en-HK-YanNeural");
    // From the caller's words (Cantonese)...
    az.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "我想聽日剪頭髮，有冇位呀？" });
    await waitFor(() => az.of("session.update").some((e) => e.session.voice?.name === "zh-HK-WanLungNeural"));
    // ...and from set_language (Mandarin), once the caller asks for it.
    az.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "Can you speak Mandarin?" });
    az.send({ type: "response.function_call_arguments.done", response_id: "r2", call_id: "c1", name: "set_language", arguments: JSON.stringify({ language: "zh-CN" }) });
    await waitFor(() => az.of("session.update").some((e) => e.session.voice?.name === "zh-CN-YunxiNeural"));
    call.ws.close();
  });

  it("switches a Mandarin call to Cantonese when the caller asks for 廣東話 in their own words", async () => {
    const { az, port } = await startAzure();
    const call = await azureCall(port, "CA_az4", "zh-CN");
    await waitFor(() => az.of("response.create").length === 1);
    // Azure writes it in simplified characters, as it hears Mandarin-ish speech.
    az.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "可以讲广东话吗" });
    await waitFor(() => az.of("session.update").some((e) => e.session.voice?.name === "zh-HK-WanLungNeural"));
    call.ws.close();
  });

  it("waits for the caller's transcript before judging set_language", async () => {
    const { az, port } = await startAzure();
    const call = await azureCall(port, "CA_az5", "zh-CN");
    await waitFor(() => az.of("response.create").length === 1);
    // The model asks to switch before the transcript of "Cantonese, please" arrives.
    az.send({ type: "input_audio_buffer.committed", item_id: "u1" });
    az.send({ type: "response.function_call_arguments.done", response_id: "r2", call_id: "c1", name: "set_language", arguments: JSON.stringify({ language: "zh-HK" }) });
    await new Promise((r) => setTimeout(r, 100));
    az.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Cantonese please" });
    await waitFor(() => az.of("conversation.item.create").some((e) => /"ok":true/.test(e.item?.output ?? "")));
    expect(az.of("session.update").some((e) => e.session.voice?.name === "zh-HK-WanLungNeural")).toBe(true);
    call.ws.close();
  });

  it("refuses set_language from Cantonese to Mandarin when the caller did not ask", async () => {
    const { az, port } = await startAzure();
    const call = await azureCall(port, "CA_az3");
    await waitFor(() => az.of("response.create").length === 1);
    az.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "我想聽日剪頭髮，有冇位呀？" });
    await waitFor(() => az.of("session.update").some((e) => e.session.voice?.name === "zh-HK-WanLungNeural"));
    // Cantonese as speech recognition writes it, then the model asks for Mandarin.
    az.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "我想剪头发的" });
    az.send({ type: "response.function_call_arguments.done", response_id: "r2", call_id: "c1", name: "set_language", arguments: JSON.stringify({ language: "zh-CN" }) });
    await waitFor(() => az.of("conversation.item.create").some((e) => /Language not changed/.test(e.item?.output ?? "")));
    expect(az.of("session.update").some((e) => e.session.voice?.name === "zh-CN-YunxiNeural")).toBe(false);
    call.ws.close();
  });
});

describe("Azure model not offered in the region", () => {
  it("switches to the next model in the same call, and starts later calls with it", async () => {
    // Stand-in Azure: refuses gpt-realtime like a region without it, accepts the next model.
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((r) => wss.once("listening", () => r()));
    closers.push(() => wss.close());
    const urls: string[] = [];
    const events: any[] = [];
    wss.on("connection", (ws, req) => {
      urls.push(req.url ?? "");
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        events.push({ url: req.url, ...m });
        if (m.type === "session.update" && req.url?.endsWith("model=gpt-realtime")) {
          ws.send(JSON.stringify({ type: "error", error: { code: "invalid_model", message: "Model gpt-realtime is not supported in this region." } }));
        }
      });
    });
    const base = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
    const { port } = await startServer("ws://unused", { openAiApiKey: "", azureVoiceLiveEndpoint: base, azureVoiceLiveKey: "az-key" });
    const connect = async (callSid: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/azure/media`);
      await new Promise<void>((r) => ws.once("open", () => r()));
      ws.send(JSON.stringify({ event: "start", streamSid: "MZf", start: { streamSid: "MZf", callSid, customParameters: { token: relayToken(AUTH, callSid), from: "+16045550199", opening: "welcome" } } }));
      return ws;
    };
    const first = await connect("CA_fb1");
    await waitFor(() => events.some((e) => e.type === "response.create" && e.url.includes("model=gpt-realtime-mini")));
    expect(urls[0].endsWith("model=gpt-realtime")).toBe(true);
    expect(urls[1]).toContain("model=gpt-realtime-mini");
    first.close();
    const second = await connect("CA_fb2");
    await waitFor(() => urls.length === 3);
    expect(urls[2]).toContain("model=gpt-realtime-mini");
    second.close();
  });

  it("switches models in the same call when Azure cannot set up the session with one", async () => {
    // Seen 2026-10-09: gpt-realtime-mini offered in the region, but the session setup failed.
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((r) => wss.once("listening", () => r()));
    closers.push(() => wss.close());
    const urls: string[] = [];
    const events: any[] = [];
    wss.on("connection", (ws, req) => {
      urls.push(req.url ?? "");
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        events.push({ url: req.url, ...m });
        if (m.type === "session.update" && req.url?.endsWith("model=gpt-realtime-mini")) {
          ws.send(JSON.stringify({ type: "error", error: { code: "max_config_attempts_exceeded", message: "Session configuration failed after 5 attempts.", param: "type" } }));
        }
      });
    });
    const base = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
    const { port } = await startServer("ws://unused", { openAiApiKey: "", azureVoiceLiveEndpoint: base, azureVoiceLiveKey: "az-key", azureVoiceLiveModel: "gpt-realtime-mini" });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/azure/media`);
    await new Promise<void>((r) => ws.once("open", () => r()));
    ws.send(JSON.stringify({ event: "start", streamSid: "MZs", start: { streamSid: "MZs", callSid: "CA_cfg1", customParameters: { token: relayToken(AUTH, "CA_cfg1"), from: "+16045550198", opening: "welcome" } } }));
    await waitFor(() => events.some((e) => e.type === "response.create" && e.url.includes("model=gpt-4.1-mini")));
    expect(urls[0]).toContain("model=gpt-realtime-mini");
    ws.close();
  });
});
