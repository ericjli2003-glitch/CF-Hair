import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import { DEMO_PHONES } from "../src/api/mock.js";
import type { LanguageCode } from "../src/languages.js";
import { FakeLlm, testDeps, type ScriptedStep } from "./helpers.js";

type Event = { kind: "text"; token: string; last: boolean; lang: LanguageCode } | { kind: "language"; code: LanguageCode } | { kind: "end"; data: unknown };

function recorder() {
  const events: Event[] = [];
  const channel: CallChannel = {
    sendText: (token, last, lang) => void events.push({ kind: "text", token, last, lang }),
    setLanguage: (code) => void events.push({ kind: "language", code }),
    end: (data) => void events.push({ kind: "end", data }),
  };
  return { events, channel };
}

function session(deps: ReturnType<typeof testDeps>, from: string | null, ch: CallChannel) {
  return new CallSession(deps, { callSid: `CA${Math.random().toString(36).slice(2)}`, from, to: "+16044757705" }, ch);
}

const switchTo = (language: LanguageCode, reply: string): ScriptedStep[] => [
  { tools: [{ name: "set_language", input: { language } }] },
  { text: reply },
];

describe("languages and caller memory", () => {
  it("a returning Cantonese caller gets the English greeting, then one Cantonese line, then Cantonese", async () => {
    const llm = new FakeLlm([{ text: "冇問題，聽日下晝三點有位。" }]);
    const deps = testDeps({ llm });
    const { events, channel } = recorder();
    const s = session(deps, DEMO_PHONES.returningCantonese, channel);
    await s.start();

    // First thing on the call: the English welcome greeting (played by Twilio from the TwiML).
    expect(s.log.record.transcript[0]).toMatchObject({ role: "agent", lang: "en-US" });
    expect(s.log.record.transcript[0].text).toBe(deps.config.welcomeGreeting);
    // Then one short Cantonese sentence, and the switch of voice plus transcription.
    expect(events[0]).toMatchObject({ kind: "text", lang: "zh-HK", last: true });
    expect(events[0].kind === "text" && events[0].token).toBe(deps.languages["zh-HK"].continueOffer);
    expect(events[1]).toEqual({ kind: "language", code: "zh-HK" });
    expect(s.log.record.transcript[1]).toMatchObject({ role: "agent", lang: "zh-HK" });

    await s.handlePrompt("我想約聽日剪頭髮");
    const texts = events.filter((e): e is Extract<Event, { kind: "text" }> => e.kind === "text");
    expect(texts.at(-1)).toMatchObject({ lang: "zh-HK", last: true });
    await s.close();
  });

  it("new and English-preference callers stay in the normal English flow", async () => {
    const deps = testDeps({ llm: new FakeLlm([{ text: "Sure." }]) });
    const { events, channel } = recorder();
    const s = session(deps, "+16045550101", channel);
    await s.start();
    expect(events).toEqual([]);
    expect(s.language).toBe("en-US");
    await s.close();
  });

  it("persists a language switch and uses it on the next call from that number", async () => {
    const deps = testDeps({ llm: new FakeLlm(switchTo("ko-KR", "네, 한국어로 도와드릴게요.")) });
    const phone = "+16045550142";
    const a = recorder();
    const s1 = session(deps, phone, a.channel);
    await s1.handlePrompt("안녕하세요, 커트 가격이 얼마예요?");
    expect(a.events).toContainEqual({ kind: "language", code: "ko-KR" });
    expect(deps.mockApi!.callers.get(phone)?.preferredLanguage).toBe("ko-KR");
    const toolResult = s1.log.record.toolCalls[0].result as { preferenceSaved: boolean };
    expect(toolResult.preferenceSaved).toBe(true);
    await s1.close();

    const b = recorder();
    const s2 = session(deps, phone, b.channel);
    await s2.start();
    expect(b.events[0]).toMatchObject({ kind: "text", lang: "ko-KR" });
    expect(b.events[1]).toEqual({ kind: "language", code: "ko-KR" });
    await s2.close();
  });

  it("saves English when a caller switches back", async () => {
    const deps = testDeps({ llm: new FakeLlm(switchTo("en-US", "Sure, English it is.")) });
    const { channel } = recorder();
    const s = session(deps, DEMO_PHONES.returningCantonese, channel);
    await s.start();
    expect(s.language).toBe("zh-HK");
    await s.handlePrompt("English please.");
    expect(s.language).toBe("en-US");
    expect(deps.mockApi!.callers.get(DEMO_PHONES.returningCantonese)?.preferredLanguage).toBe("en-US");
    await s.close();
  });

  it("never saves a preference for anonymous or withheld numbers", async () => {
    for (const from of [null, "anonymous", "+266696687", "client:anonymous"]) {
      const deps = testDeps({ llm: new FakeLlm(switchTo("zh-CN", "好的。")) });
      const { events, channel } = recorder();
      const s = session(deps, from, channel);
      await s.handlePrompt("你好");
      expect(events).toContainEqual({ kind: "language", code: "zh-CN" }); // still switches for this call
      expect(deps.mockApi!.callers.size).toBe(1); // only the seeded demo caller
      const result = s.log.record.toolCalls[0].result as { preferenceSaved: boolean };
      expect(result.preferenceSaved).toBe(false);
      expect(fs.existsSync(path.join(deps.config.dataDir, "callers.json"))).toBe(false);
      await s.close();
    }
  });

  it("falls back to the local store when the API is down, and syncs when it is back", async () => {
    const deps = testDeps({ llm: new FakeLlm(switchTo("zh-CN", "好的，我们用普通话。")) });
    const phone = "+16045550168";
    deps.mockApi!.offline = true;

    const s1 = session(deps, phone, recorder().channel);
    await s1.handlePrompt("你好，请问剪发多少钱？");
    await s1.close();
    const store = JSON.parse(fs.readFileSync(path.join(deps.config.dataDir, "callers.json"), "utf8"));
    expect(store[phone]).toMatchObject({ preferredLanguage: "zh-CN", pendingSync: true });
    expect(deps.mockApi!.callers.has(phone)).toBe(false);

    // Next call while the API is still down: the local store supplies the preference.
    const r2 = recorder();
    const s2 = session(deps, phone, r2.channel);
    await s2.start();
    expect(s2.caller?.source).toBe("local");
    expect(r2.events[1]).toEqual({ kind: "language", code: "zh-CN" });
    await s2.close();

    // API back: the pending preference is pushed to the source of truth.
    deps.mockApi!.offline = false;
    const s3 = session(deps, phone, recorder().channel);
    await s3.start();
    expect(s3.language).toBe("zh-CN");
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.mockApi!.callers.get(phone)?.preferredLanguage).toBe("zh-CN");
    await s3.close();
  });
});
