/**
 * Scripted demo: plays sample calls against the built-in mock booking API and prints the
 * transcript, using the real Claude agent loop and tools. Needs ANTHROPIC_API_KEY.
 *
 *   npm run demo                 all calls
 *   npm run demo -- 2 4          only calls 2 and 4
 */
import { buildDeps } from "./bootstrap.js";
import { CallSession } from "./agent/session.js";
import { DEMO_PHONES } from "./api/mock.js";
import { colors, TerminalChannel } from "./terminal.js";

interface DemoCall {
  title: string;
  from: string;
  lines: string[];
}

const CALLS: DemoCall[] = [
  {
    title: "New caller books a men's haircut",
    from: DEMO_PHONES.newCaller,
    lines: [
      "Hi, can I book a men's haircut for tomorrow afternoon?",
      "Anyone is fine. What's the earliest you have after two?",
      "Yes, that works. My name is Alex Chen.",
      "Yes, that's correct, this number is fine.",
      "No, that's everything. Thanks!",
    ],
  },
  {
    title: "First-time Mandarin speaker asks about prices (detected automatically)",
    from: DEMO_PHONES.mandarin,
    lines: ["你好，请问你们女士剪发多少钱？", "染发呢？全头染多少钱？要多长时间？", "好的，谢谢你，再见。"],
  },
  {
    title: "Existing client reschedules",
    from: DEMO_PHONES.rescheduler,
    lines: [
      "Hi, I need to move my appointment please.",
      "Can I do the same time the next day instead?",
      "Yes please, go ahead.",
      "That's it, thank you so much.",
    ],
  },
  {
    title: "First-time Korean caller asks about a men's cut and Saturday hours (detected automatically)",
    from: DEMO_PHONES.korean,
    lines: ["안녕하세요, 남자 커트 가격이 얼마예요?", "토요일에도 문 열어요? 몇 시까지 해요?", "네, 감사합니다. 안녕히 계세요."],
  },
  {
    title: "Returning caller with a saved Cantonese preference",
    from: DEMO_PHONES.returningCantonese,
    lines: ["你好，我想問下聽日下晝有冇位剪女士頭髮？", "唔使喇，我遲啲再打嚟。唔該晒，拜拜。"],
  },
  {
    title: "First-time Cantonese caller who just starts speaking (detected, then remembered)",
    from: DEMO_PHONES.newCantonese,
    lines: ["你好，我想問下你哋星期日幾點開門？", "剪女士頭髮幾多錢呀？", "好，唔該晒，拜拜。"],
  },
];

async function playCall(call: DemoCall, n: number, deps: ReturnType<typeof buildDeps>) {
  console.log(colors.sys(`\n=== Call ${n}: ${call.title} (from ${call.from}) ===`));
  const channel = new TerminalChannel();
  const session = new CallSession(deps, { callSid: `DEMO${n}${Date.now()}`, from: call.from, to: deps.salon.phone }, channel);
  channel.greet(deps.config.welcomeGreeting);
  await session.start();
  for (const line of call.lines) {
    if (session.ended) break;
    console.log(colors.caller(`Caller: ${line}`));
    await session.handlePrompt(line);
  }
  // Let a pending goodbye or transfer fire, then hang up.
  await new Promise((r) => setTimeout(r, 300));
  const file = await session.close(session.ended ? "agent" : "caller");
  await session.reported;
  const posted = deps.mockApi!.calls.get(session.init.callSid);
  if (posted) console.log(colors.sys(`Calls tab: [${posted.outcome}, ${posted.language} via ${posted.languageSource}] ${posted.summary}`));
  const r = session.log.record;
  const tools = r.toolCalls.map((t) => `${t.name}${t.isError ? " (error)" : ""}`).join(", ") || "none";
  console.log(colors.dim(`Outcome: ${r.outcome} | tools: ${tools} | languages: ${r.languages.map((l) => `${l.language} (${l.reason})`).join(" > ") || "en-US"}`));
  console.log(
    colors.dim(
      `Tokens: ${r.usage.input} input, ${r.usage.cacheRead} cache read, ${r.usage.cacheWrite} cache write, ${r.usage.output} output over ${r.usage.requests} requests | log: ${file}`,
    ),
  );
}

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error("ANTHROPIC_API_KEY is not set. Put it in voice-agent/.env, then run npm run demo again.");
  process.exit(1);
}

const pick = process.argv.slice(2).map(Number).filter((n) => n >= 1 && n <= CALLS.length);
const deps = buildDeps({ mock: true, config: { validateTwilioSignature: false, endCallGraceMs: 0 } });
console.log(colors.dim(`Model ${deps.config.anthropicModel}, effort ${deps.config.anthropicEffort}, mock booking API with sample data.`));
for (const [i, call] of CALLS.entries()) {
  if (pick.length && !pick.includes(i + 1)) continue;
  await playCall(call, i + 1, deps);
}
const m = deps.mockApi!;
console.log(colors.sys(`\nMock API after the demo: ${m.bookings.filter((b) => b.source === "phone" && b.notes?.includes("phone agent")).length} new booking(s), ${m.messages.length} message(s).`));
for (const [phone, p] of m.callers) console.log(colors.dim(`  caller ${phone}: preferredLanguage ${p.preferredLanguage}, calls ${p.callCount}`));
