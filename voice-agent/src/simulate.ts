/**
 * Interactive terminal call: type what the caller says, read what the agent would speak.
 * Runs the exact same CallSession, tools and prompt as the phone server.
 *
 *   npm run simulate -- --mock                    built-in mock booking API with sample data
 *   npm run simulate                              live API at BOOKING_API_URL
 *   npm run simulate -- --mock --from +16045550188   returning Cantonese caller in the mock data
 *
 * Commands: /dtmf <digit>, /interrupt <words heard>, /hangup, /new [phone], /help
 */
import readline from "node:readline";
import { buildDeps } from "./bootstrap.js";
import { claudeCredentialSource } from "./config.js";
import { CallSession } from "./agent/session.js";
import { DEMO_PHONES } from "./api/mock.js";
import { colors, opening, TerminalChannel } from "./terminal.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mock = process.argv.includes("--mock");
let from = arg("--from") ?? DEMO_PHONES.newCaller;
const deps = buildDeps({ mock, config: { validateTwilioSignature: false } });

if (claudeCredentialSource() === "none") {
  console.log(colors.sys("Note: ANTHROPIC_API_KEY is not set, so the agent cannot answer. Set it in .env first."));
}
console.log(colors.dim(`Model ${deps.config.anthropicModel} | booking API: ${mock ? "built-in mock" : deps.config.bookingApiUrl}`));
console.log(colors.dim("Type what the caller says. Commands: /dtmf 3, /interrupt <words heard>, /hangup, /new [phone], /help\n"));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: process.stdin.isTTY ? colors.caller("Caller: ") : "",
  terminal: process.stdin.isTTY,
});
let session: CallSession;
let channel: TerminalChannel;
let callNo = 0;

async function newCall(phone: string) {
  callNo++;
  channel = new TerminalChannel();
  channel.onEnd = () => {
    void hangup().then(() => console.log(colors.dim("Call ended by the agent. Type /new to start another call, or Ctrl+C to quit.")));
  };
  const open = await opening(deps, phone);
  session = new CallSession(deps, { callSid: `SIM${Date.now()}${callNo}`, from: phone, to: deps.salon.phone, ...open }, channel);
  console.log(colors.sys(`--- Incoming call from ${phone} ---`));
  channel.greet(open.greeting, open.startLanguage);
  await session.start();
}

async function hangup() {
  if (!session) return;
  const file = await session.close("caller");
  if (file) console.log(colors.dim(`Outcome: ${session.log.record.outcome}. Transcript saved to ${file}`));
}

let queue: Promise<void> = Promise.resolve();

async function handleLine(line: string) {
  const text = line.trim();
  try {
    if (text === "/help") {
      console.log("/dtmf <digit>  press a key (1 English, 2 Mandarin, 3 Cantonese, 4 Korean)");
      console.log("/interrupt <words>  barge in; <words> is what you heard before cutting in");
      console.log("/hangup  end the call as the caller;  /new [phone]  start another call");
    } else if (text.startsWith("/dtmf")) {
      await session.handleDtmf(text.split(/\s+/)[1] ?? "");
    } else if (text.startsWith("/interrupt")) {
      session.interrupt(text.slice("/interrupt".length).trim() || null);
      console.log(colors.dim("  [interrupted]"));
    } else if (text === "/hangup") {
      await hangup();
    } else if (text.startsWith("/new")) {
      await hangup();
      from = text.split(/\s+/)[1] ?? from;
      await newCall(from);
    } else if (text) {
      if (session.ended) console.log(colors.dim("The call has ended. Type /new to start another."));
      else {
        if (!process.stdin.isTTY) console.log(colors.caller(`Caller: ${text}`));
        await session.handlePrompt(text);
      }
    }
  } catch (err) {
    console.error(colors.sys(`Error: ${(err as Error).message}`));
  }
  rl.prompt();
}

// Lines are handled one at a time, so piped input (a script of caller lines) also works.
rl.on("line", (line) => {
  queue = queue.then(() => handleLine(line));
});

rl.on("close", async () => {
  await queue;
  await hangup();
  process.exit(0);
});

await newCall(from);
rl.prompt();
