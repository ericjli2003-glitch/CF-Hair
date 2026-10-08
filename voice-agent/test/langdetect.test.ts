import { describe, expect, it } from "vitest";
import { analyzeUtterance, chineseVariant, languageEvidence, LanguageDetector, chineseSwitchOk } from "../src/agent/langdetect.js";
import { CallSession, type CallChannel } from "../src/agent/session.js";
import { languageWarnings, relayLanguages, type LanguageCode } from "../src/languages.js";
import { conversationRelayTwiml } from "../src/relay/twiml.js";
import { FakeLlm, testDeps } from "./helpers.js";
import { opening } from "../src/terminal.js";

type Ev = { kind: "text"; token: string; last: boolean; lang: LanguageCode } | { kind: "language"; code: LanguageCode } | { kind: "end" };

function rec() {
  const events: Ev[] = [];
  const channel: CallChannel = {
    sendText: (token, last, lang) => void events.push({ kind: "text", token, last, lang }),
    setLanguage: (code) => void events.push({ kind: "language", code }),
    end: () => void events.push({ kind: "end" }),
  };
  return { events, channel, langs: () => events.filter((e) => e.kind === "language").map((e) => (e as { code: string }).code) };
}

const newSession = (deps: ReturnType<typeof testDeps>, from: string | null, ch: CallChannel, open: { startLanguage?: LanguageCode; greeting?: string } = {}) =>
  new CallSession(deps, { callSid: `CA${Math.random().toString(36).slice(2)}`, from, to: "+16044757705", ...open }, ch);

describe("Mandarin vs Cantonese from text cues", () => {
  const cases: [string, "zh-CN" | "zh-HK"][] = [
    ["你好，我想预约明天下午剪头发，多少钱？", "zh-CN"],
    ["请问你们星期六开门吗？", "zh-CN"],
    ["你好，我想約聽日下晝剪頭髮，幾多錢？", "zh-HK"],
    ["唔該，你哋星期六有冇開？", "zh-HK"],
    ["我係陳太，想改個時間", "zh-HK"],
    ["染頭髮要幾耐？", "zh-HK"],
  ];
  for (const [text, want] of cases) {
    it(`${text} -> ${want}`, () => expect(chineseVariant(analyzeUtterance(text))).toBe(want));
  }

  it("uses the provider tag or traditional characters only when there are no word cues", () => {
    expect(chineseVariant(analyzeUtterance("剪髮"), "yue")).toBe("zh-HK");
    expect(chineseVariant(analyzeUtterance("剪髮預約"))).toBe("zh-HK");
    expect(chineseVariant(analyzeUtterance("剪发预约"))).toBe("zh-CN");
  });
});

