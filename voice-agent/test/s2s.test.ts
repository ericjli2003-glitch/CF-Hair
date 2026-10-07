import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import twilio from "twilio";
import { createServer } from "../src/server.js";
import { relayToken } from "../src/relay/twiml.js";
import { realtimeTools } from "../src/s2s/realtime.js";
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

async function startServer(realtimeUrl: string) {
  const deps = testDeps();
  deps.config.openAiApiKey = "sk-test";
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
    expect(xml).toMatch(/<\/Connect><Hangup\/><\/Response>$/);
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
    expect(s.audio.output).toEqual({ format: { type: "audio/pcmu" }, voice: "marin" });
    expect(s.audio.input.turn_detection.type).toBe("server_vad");
    expect(s.reasoning).toEqual({ effort: "low" });
    const names = s.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("book_appointment");
    expect(names).not.toContain("transfer_to_human");
    expect(names).not.toContain("ask_caller_language");
    expect(s.instructions).toContain("speech to speech");
    expect(s.instructions).toContain("Bye, bye, bye!");
    expect(oai.of("response.create")[0].response.instructions).toContain("Hi, CF Hair Salon.");

    call.media(20);
    await waitFor(() => oai.of("input_audio_buffer.append").length === 1);
    // Caller lookup finishes during the greeting and refreshes the instructions.
    await waitFor(() => oai.of("session.update").length === 2);

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
    oai.send({ type: "response.output_audio_transcript.delta", response_id: "r5", delta: "OK, see you. Bye, bye, bye!" });
    oai.send({ type: "response.output_audio_transcript.done", response_id: "r5", transcript: "OK, see you. Bye, bye, bye!" });
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
