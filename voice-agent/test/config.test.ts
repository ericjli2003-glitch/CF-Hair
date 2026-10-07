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

describe("booking website on the phone", () => {
  it("reads web addresses aloud with dots and dashes, spelling two-letter parts", async () => {
    const { spokenWebAddress } = await import("../src/config.js");
    expect(spokenWebAddress("https://cf-hair-salon.vercel.app/")).toBe("C F dash hair dash salon dot vercel dot app");
    expect(spokenWebAddress("www.cfhairsalon.ca")).toBe("cfhairsalon dot C A");
  });
});

describe("per-language voice overrides", () => {
  it("uses ElevenLabs for a language whose voice is an ElevenLabs ID, even without its own provider", async () => {
    const { relayLanguages, languageWarnings, looksLikeElevenLabsVoice } = await import("../src/languages.js");
    expect(looksLikeElevenLabsVoice("ZF6FPAbjXT4488VcRRnw")).toBe(true);
    expect(looksLikeElevenLabsVoice("ZF6FPAbjXT4488VcRRnw-flash_v2_5")).toBe(true);
    expect(looksLikeElevenLabsVoice("yue-HK-Chirp3-HD-Aoede")).toBe(false);
    const env = { CR_TTS_PROVIDER: "ElevenLabs", CR_ELEVENLABS_VOICE: "AAAAAAAAAAAAAAAAAAAA", CR_ZH_HK_VOICE: "BBBBBBBBBBBBBBBBBBBB" };
    const langs = relayLanguages(env);
    expect(langs["zh-HK"]).toMatchObject({ ttsProvider: "ElevenLabs", voice: "BBBBBBBBBBBBBBBBBBBB" });
    expect(langs["en-US"].ttsProvider).toBe("ElevenLabs");
    // A Google voice name for Cantonese keeps Google.
    expect(relayLanguages({ ...env, CR_ZH_HK_VOICE: "yue-HK-Chirp3-HD-Aoede" })["zh-HK"].ttsProvider).toBe("Google");
    // An explicit provider still wins, and the mismatch is reported.
    const forced = relayLanguages({ ...env, CR_ZH_HK_TTS_PROVIDER: "Google" });
    expect(languageWarnings(forced, env).join(" ")).toMatch(/zh-HK voice .* looks like an ElevenLabs voice ID/);
  });
});

describe("ElevenLabs models Twilio does not accept", () => {
  it("drops an unsupported model such as v4_turbo instead of failing every call", async () => {
    const { relayLanguages } = await import("../src/languages.js");
    expect(relayLanguages({ CR_ZH_HK_VOICE: "CCCCCCCCCCCCCCCCCCCC-v4_turbo" })["zh-HK"]).toMatchObject({ ttsProvider: "ElevenLabs", voice: "CCCCCCCCCCCCCCCCCCCC" });
    expect(relayLanguages({ CR_ZH_HK_VOICE: "CCCCCCCCCCCCCCCCCCCC-turbo_v2_5-1.0_0.5_0.8" })["zh-HK"].voice).toBe("CCCCCCCCCCCCCCCCCCCC-turbo_v2_5-1.0_0.5_0.8");
    const all = relayLanguages({ CR_TTS_PROVIDER: "ElevenLabs", CR_ELEVENLABS_VOICE: "AAAAAAAAAAAAAAAAAAAA", CR_ELEVENLABS_MODEL: "v4_turbo" });
    expect(all["en-US"].voice).toBe("AAAAAAAAAAAAAAAAAAAA");
  });
});

describe("turn-taking settings", () => {
  it("adds speechTimeout, and eotThreshold only when English uses Deepgram Flux", async () => {
    const { conversationRelayTwiml } = await import("../src/relay/twiml.js");
    const { relayLanguages } = await import("../src/languages.js");
    const base = { wsUrl: "wss://x/relay", actionUrl: "https://x/a", greeting: "Hi, CF Hair Salon.", token: "t" };
    const plain = conversationRelayTwiml({ ...base, languages: relayLanguages({}) });
    expect(plain).not.toContain("speechTimeout");
    const tuned = conversationRelayTwiml({ ...base, languages: relayLanguages({ CR_EN_US_SPEECH_MODEL: "flux" }), speechTimeoutMs: 700, eotThreshold: 0.7 });
    expect(tuned).toMatch(/<ConversationRelay[^>]* speechModel="flux"/);
    expect(tuned).toContain('speechTimeout="700"');
    expect(tuned).toContain('eotThreshold="0.7"');
    const notFlux = conversationRelayTwiml({ ...base, languages: relayLanguages({}), eotThreshold: 0.7, speechTimeoutMs: 100 });
    expect(notFlux).not.toContain("eotThreshold");
    expect(notFlux).toContain('speechTimeout="600"'); // clamped to Twilio's range
  });
});
