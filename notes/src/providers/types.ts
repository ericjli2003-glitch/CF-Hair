import type { Campaign, MailingAddress, Note } from "../types.js";

/** One approved card ready for a provider. Text comes from the approved list, address from the run. */
export interface SendItem {
  note: Note;
  campaign: Campaign;
  message: string;
  messageZh?: string;
  signature: string;
  address: MailingAddress;
}

export interface SendContext {
  /** Provider-side test mode (Handwrytten test_mode=1). Never mails, never recorded as sent. */
  testMode: boolean;
}

export interface SendResult {
  providerRef: string;
  /** Files written (plotter) or a short human summary. */
  detail?: string;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly maxMessageChars: number;
  readonly maxSignatureChars: number;
  /** Provider-specific problems that would stop this card going out. */
  validate(item: SendItem): string[];
  /** What a real send would transmit or write, for --dry-run. */
  preview(item: SendItem): unknown;
  /** Runs once before the first real send (credentials, empty basket...). */
  preflight?(ctx: SendContext): Promise<void>;
  send(item: SendItem, ctx: SendContext): Promise<SendResult>;
  /** Card + postage, CAD. */
  costPerCardCAD(): number;
}
