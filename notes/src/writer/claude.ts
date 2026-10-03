/**
 * Claude writer.
 * - Small runs: regular Messages API calls (beta endpoint, for the server-side
 *   refusal fallback), a few at a time. The first call runs alone so it writes the
 *   prompt cache that every later call reads.
 * - Large runs: Message Batches API (50% cheaper, asynchronous). The shared
 *   system prompt carries cache_control there too.
 * Output is constrained to JSON with output_config.format.
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadSettings } from "../config.js";
import { OUTPUT_SCHEMA } from "./prompt.js";
import { emptyUsage, type Draft, type DraftRequest, type NoteWriter, type Usage } from "./types.js";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeWriterOptions {
  model?: string;
  effort?: Effort;
  batchThreshold?: number;
  concurrency?: number;
  pollSeconds?: number;
  client?: Anthropic;
}

interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface ContentLike {
  type: string;
  text?: string;
}

export class ClaudeWriter implements NoteWriter {
  readonly mock = false;
  readonly usage: Usage = emptyUsage();
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: Effort;
  private readonly batchThreshold: number;
  private readonly concurrency: number;
  private readonly pollMs: number;

  constructor(opts: ClaudeWriterOptions = {}) {
    const s = loadSettings().claude;
    this.model = opts.model ?? s.model;
    this.effort = opts.effort ?? s.effort;
    this.batchThreshold = opts.batchThreshold ?? s.batchThreshold;
    this.concurrency = opts.concurrency ?? s.concurrency;
    this.pollMs = (opts.pollSeconds ?? s.batchPollSeconds) * 1000;
    this.client = opts.client ?? new Anthropic();
    this.name = `claude:${this.model}`;
  }

  private baseParams(req: DraftRequest) {
    return {
      model: this.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" as const },
      output_config: {
        effort: this.effort,
        format: { type: "json_schema" as const, schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      },
      // Identical for every client in the run, so it is cached once and read by every later call.
      system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: req.user }],
    };
  }

  private addUsage(u: UsageLike | undefined, factor = 1): void {
    if (!u) return;
    this.usage.inputTokens += (u.input_tokens ?? 0) * factor;
    this.usage.outputTokens += (u.output_tokens ?? 0) * factor;
    this.usage.cacheReadTokens += (u.cache_read_input_tokens ?? 0) * factor;
    this.usage.cacheWriteTokens += (u.cache_creation_input_tokens ?? 0) * factor;
  }

  private parse(stopReason: string | null | undefined, content: ContentLike[]): Draft {
    if (stopReason === "refusal") return { message: "", messageZh: "", refusal: true };
    if (stopReason === "max_tokens") return { message: "", messageZh: "", error: "response hit max_tokens" };
    const text = content.find((b) => b.type === "text")?.text ?? "";
    try {
      const obj = JSON.parse(text) as { message?: unknown; message_zh?: unknown };
      return {
        message: typeof obj.message === "string" ? obj.message : "",
        messageZh: typeof obj.message_zh === "string" ? obj.message_zh : "",
      };
    } catch {
      return { message: "", messageZh: "", error: "response was not valid JSON" };
    }
  }

  async draftOne(req: DraftRequest): Promise<Draft> {
    try {
      const res = await this.client.beta.messages.create({
        ...this.baseParams(req),
        // Server-side fallback: a safety-classifier decline is re-run on Anthropic's
        // recommended fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      this.addUsage(res.usage);
      return this.parse(res.stop_reason, res.content as ContentLike[]);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      if (err instanceof Anthropic.BadRequestError) return { message: "", messageZh: "", error: `bad request: ${err.message}` };
      if (err instanceof Anthropic.APIError) return { message: "", messageZh: "", error: `API error ${err.status}: ${err.message}` };
      throw err;
    }
  }

  async draftMany(reqs: DraftRequest[], opts: { forceRegular?: boolean; log?: (m: string) => void } = {}): Promise<Map<string, Draft>> {
    const log = opts.log ?? (() => {});
    if (!opts.forceRegular && reqs.length >= this.batchThreshold) return this.draftBatch(reqs, log);
    const out = new Map<string, Draft>();
    if (reqs.length === 0) return out;
    log(`Writing ${reqs.length} note(s) with ${this.model} (regular calls, ${this.concurrency} at a time)`);
    // First request alone to write the cache, then the rest in parallel.
    out.set(reqs[0].id, await this.draftOne(reqs[0]));
    let next = 1;
    const workers = Array.from({ length: Math.min(this.concurrency, reqs.length - 1) }, async () => {
      while (next < reqs.length) {
        const r = reqs[next++];
        out.set(r.id, await this.draftOne(r));
      }
    });
    await Promise.all(workers);
    return out;
  }

  private async draftBatch(reqs: DraftRequest[], log: (m: string) => void): Promise<Map<string, Draft>> {
    log(`Submitting ${reqs.length} notes to the Message Batches API (${this.model}, 50% batch pricing)`);
    const batch = await this.client.messages.batches.create({
      requests: reqs.map((r) => ({ custom_id: r.id, params: this.baseParams(r) })),
    });
    this.usage.batchId = batch.id;
    log(`Batch ${batch.id} created; polling every ${Math.round(this.pollMs / 1000)}s`);
    let status = batch;
    while (status.processing_status !== "ended") {
      await new Promise((r) => setTimeout(r, this.pollMs));
      status = await this.client.messages.batches.retrieve(batch.id);
      const c = status.request_counts;
      log(`  ${status.processing_status}: ${c.succeeded} done, ${c.processing} processing, ${c.errored} errored`);
    }
    const out = new Map<string, Draft>();
    for await (const item of await this.client.messages.batches.results(batch.id)) {
      if (item.result.type === "succeeded") {
        // Batch usage is billed at 50%.
        this.addUsage(item.result.message.usage, 0.5);
        out.set(item.custom_id, this.parse(item.result.message.stop_reason, item.result.message.content as ContentLike[]));
      } else {
        out.set(item.custom_id, { message: "", messageZh: "", error: `batch result ${item.result.type}` });
      }
    }
    return out;
  }
}
