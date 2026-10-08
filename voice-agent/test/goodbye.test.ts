import { describe, expect, it } from "vitest";
import { CallSession, isClosingWords, type CallChannel } from "../src/agent/session.js";
import type { LanguageCode } from "../src/languages.js";
import { FakeLlm, testDeps, waitFor } from "./helpers.js";

function call(reason: string, lang: LanguageCode = "en-US", byeListenMs = 0) {
  const llm = new FakeLlm((_p, i) =>
    i === 0
      ? { text: lang === "en-US" ? "OK, see you then." : "好，到時見。", tools: [{ name: "end_call", input: { reason } }] }
      : { text: "Henderson Place, unit twenty one forty." },
  );
  const deps = testDeps({ llm });
  deps.config.byeListenMs = byeListenMs;
  const said: { token: string; lang: string }[] = [];
  let ended = false;
  const channel: CallChannel = {
    sendText: (token, _last, l) => void said.push({ token, lang: l }),
    setLanguage: () => {},
    end: () => void (ended = true),
  };
  const s = new CallSession(deps, { callSid: `CA${reason}${lang}${byeListenMs}`, from: "+16045550123", to: "+16044757705", startLanguage: lang }, channel);
  return { s, said, isEnded: () => ended, deps, llm };
}

const text = (said: { token: string }[]) => said.map((t) => t.token).join("");

describe("goodbye", () => {
  it("adds one bye bye after the agent's goodbye, then hangs up", async () => {
    const { s, said, isEnded, deps } = call("completed");
    await s.handlePrompt("That's all, thanks.");
    expect(text(said)).toMatch(/see you then\..*Bye bye!$/);
    await waitFor(() => isEnded(), 3000);
    expect(s.log.record.transcript.at(-1)).toMatchObject({ role: "agent", text: deps.languages["en-US"].byes });
    await s.close();
  });

  it("says it in the caller's language", async () => {
    const { s, said } = call("completed", "zh-HK");
    await s.handlePrompt("冇喇，唔該。");
    expect(said.at(-1)).toEqual({ token: "拜拜！", lang: "zh-HK" });
    await s.close();
  });

  it("says bye bye only once, even when the caller says goodbye back", async () => {
    const { s, said, isEnded, llm } = call("completed", "en-US", 400);
    await s.handlePrompt("That's all, thanks.");
    await s.handlePrompt("Okay, bye bye.");
    expect(text(said).match(/Bye bye!/g)).toHaveLength(1);
    expect(llm.requests).toHaveLength(1); // no model call for the caller's goodbye
    await waitFor(() => isEnded(), 3000);
    await s.close();
  });

  it("does not add bye bye when the agent's own goodbye already said bye", async () => {
    const llm = new FakeLlm([{ text: "OK, see you then. Bye!", tools: [{ name: "end_call", input: { reason: "completed" } }] }]);
    const deps = testDeps({ llm });
    const said: string[] = [];
    const s = new CallSession(deps, { callSid: "CAbyeonce", from: "+16045550123", to: "+16044757705" }, {
      sendText: (t) => void said.push(t),
      setLanguage: () => {},
      end: () => {},
    });
    await s.handlePrompt("That's all.");
    expect(said.join("")).not.toContain("Bye bye");
    await s.close();
  });

  it("hangs up after the pause when the caller says nothing", async () => {
    const { s, said, isEnded } = call("completed", "en-US", 300);
    await s.handlePrompt("That's all, thanks.");
    expect(isEnded()).toBe(false);
    await waitFor(() => isEnded(), 4000);
    expect(text(said).match(/Bye bye!/g)).toHaveLength(1);
    await s.close();
  });

  it("a real question after bye bye gets an answer instead of a hang-up", async () => {
    const { s, said, isEnded, llm } = call("completed", "en-US", 400);
    await s.handlePrompt("That's all, thanks.");
    await s.handlePrompt("Oh wait, what's the address?");
    expect(llm.requests).toHaveLength(2);
    expect(text(said)).toContain("Henderson Place");
    await new Promise((r) => setTimeout(r, 2500));
    expect(isEnded()).toBe(false);
    await s.close();
  });

  it("skips it for spam calls", async () => {
    const { s, said } = call("spam");
    await s.handlePrompt("We are calling about your car's extended warranty.");
    expect(text(said)).not.toContain("Bye bye");
    await s.close();
  });
});

describe("isClosingWords", () => {
  it("recognises goodbyes and thanks in each language", () => {
    for (const t of ["Bye.", "okay bye bye", "Thank you so much, bye!", "see ya", "OK", "拜拜", "好，拜拜。", "唔該晒", "谢谢，再见", "네, 감사합니다", "안녕히 계세요"]) {
      expect(isClosingWords(t), t).toBe(true);
    }
  });
  it("leaves real questions and requests alone", () => {
    for (const t of ["What's the address?", "Can I change it to four?", "Actually make it Saturday", "幾點開門？", "地址係邊度", "주소가 어디예요"]) {
      expect(isClosingWords(t), t).toBe(false);
    }
  });
});
