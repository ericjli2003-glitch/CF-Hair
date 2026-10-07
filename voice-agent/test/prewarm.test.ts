import { describe, expect, it } from "vitest";
import { CallSession } from "../src/agent/session.js";
import type { StreamParams } from "../src/agent/llm.js";
import { FakeLlm, testDeps, waitFor } from "./helpers.js";

describe("prompt cache warm-up during the greeting", () => {
  it("sends one max_tokens 0 request shaped like the real ones, marked at the end of the call context", async () => {
    const warmed: StreamParams[] = [];
    const llm = Object.assign(new FakeLlm([{ text: "Sure." }]), {
      warm: async (p: StreamParams) => {
        warmed.push(p);
        return { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 4000, cache_creation_input_tokens: 900 } as never;
      },
    });
    const deps = testDeps({ llm });
    const s = new CallSession(deps, { callSid: "CAwarm", from: "+16045550123", to: "+16044757705" }, { sendText: () => {}, setLanguage: () => {}, end: () => {} });
    await s.start();
    await waitFor(() => warmed.length === 1);
    const w = warmed[0];
    expect(w.max_tokens).toBe(0);
    expect(w.cache_control).toBeUndefined(); // no automatic caching keyed to the placeholder
    const system = w.system as { text: string; cache_control?: unknown }[];
    expect(system.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(system.at(-1)!.text).toContain("# Call context");
    await s.handlePrompt("Hi, can I book a haircut?");
    const real = llm.requests[0];
    // Same model, tools, thinking and effort, so the real reply reads what the warm-up wrote.
    expect(w.model).toBe(real.model);
    expect(w.tools).toEqual(real.tools);
    expect(w.thinking).toEqual(real.thinking);
    expect(w.output_config).toEqual(real.output_config);
    expect((real.system as { text: string }[])[1].text).toBe(system.at(-1)!.text);
    await s.close();
  });
});
