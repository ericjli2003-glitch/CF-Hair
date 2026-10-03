/**
 * Local sent-history store (JSON file). It is the idempotency ledger: a card
 * is mailed at most once per idempotency key, and a key stuck in "submitting"
 * (crash mid-send) blocks re-sending until a human checks the provider dashboard.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { IsoDate } from "./types.js";

export type HistoryStatus = "submitting" | "sent" | "failed" | "test";

export interface HistoryRecord {
  idempotencyKey: string;
  campaignId: string;
  clientId: string;
  noteId: string;
  runId: string;
  provider: string;
  status: HistoryStatus;
  providerRef?: string;
  error?: string;
  updatedAt: string;
  sentOn?: IsoDate;
}

interface HistoryFile {
  version: 1;
  records: HistoryRecord[];
}

export class History {
  private data: HistoryFile;

  constructor(readonly file: string) {
    this.data = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as HistoryFile)
      : { version: 1, records: [] };
  }

  get records(): readonly HistoryRecord[] {
    return this.data.records;
  }

  get(key: string): HistoryRecord | undefined {
    return this.data.records.find((r) => r.idempotencyKey === key);
  }

  /** True when the key was mailed, or might have been (submitting). */
  isBlocked(key: string): boolean {
    const r = this.get(key);
    return !!r && (r.status === "sent" || r.status === "submitting");
  }

  /** Most recent real send date for a client, for the cross-campaign cooldown. */
  lastSentOn(clientId: string): IsoDate | undefined {
    let last: IsoDate | undefined;
    for (const r of this.data.records) {
      if (r.clientId === clientId && r.status === "sent" && r.sentOn && (!last || r.sentOn > last)) last = r.sentOn;
    }
    return last;
  }

  upsert(rec: Omit<HistoryRecord, "updatedAt">): void {
    const full: HistoryRecord = { ...rec, updatedAt: new Date().toISOString() };
    const i = this.data.records.findIndex((r) => r.idempotencyKey === rec.idempotencyKey);
    if (i >= 0) this.data.records[i] = full;
    else this.data.records.push(full);
    this.save();
  }

  /** Atomic write: temp file then rename, so a crash never leaves half a ledger. */
  save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
}

/** Exclusive lock so two `send` commands cannot run against the same ledger. */
export function withHistoryLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let fd: number;
  try {
    fd = openSync(lock, "wx");
  } catch {
    throw new Error(`Another send is running (lock file ${lock}). If not, delete the lock file and retry.`);
  }
  closeSync(fd);
  return fn().finally(() => {
    try {
      unlinkSync(lock);
    } catch {
      /* already gone */
    }
  });
}
