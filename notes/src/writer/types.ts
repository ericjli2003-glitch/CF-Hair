import type { AltScript } from "../types.js";
import type { ClientContext } from "./prompt.js";

export interface DraftRequest {
  /** Stable id, also used as the Batches API custom_id (letters, digits, _ and - only). */
  id: string;
  system: string;
  user: string;
  ctx: ClientContext;
  /** Extra data for template writers; Claude never sees this. */
  meta: { campaignId: string; serviceId?: string; stylist?: string | null; altScript?: AltScript };
}

export interface Draft {
  message: string;
  messageAlt: string;
  refusal?: boolean;
  error?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  batchId?: string;
}

export interface NoteWriter {
  /** "claude:<model>" or "mock". */
  readonly name: string;
  readonly mock: boolean;
  readonly usage: Usage;
  /** Draft many notes. Implementations decide between batch and regular calls. */
  draftMany(reqs: DraftRequest[], opts?: { forceRegular?: boolean; log?: (m: string) => void }): Promise<Map<string, Draft>>;
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
