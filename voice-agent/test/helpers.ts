import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import type { LlmClient, LlmMessage, LlmStream, StreamEvent, StreamParams } from "../src/agent/llm.js";
import { buildDeps } from "../src/bootstrap.js";
import type { BookingApi } from "../src/api/types.js";
import type { Summarizer } from "../src/calls.js";

/** Wednesday 7 October 2026, 11:00 in Vancouver: the salon is open. */
export const FIXED_NOW = DateTime.fromISO("2026-10-07T11:00:00", { zone: "America/Vancouver" });

export interface ScriptedStep {
  text?: string;
  tools?: { name: string; input: unknown }[];
  stop?: LlmMessage["stop_reason"];
  /** Delay between streamed words, to leave room for an interrupt. */
  wordDelayMs?: number;
}

type Script = ScriptedStep[] | ((params: StreamParams, callIndex: number) => ScriptedStep);

/** A scripted stand-in for Claude that streams text word by word and honours abort signals. */
export class FakeLlm implements LlmClient {
  readonly requests: StreamParams[] = [];
  private i = 0;
  constructor(private readonly script: Script) {}

  stream(params: StreamParams, opts: { signal: AbortSignal }): LlmStream {
    const snapshot = { ...params, messages: structuredClone(params.messages) } as StreamParams;
    this.requests.push(snapshot);
    const idx = this.i++;
    const step: ScriptedStep =
      typeof this.script === "function"
        ? this.script(snapshot, idx)
        : (this.script[idx] ?? { text: "Okay." });

    const content: LlmMessage["content"] = [];
    if (step.text) content.push({ type: "text", text: step.text, citations: null } as never);
    for (const [n, t] of (step.tools ?? []).entries()) {
      content.push({ type: "tool_use", id: `toolu_${idx}_${n}`, name: t.name, input: t.input } as never);
    }
    const message = {
      id: `msg_${idx}`,
      type: "message",
      role: "assistant",
      model: String(params.model),
      content,
      stop_reason: step.stop ?? (step.tools?.length ? "tool_use" : "end_turn"),
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
    } as unknown as LlmMessage;

    let resolveFinal!: (m: LlmMessage) => void;
    let rejectFinal!: (e: unknown) => void;
    const final = new Promise<LlmMessage>((res, rej) => {
      resolveFinal = res;
      rejectFinal = rej;
    });
    final.catch(() => {});

    const abortErr = () => Object.assign(new Error("Request was aborted."), { name: "AbortError" });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    async function* events(): AsyncGenerator<StreamEvent> {
      try {
        yield { type: "message_start", message: { ...message, content: [] } } as never;
        if (step.text) {
          yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } as never;
          const words = step.text.match(/\S+\s*/g) ?? [];
          for (const w of words) {
            if (opts.signal.aborted) throw abortErr();
            if (step.wordDelayMs) await sleep(step.wordDelayMs);
            if (opts.signal.aborted) throw abortErr();
            yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: w } } as never;
          }
          yield { type: "content_block_stop", index: 0 } as never;
        }
        if (opts.signal.aborted) throw abortErr();
        yield { type: "message_stop" } as never;
        resolveFinal(message);
      } catch (e) {
        rejectFinal(e);
        throw e;
      }
    }

    const gen = events();
    return {
      [Symbol.asyncIterator]: () => gen,
      finalMessage: () => final,
    };
  }
}

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cfhair-va-"));
}

export function testDeps(opts: { llm?: LlmClient; api?: BookingApi; forward?: string; summarizer?: Summarizer | null } = {}) {
  const dir = tempDir();
  return buildDeps({
    summarizer: opts.summarizer ?? null,
    mock: !opts.api,
    api: opts.api,
    llm: opts.llm ?? new FakeLlm([]),
    now: () => FIXED_NOW,
    config: {
      logDir: path.join(dir, "logs"),
      dataDir: path.join(dir, "data"),
      endCallGraceMs: 0,
      salonForwardNumber: opts.forward ?? "",
      salonMainNumber: "",
      twilioAuthToken: "test_auth_token",
      validateTwilioSignature: true,
      callbackOnAbandon: true,
      silenceNudgeMs: 0, // off in tests unless a test turns it on
    },
  });
}

export function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });
}
