import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeWriter } from "../src/writer/claude.js";
import type { DraftRequest } from "../src/writer/types.js";

function req(i: number): DraftRequest {
  return {
    id: `win-back-c${i}`,
    system: "SHARED SYSTEM PROMPT",
    user: `client ${i}`,
    ctx: { client_first_name: `C${i}`, stylist_first_name: null, last_service: null, relationship: "", last_visit: null, occasion_details: {}, stylist_note: null, offer: null, second_language: null },
    meta: { campaignId: "win-back" },
  };
}

const okMessage = (text: string) => ({
  stop_reason: "end_turn",
  content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
  usage: { input_tokens: 200, output_tokens: 300, cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 },
});

describe("ClaudeWriter", () => {
  it("small runs use regular calls with a cached system prompt, JSON output and server-side fallback", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const client = {
      beta: {
        messages: {
          create: async (p: Record<string, unknown>) => {
            seen.push(p);
            return okMessage(JSON.stringify({ message: `Hi ${String(p.messages && (p.messages as Array<{ content: string }>)[0].content)}`, message_alt: "" }));
          },
        },
      },
      messages: { batches: { create: async () => { throw new Error("should not batch"); } } },
    } as unknown as Anthropic;
    const w = new ClaudeWriter({ client, batchThreshold: 25, concurrency: 2 });
    const out = await w.draftMany([req(1), req(2), req(3)]);
    expect(out.size).toBe(3);
    expect(out.get("win-back-c2")?.message).toBe("Hi client 2");
    const p = seen[0];
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect((p.system as Array<Record<string, unknown>>)[0]).toMatchObject({ text: "SHARED SYSTEM PROMPT", cache_control: { type: "ephemeral" } });
    expect((p.output_config as Record<string, unknown>).format).toMatchObject({ type: "json_schema" });
    expect(w.usage.cacheReadTokens).toBe(5400);
  });

  it("large runs go through the Message Batches API and are keyed by custom_id", async () => {
    let created: { requests: Array<{ custom_id: string; params: Record<string, unknown> }> } | undefined;
    let polls = 0;
    const client = {
      beta: { messages: { create: async () => { throw new Error("should batch"); } } },
      messages: {
        batches: {
          create: async (b: typeof created) => {
            created = b;
            return { id: "msgbatch_1", processing_status: "in_progress", request_counts: { processing: 30, succeeded: 0, errored: 0 } };
          },
          retrieve: async () => {
            polls++;
            return { id: "msgbatch_1", processing_status: polls > 1 ? "ended" : "in_progress", request_counts: { processing: 0, succeeded: 30, errored: 0 } };
          },
          results: async () =>
            (async function* () {
              // Results arrive in any order.
              for (const r of [...created!.requests].reverse()) {
                if (r.custom_id === "win-back-c7") {
                  yield { custom_id: r.custom_id, result: { type: "errored", error: { type: "api_error" } } };
                  continue;
                }
                yield { custom_id: r.custom_id, result: { type: "succeeded", message: okMessage(JSON.stringify({ message: `Hi ${r.custom_id}`, message_alt: "" })) } };
              }
            })(),
        },
      },
    } as unknown as Anthropic;
    const w = new ClaudeWriter({ client, batchThreshold: 25, pollSeconds: 0 });
    const reqs = Array.from({ length: 30 }, (_, i) => req(i));
    const out = await w.draftMany(reqs);
    expect(created?.requests).toHaveLength(30);
    expect(created?.requests[0].params).not.toHaveProperty("fallbacks"); // not accepted by the Batches API
    expect((created?.requests[0].params.system as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: "ephemeral" });
    expect(out.get("win-back-c3")?.message).toBe("Hi win-back-c3");
    expect(out.get("win-back-c7")?.error).toMatch(/errored/);
    expect(w.usage.batchId).toBe("msgbatch_1");
  });

  it("maps refusals and malformed output to flags instead of notes", async () => {
    const responses = [
      { stop_reason: "refusal", content: [], usage: {} },
      { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }], usage: {} },
    ];
    const client = { beta: { messages: { create: async () => responses.shift() } } } as unknown as Anthropic;
    const w = new ClaudeWriter({ client, concurrency: 1 });
    const out = await w.draftMany([req(1), req(2)]);
    expect(out.get("win-back-c1")?.refusal).toBe(true);
    expect(out.get("win-back-c2")?.error).toMatch(/JSON/);
  });
});
