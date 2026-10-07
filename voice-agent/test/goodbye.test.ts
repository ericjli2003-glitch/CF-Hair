import { describe, expect, it } from "vitest";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import type { LanguageCode } from "../src/languages.js";
import { FakeLlm, testDeps, waitFor } from "./helpers.js";

function call(reason: string, lang: LanguageCode = "en-US") {
  const llm = new FakeLlm([{ text: lang === "en-US" ? "OK, see you then." : "好，到時見。", tools: [{ name: "end_call", input: { reason } }] }]);
  const deps = testDeps({ llm });
  const said: { token: string; lang: string }[] = [];
  let ended = false;
  const channel: CallChannel = {
    sendText: (token, _last, l) => void said.push({ token, lang: l }),
    setLanguage: () => {},
    end: () => void (ended = true),
  };
  const s = new CallSession(deps, { callSid: `CA${reason}${lang}`, from: "+16045550123", to: "+16044757705", startLanguage: lang }, channel);
  return { s, said, isEnded: () => ended, deps };
}

describe("trailing goodbyes", () => {
  it("adds bye, bye, bye after the agent's goodbye, then hangs up", async () => {
    const { s, said, isEnded, deps } = call("completed");
    await s.handlePrompt("That's all, thanks.");
    const text = said.map((t) => t.token).join("");
    expect(text).toMatch(/see you then\..*Bye, bye, bye!$/);
    await waitFor(() => isEnded(), 3000);
    expect(s.log.record.transcript.at(-1)).toMatchObject({ role: "agent", text: deps.languages["en-US"].byes });
    await s.close();
  });

  it("says them in the caller's language", async () => {
    const { s, said } = call("completed", "zh-HK");
    await s.handlePrompt("冇喇，唔該。");
    expect(said.at(-1)).toEqual({ token: "拜拜，拜拜，拜拜！", lang: "zh-HK" });
    await s.close();
  });

  it("skips them for spam calls", async () => {
    const { s, said } = call("spam");
    await s.handlePrompt("We are calling about your car's extended warranty.");
    expect(said.map((t) => t.token).join("")).not.toContain("Bye, bye, bye");
    await s.close();
  });
});
