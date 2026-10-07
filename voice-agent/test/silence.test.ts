import { describe, expect, it } from "vitest";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import type { LanguageCode } from "../src/languages.js";
import { FakeLlm, testDeps, waitFor } from "./helpers.js";

type Ev = { kind: "text"; token: string; lang: LanguageCode } | { kind: "language"; code: LanguageCode };

function setup(nudgeMs: number) {
  const llm = new FakeLlm([{ text: "您好，请问剪什么？" }]);
  const deps = testDeps({ llm });
  deps.config.silenceNudgeMs = nudgeMs;
  const events: Ev[] = [];
  const channel: CallChannel = {
    sendText: (token, _last, lang) => void events.push({ kind: "text", token, lang }),
    setLanguage: (code) => void events.push({ kind: "language", code }),
    end: () => {},
  };
  const s = new CallSession(deps, { callSid: "CAsilent", from: "+16045550160", to: "+16044757705", greeting: "Hi." }, channel);
  return { s, events, llm };
}
const spokenLangs = (events: Ev[]) => events.filter((e) => e.kind === "text").map((e) => (e as { lang: string }).lang);

describe("never silent when the caller is not understood", () => {
  it("asks in all four languages when nothing is understood after the greeting", async () => {
    const { s, events } = setup(30);
    await s.start();
    await waitFor(() => events.length >= 4, 2000);
    expect(spokenLangs(events)).toEqual(["en-US", "zh-CN", "zh-HK", "ko-KR"]);
    await s.close();
  });

  it("asks straight away when speech comes back with no words, and the keypad then switches", async () => {
    const { s, events, llm } = setup(60_000);
    await s.start();
    await s.handlePrompt("   ");
    await waitFor(() => events.length >= 4, 1000);
    expect(spokenLangs(events)).toEqual(["en-US", "zh-CN", "zh-HK", "ko-KR"]);
    await s.handleDtmf("2");
    expect(events).toContainEqual({ kind: "language", code: "zh-CN" });
    await s.handlePrompt("我想剪头发");
    expect(llm.requests).toHaveLength(1);
    expect(s.language).toBe("zh-CN");
    await s.close();
  });

  it("stays quiet once the caller has been understood", async () => {
    const { s, events } = setup(30);
    await s.start();
    await s.handlePrompt("你好，我想剪头发");
    const before = events.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(events.length).toBe(before);
    await s.close();
  });
});
