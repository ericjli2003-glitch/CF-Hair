import type { CallChannel } from "./agent/session.js";
import type { LanguageCode } from "./languages.js";
import type { SessionDeps } from "./agent/session.js";
import { openingGreeting } from "./relay/twiml.js";

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  agent: (s: string) => `\x1b[36m${s}\x1b[0m`,
  caller: (s: string) => `\x1b[33m${s}\x1b[0m`,
  sys: (s: string) => `\x1b[35m${s}\x1b[0m`,
};
export const colors = c;

/** Prints what the caller would hear, streaming sentence by sentence like ConversationRelay. */
export class TerminalChannel implements CallChannel {
  private midLine = false;
  endedWith: Record<string, unknown> | null = null;
  onEnd?: () => void;

  constructor(private readonly out: (s: string) => void = (s) => process.stdout.write(s)) {}

  sendText(token: string, last: boolean, lang: LanguageCode) {
    if (!this.midLine && token.trim()) {
      this.out(c.agent(`Agent${lang === "en-US" ? "" : ` [${lang}]`}: `));
      this.midLine = true;
    }
    if (token) this.out(c.agent(token.replace(/^\s+/, this.midLine ? " " : "")));
    if (last && this.midLine) {
      this.out("\n");
      this.midLine = false;
    }
  }

  setLanguage(code: LanguageCode) {
    if (this.midLine) {
      this.out("\n");
      this.midLine = false;
    }
    this.out(c.sys(`  [language switched: speech and voice now ${code}]\n`));
  }

  end(handoffData: Record<string, unknown>) {
    if (this.midLine) {
      this.out("\n");
      this.midLine = false;
    }
    this.endedWith = handoffData;
    this.out(c.sys(`  [ConversationRelay end: ${JSON.stringify(handoffData)}]\n`));
    this.onEnd?.();
  }

  /** Print the opening line that Twilio would play. */
  greet(text: string, lang: LanguageCode = "en-US") {
    this.out(c.agent(`Agent${lang === "en-US" ? "" : ` [${lang}]`}: ${text}\n`));
  }
}

/** What the /twiml webhook does before answering: pick the opening language and line for this caller. */
export async function opening(deps: SessionDeps, from: string) {
  const { language, known } = await deps.callers.openingLanguage(from, deps.config.openingLookupTimeoutMs);
  return {
    startLanguage: language,
    greeting: openingGreeting(known ? "returning" : "welcome", language, deps.config.welcomeGreeting, deps.languages),
  };
}
