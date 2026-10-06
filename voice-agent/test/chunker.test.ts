import { describe, expect, it } from "vitest";
import { SentenceChunker } from "../src/agent/chunker.js";
import { CallSession, spokenLength } from "../src/agent/session.js";
import { FakeLlm, testDeps } from "./helpers.js";
import { isAnonymousCaller, toE164 } from "../src/phone.js";
import { normalizeLanguage } from "../src/languages.js";

function feed(text: string, size = 3) {
  const c = new SentenceChunker();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...c.push(text.slice(i, i + size)));
  const rest = c.flush();
  if (rest) out.push(rest);
  return out.map((s) => s.trim());
}

describe("sentence chunking", () => {
  it("emits sentences as soon as they end, starting the first one at its first comma", () => {
    expect(feed("Sure, I can help. What day works? Great, thanks!")).toEqual(["Sure,", "I can help.", "What day works?", "Great, thanks!"]);
    expect(feed("OK. Men's or women's?")).toEqual(["OK.", "Men's or women's?"]);
  });
  it("never splits a number at its thousands comma", () => {
    expect(feed("It is 1,500 dollars. OK?")).toEqual(["It is 1,500 dollars.", "OK?"]);
  });
  it("splits Chinese and Korean sentences", () => {
    expect(feed("好的。请问哪天方便？谢谢！")).toEqual(["好的。", "请问哪天方便？", "谢谢！"]);
    expect(feed("好呀，聽日三點有位。")).toEqual(["好呀，", "聽日三點有位。"]);
    expect(feed("네, 가능해요. 몇 시가 좋으세요?")).toEqual(["네,", "가능해요.", "몇 시가 좋으세요?"]);
  });
  it("does not split decimals or common abbreviations", () => {
    expect(feed("It is 4.5 hours with Dr. Lee. Okay?")).toEqual(["It is 4.5 hours with Dr. Lee.", "Okay?"]);
  });
});

describe("spoken length after an interrupt", () => {
  it("matches ignoring case and punctuation", () => {
    const full = "Sure. We have openings at ten. We also have eleven.";
    expect(full.slice(0, spokenLength(full, "sure we have openings at"))).toBe("Sure. We have openings at");
    expect(full.slice(0, spokenLength(full, "Sure. We have openings at ten."))).toBe("Sure. We have openings at ten.");
  });
  it("works for Chinese", () => {
    const full = "好的。我们有十点和十一点。";
    expect(full.slice(0, spokenLength(full, "好的。我们有十点"))).toBe("好的。我们有十点");
  });
});

describe("phone numbers and language codes", () => {
  it("normalizes and detects withheld numbers", () => {
    expect(toE164("(604) 555-1234")).toBe("+16045551234");
    expect(isAnonymousCaller("+16045551234")).toBe(false);
    for (const v of [null, "", "anonymous", "Restricted", "+266696687", "client:alice", "12"]) expect(isAnonymousCaller(v)).toBe(true);
  });
  it("maps provider codes onto supported languages", () => {
    expect(normalizeLanguage("yue-HK")).toBe("zh-HK");
    expect(normalizeLanguage("cmn-CN")).toBe("zh-CN");
    expect(normalizeLanguage("ko")).toBe("ko-KR");
    expect(normalizeLanguage("fr-FR")).toBeNull();
  });
});


describe("barge-in after the reply finished generating", () => {
  it("trims the completed reply while TTS is still playing, keeping the history valid", async () => {
    const llm = new FakeLlm([{ text: "We open at ten. We close at six. Walk-ins are welcome." }, { text: "Yes." }]);
    const deps = testDeps({ llm });
    const ch = { sendText: () => {}, setLanguage: () => {}, end: () => {} };
    const s = new CallSession(deps, { callSid: "CAx", from: "+16045550123", to: null }, ch);
    await s.handlePrompt("When are you open?");
    s.interrupt("We open at ten. We close");
    await s.handlePrompt("Is Sunday different?");
    const assistant = llm.requests[1].messages.filter((m) => m.role === "assistant");
    expect(assistant[0].content).toEqual([{ type: "text", text: "We open at ten. We close..." }]);
    const agentLines = s.log.record.transcript.filter((t) => t.role === "agent");
    expect(agentLines[1]).toMatchObject({ text: "We open at ten. We close...", interrupted: true });
    await s.close();
  });
});
