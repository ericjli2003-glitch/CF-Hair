import { describe, expect, it } from "vitest";
import { claudeCredentialSource } from "../src/config.js";

describe("Claude credentials", () => {
  const federation = {
    ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
    ANTHROPIC_ORGANIZATION_ID: "00000000-0000-0000-0000-000000000000",
    ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_1",
    ANTHROPIC_IDENTITY_TOKEN_FILE: "/var/run/render/oidc/token",
  };

  it("uses workload identity federation when every variable is set and no key is", () => {
    expect(claudeCredentialSource(federation)).toBe("federation");
    expect(claudeCredentialSource({ ...federation, ANTHROPIC_IDENTITY_TOKEN_FILE: undefined })).toBe("none");
    expect(claudeCredentialSource({ ...federation, ANTHROPIC_SERVICE_ACCOUNT_ID: undefined })).toBe("none");
  });

  it("reports the API key when one is set, since the SDK lets it win over federation", () => {
    expect(claudeCredentialSource({ ...federation, ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("api-key");
    expect(claudeCredentialSource({})).toBe("none");
  });

  it("drops an empty ANTHROPIC_API_KEY at startup so it cannot shadow federation", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    const { vi } = await import("vitest");
    vi.resetModules();
    await import("../src/config.js");
    expect("ANTHROPIC_API_KEY" in process.env).toBe(false);
  });
});

describe("thinking setting", () => {
  it("sends between_tools to Claude Sonnet 5.5 by default and nothing to other models", async () => {
    const { modelOptions } = await import("../src/agent/llm.js");
    const base = { anthropicEffort: "low" as const, claudeFallbacks: "auto" as const, anthropicThinking: "off" as const };
    expect(modelOptions({ ...base, anthropicModel: "claude-sonnet-5-5" }).betweenTools).toBe(true);
    expect(modelOptions({ ...base, anthropicModel: "claude-sonnet-5-5", anthropicThinking: "adaptive" }).betweenTools).toBe(false);
    expect(modelOptions({ ...base, anthropicModel: "claude-haiku-4-5" }).betweenTools).toBe(false);
    expect(modelOptions({ ...base, anthropicModel: "claude-opus-5-5" }).betweenTools).toBe(false);
  });
});
