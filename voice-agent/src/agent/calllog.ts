import fs from "node:fs";
import path from "node:path";
import type { Outcome } from "./tools.js";

export interface TranscriptEntry {
  at: string;
  role: "caller" | "agent" | "system";
  text: string;
  lang?: string;
  interrupted?: boolean;
}

export interface ToolCallEntry {
  at: string;
  name: string;
  input: unknown;
  result: unknown;
  isError: boolean;
  ms: number;
}

export interface CallRecord {
  callSid: string;
  from: string | null;
  to: string | null;
  anonymous: boolean;
  startedAt: string;
  endedAt?: string;
  endedBy?: "agent" | "caller" | "transfer" | "error";
  outcome?: Outcome;
  outcomes: { outcome: Outcome; at: string; detail?: Record<string, unknown> }[];
  languages: { at: string; language: string; reason: string }[];
  model: string;
  transcript: TranscriptEntry[];
  toolCalls: ToolCallEntry[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; requests: number };
  callbackPosted?: boolean;
  /** end_call reason (completed, spam, caller_request, no_response, technical_error). */
  endReason?: string;
  /** Id returned by POST /api/messages for this call's callback message. */
  messageId?: string;
  /** Answer to the promotional text question, if it was asked on this call. */
  smsOptIn?: { accepted: boolean; language: string; saved: boolean };
  errors: string[];
}

/** Collects one call's transcript and outcome and writes it to logs/ as JSON when the call ends. */
export class CallLog {
  readonly record: CallRecord;

  constructor(
    private readonly dir: string,
    init: { callSid: string; from: string | null; to: string | null; anonymous: boolean; model: string },
  ) {
    this.record = {
      ...init,
      startedAt: new Date().toISOString(),
      outcomes: [],
      languages: [],
      transcript: [],
      toolCalls: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 },
      errors: [],
    };
  }

  say(role: TranscriptEntry["role"], text: string, extra: Partial<TranscriptEntry> = {}) {
    if (!text.trim()) return;
    this.record.transcript.push({ at: new Date().toISOString(), role, text, ...extra });
  }

  /** Mark the most recent agent line as cut off, keeping only what was heard. */
  trimLastAgentLine(spoken: string) {
    for (let i = this.record.transcript.length - 1; i >= 0; i--) {
      const e = this.record.transcript[i];
      if (e.role === "agent") {
        e.text = spoken;
        e.interrupted = true;
        return;
      }
      if (e.role === "caller") return;
    }
  }

  tool(entry: Omit<ToolCallEntry, "at">) {
    this.record.toolCalls.push({ at: new Date().toISOString(), ...entry });
  }

  addUsage(u: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  }) {
    const r = this.record.usage;
    r.input += u.input_tokens ?? 0;
    r.output += u.output_tokens ?? 0;
    r.cacheRead += u.cache_read_input_tokens ?? 0;
    r.cacheWrite += u.cache_creation_input_tokens ?? 0;
    r.requests += 1;
  }

  /** Writes the file and returns its path. */
  write(): string {
    fs.mkdirSync(this.dir, { recursive: true });
    const stamp = this.record.startedAt.replace(/[:.]/g, "-");
    const file = path.join(this.dir, `${stamp}_${this.record.callSid.replace(/[^\w-]/g, "")}.json`);
    fs.writeFileSync(file, JSON.stringify(this.record, null, 2));
    return file;
  }
}