describe("LanguageDetector", () => {
  it("switches on script, and names the reason", () => {
    const d = new LanguageDetector();
    expect(d.observe("안녕하세요, 커트 예약하고 싶어요", "en-US")).toMatchObject({ action: "switch", to: "ko-KR" });
    expect(d.observe("你好，请问剪头发多少钱", "en-US")).toMatchObject({ action: "switch", to: "zh-CN" });
    expect(d.observe("你好，剪頭髮幾多錢呀", "en-US")).toMatchObject({ action: "switch", to: "zh-HK" });
  });

  it("does not switch on short or ambiguous utterances", () => {
    const d = new LanguageDetector();
    for (const t of ["OK", "Yes", "Kim", "Jenny Wong", "好", "Uh huh."]) expect(d.observe(t, "en-US").action).toBe("none");
  });

  it("switches on a language named in its own language or romanized", () => {
    const d = new LanguageDetector();
    expect(d.observe("gwong dung wa", "en-US")).toMatchObject({ action: "switch", to: "zh-HK" });
    expect(d.observe("한국어", "en-US")).toMatchObject({ action: "switch", to: "ko-KR" });
    expect(d.observe("可以講普通話嗎", "zh-HK")).toMatchObject({ action: "switch", to: "zh-CN" });
  });

  it("asks instead of guessing on romanized greetings, at most twice", () => {
    const d = new LanguageDetector({ askEnabled: true, maxAsks: 2 });
    expect(d.observe("Nei hou, um", "en-US")).toMatchObject({ action: "ask" });
    d.noteAsked();
    expect(d.observe("annyeong haseyo", "en-US")).toMatchObject({ action: "ask" });
    d.noteAsked();
    expect(d.observe("ni hao", "en-US").action).toBe("none");
  });

  it("asks when a multi-mode transcriber tags the speech as a language we cannot place", () => {
    const d = new LanguageDetector();
    expect(d.observe("Sumimasen", "en-US", "ja")).toMatchObject({ action: "ask" });
    expect(new LanguageDetector().observe("Hello there", "en-US", "en").action).toBe("none");
  });

  it("never leaves Korean on one English word; needs two English sentences", () => {
    const d = new LanguageDetector();
    expect(d.observe("OK", "ko-KR").action).toBe("none");
    expect(d.observe("Yes", "ko-KR").action).toBe("none");
    expect(d.observe("I want a haircut tomorrow", "ko-KR").action).toBe("none");
    expect(d.observe("네", "ko-KR").action).toBe("none"); // Korean in between resets the streak
    expect(d.observe("Can you do two o'clock", "ko-KR").action).toBe("none");
    expect(d.observe("Actually let's continue in this language", "ko-KR")).toMatchObject({ action: "switch", to: "en-US" });
  });

  it("moves Mandarin to Cantonese on Cantonese words but never auto-switches Cantonese to Mandarin", () => {
    const d = new LanguageDetector();
    expect(d.observe("你哋聽日有冇位？", "zh-CN")).toMatchObject({ action: "switch", to: "zh-HK" });
    expect(new LanguageDetector().observe("我想预约明天的时间，你们有吗？", "zh-HK").action).toBe("none");
  });

  it("vets Claude's set_language calls", () => {
    expect(languageEvidence("OK", "en-US").ok).toBe(false);
    expect(languageEvidence("English please", "en-US").ok).toBe(true);
    expect(languageEvidence("Could we switch back please", "en-US").ok).toBe(true);
    expect(languageEvidence("Kim", "ko-KR").ok).toBe(false);
    expect(languageEvidence("Do you speak Cantonese?", "zh-HK").ok).toBe(true);
    expect(languageEvidence("knee how mah", "zh-CN").ok).toBe(false);
    expect(languageEvidence("中文可以吗", "zh-HK").ok).toBe(true);
  });
});

