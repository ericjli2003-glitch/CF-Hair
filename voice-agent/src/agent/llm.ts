import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "../config.js";

export type StreamParams = import("@anthropic-ai/sdk/resources/beta/messages/messages").BetaMessageStreamParams;
export type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
export type LlmMessage = Anthropic.Beta.Messages.BetaMessage;
export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;

export interface LlmStream extends AsyncIterable<StreamEvent> {
  finalMessage(): Promise<LlmMessage>;
}

/** The one thing the agent needs from Claude. Swapped for a scripted fake in tests. */
export interface LlmClient {
  stream(params: StreamParams, opts: { signal: AbortSignal }): LlmStream;
}

export class AnthropicLlm implements LlmClient {
  private client: Anthropic | null;
  constructor(client?: Anthropic) {
    this.client = client ?? null;
  }

  stream(params: StreamParams, opts: { signal: AbortSignal }): LlmStream {
    this.client ??= new Anthropic(); // created lazily so the server starts without a key
    return this.client.beta.messages.stream(params, { signal: opts.signal });
  }
}

/** Model capability switches. Haiku 4.5 takes no effort parameter and no server-side fallbacks. */
export function modelOptions(cfg: Pick<AppConfig, "anthropicModel" | "anthropicEffort" | "claudeFallbacks" | "anthropicThinking">) {
  const m = cfg.anthropicModel;
  const isHaiku = /haiku/.test(m);
  const supportsDefaultFallbacks = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5)/.test(m);
  const fallbacks = cfg.claudeFallbacks === "on" || (cfg.claudeFallbacks === "auto" && supportsDefaultFallbacks);
  // Mid-conversation `role: "system"` messages (no beta header) are accepted by these models only.
  const systemMessages = /^claude-(sonnet-5-5|opus-5-5|opus-5|opus-4-8|fable-5|mythos-5)/.test(m);
  // Claude Sonnet 5.5 thinks by default (adaptive). On a phone call that thinking is silence before
  // the first word, so "off" sends between_tools, the model's no-extended-thinking setting.
  const betweenTools = cfg.anthropicThinking === "off" && /^claude-sonnet-5-5/.test(m);
  return {
    betweenTools,
    effort: isHaiku ? undefined : cfg.anthropicEffort,
    systemMessages,
    fallbacks,
  };
}

/** True for the SDK's abort error or any error thrown after our signal fired. */
export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Anthropic.APIUserAbortError || (err as Error)?.name === "AbortError";
}

export { Anthropic };