describe("first-time callers are switched automatically", () => {
  const firstUtterances: [LanguageCode, string, string][] = [
    ["zh-CN", "你好，请问剪头发多少钱？", "+16045550301"],
    ["zh-HK", "你好，我想問下剪頭髮幾多錢？", "+16045550302"],
    ["ko-KR", "안녕하세요, 남자 커트 얼마예요?", "+16045550303"],
  ];
  for (const [code, utterance, phone] of firstUtterances) {
    it(`${code}: switches TTS and transcription, tells Claude, and saves the preference`, async () => {
      const llm = new FakeLlm([{ text: "OK." }]);
      const deps = testDeps({ llm });
      const r = rec();
      const s = newSession(deps, phone, r.channel);
      await s.start();
      expect(r.events).toEqual([]); // new caller: nothing after the English greeting
      await s.handlePrompt(utterance);
      expect(r.langs()).toEqual([code]);
      expect(s.languageSource).toBe("detected");
      expect(deps.mockApi!.callers.get(phone)?.preferredLanguage).toBe(code);
      const msgs = llm.requests[0].messages;
      expect(msgs.at(-2)).toEqual({ role: "user", content: [{ type: "text", text: utterance }] });
      expect(msgs.at(-1)).toMatchObject({ role: "system" });
      expect(String(msgs.at(-1)!.content)).toContain(code);
      const reply = r.events.filter((e) => e.kind === "text").at(-1) as Ev & { lang: string };
      expect(reply.lang).toBe(code);
      expect(s.log.record.transcript.find((t) => t.role === "caller")?.lang).toBe(code);
      await s.close();

      // Next call from that number opens in the language: greeting, voice and speech recognition.
      const r2 = rec();
      const open = await opening(deps, phone);
      expect(open.startLanguage).toBe(code);
      const s2 = newSession(deps, phone, r2.channel, open);
      await s2.start();
      expect(s2.log.record.transcript[0]).toMatchObject({ role: "agent", lang: code, text: deps.languages[code].greeting });
      expect(r2.events).toEqual([]);
      expect(s2.language).toBe(code);
      expect(s2.languageSource).toBe("saved");
      await s2.close();
    });
  }

  it("puts the notice in the user turn for models without mid-conversation system messages", async () => {
    const llm = new FakeLlm([{ text: "네." }]);
    const deps = testDeps({ llm });
    deps.config.anthropicModel = "claude-haiku-4-5";
    const s = newSession(deps, "+16045550304", rec().channel);
    await s.handlePrompt("안녕하세요");
    const last = llm.requests[0].messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain("ko-KR");
    await s.close();
  });

  it("switches an anonymous caller for the call but never saves it", async () => {
    const deps = testDeps({ llm: new FakeLlm([{ text: "好的。" }]) });
    const r = rec();
    const s = newSession(deps, "anonymous", r.channel);
    await s.handlePrompt("你好，请问几点关门？");
    expect(r.langs()).toEqual(["zh-CN"]);
    expect(deps.mockApi!.callers.size).toBe(1); // only the seeded demo caller
    await s.close();
  });

  it("asks one four-language question for a romanized greeting, without calling Claude", async () => {
    const llm = new FakeLlm([]);
    const deps = testDeps({ llm });
    const r = rec();
    const s = newSession(deps, "+16045550305", r.channel);
    await s.handlePrompt("Nei hou");
    expect(llm.requests).toHaveLength(0);
    const texts = r.events.filter((e): e is Extract<Ev, { kind: "text" }> => e.kind === "text");
    expect(texts.map((t) => t.lang)).toEqual(["en-US", "zh-CN", "zh-HK", "ko-KR"]);
    expect(texts.map((t) => t.last)).toEqual([false, false, false, true]);
    expect(r.langs()).toEqual([]); // nothing switched or saved on weak evidence
    expect(deps.mockApi!.callers.get("+16045550305")?.preferredLanguage ?? "en-US").toBe("en-US");
    // The caller presses 3: Cantonese, saved.
    await s.handleDtmf("3");
    expect(r.langs()).toEqual(["zh-HK"]);
    expect(s.languageSource).toBe("keypad");
    expect(deps.mockApi!.callers.get("+16045550305")?.preferredLanguage).toBe("zh-HK");
    await s.close();
  });

  it("Claude can ask the question for a nonsense transcript, which ends its reply", async () => {
    const llm = new FakeLlm([{ tools: [{ name: "ask_caller_language", input: { reason: "garbled" } }] }]);
    const deps = testDeps({ llm });
    const r = rec();
    const s = newSession(deps, "+16045550306", r.channel);
    await s.handlePrompt("Gay toe chin ah lay");
    expect(llm.requests).toHaveLength(1);
    const texts = r.events.filter((e): e is Extract<Ev, { kind: "text" }> => e.kind === "text");
    expect(texts.at(-1)).toMatchObject({ lang: "ko-KR", last: true });
    await s.close();
  });
});

describe("returning callers keep their language", () => {
  it("a Korean caller is not flipped to English by short English words, even if Claude tries", async () => {
    const llm = new FakeLlm([
      { text: "네." },
      { tools: [{ name: "set_language", input: { language: "en-US" } }] },
      { text: "네, 계속할게요." },
    ]);
    const deps = testDeps({ llm });
    await deps.mockApi!.putCaller("+16045550307", { preferredLanguage: "ko-KR" });
    const r = rec();
    const s = newSession(deps, "+16045550307", r.channel);
    await s.start();
    expect(r.events[0]).toMatchObject({ kind: "text", lang: "ko-KR" });
    await s.handlePrompt("OK");
    await s.handlePrompt("Yes");
    expect(s.language).toBe("ko-KR");
    const refused = s.log.record.toolCalls.find((t) => t.name === "set_language");
    expect(refused?.isError).toBe(true);
    expect(deps.mockApi!.callers.get("+16045550307")?.preferredLanguage).toBe("ko-KR");
    await s.close();
  });
});

describe("configuration", () => {
  it("can start transcription in Deepgram multi mode while greeting in English", () => {
    const xml = conversationRelayTwiml({
      wsUrl: "wss://x/relay",
      actionUrl: "https://x/twiml/action",
      greeting: "Hi",
      languages: relayLanguages({}),
      token: "t",
      startTranscription: "multi",
      startSpeechModel: "nova-3-general",
    });
    expect(xml).toContain('transcriptionLanguage="multi"');
    expect(xml).toContain('ttsLanguage="en-US"');
    expect(xml).toContain('transcriptionProvider="Deepgram"');
    expect(xml).not.toMatch(/ConversationRelay[^>]* language="/);
  });

  it("ignores multi mode when the call opens in a saved Chinese or Korean language", () => {
    const languages = relayLanguages({});
    const xml = conversationRelayTwiml({
      wsUrl: "wss://x/relay",
      actionUrl: "https://x/twiml/action",
      greeting: languages["ko-KR"].greeting,
      languages,
      token: "t",
      startLanguage: "ko-KR",
      opening: "returning",
      startTranscription: "multi",
    });
    expect(xml).toMatch(/<ConversationRelay[^>]* language="ko-KR"/);
    expect(xml).not.toContain('transcriptionLanguage="multi"');
    expect(xml).toMatch(/<ConversationRelay[^>]* voice="ko-KR-Chirp3-HD-Aoede"/);
  });

  it("ElevenLabs voices apply to the languages its relay models cover, not Cantonese", () => {
    const env = { CR_TTS_PROVIDER: "ElevenLabs", CR_ELEVENLABS_VOICE: "abc123" };
    const langs = relayLanguages(env);
    expect(langs["en-US"]).toMatchObject({ ttsProvider: "ElevenLabs", voice: "abc123" });
    expect(langs["zh-CN"].ttsProvider).toBe("ElevenLabs");
    expect(langs["ko-KR"].ttsProvider).toBe("ElevenLabs");
    expect(langs["zh-HK"].ttsProvider).toBe("Google");
    expect(languageWarnings(langs, env)).toEqual([]);
    const forced = relayLanguages({ ...env, CR_ZH_HK_TTS_PROVIDER: "ElevenLabs", CR_ZH_HK_VOICE: "abc123" });
    expect(languageWarnings(forced, env).join(" ")).toMatch(/zh-HK/);
    expect(relayLanguages({ ...env, CR_ELEVENLABS_MODEL: "turbo_v2_5" })["en-US"].voice).toBe("abc123-turbo_v2_5");
    expect(relayLanguages({})["en-US"].ttsProvider).toBe("Google"); // default unchanged
  });
});

describe("chineseSwitchOk", () => {
  it("never moves a Cantonese call to Mandarin because the transcript reads like Mandarin", () => {
    // How speech recognition writes Cantonese: standard written Chinese, full of 的 and 了.
    expect(chineseSwitchOk("zh-HK", "zh-CN", "我想明天下午剪头发的")).toBe(false);
    expect(chineseSwitchOk("zh-HK", "zh-CN", "我想讲普通话")).toBe(true);
    expect(chineseSwitchOk("zh-HK", "zh-CN", "Can you speak Mandarin?")).toBe(true);
  });

  it("moves Mandarin to Cantonese on clear Cantonese words or when asked", () => {
    expect(chineseSwitchOk("zh-CN", "zh-HK", "我想問下聽日有冇位")).toBe(true);
    expect(chineseSwitchOk("zh-CN", "zh-HK", "廣東話")).toBe(true);
    expect(chineseSwitchOk("zh-CN", "zh-HK", "我想剪头发")).toBe(false);
  });

  it("leaves switches to and from other languages alone", () => {
    expect(chineseSwitchOk("en-US", "zh-CN", "我想剪头发的")).toBe(true);
    expect(chineseSwitchOk("zh-HK", "en-US", "hello")).toBe(true);
  });
});
