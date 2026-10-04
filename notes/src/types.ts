/** Shared types for the CF Hair handwritten notes pipeline. */

export type IsoDate = string; // YYYY-MM-DD in salon local time (America/Vancouver)

export interface MailingAddress {
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string; // ISO 3166 alpha-2, "CA" for every salon client so far
}

/** Booking API language codes (docs/ARCHITECTURE.md, "Languages"). */
export type LanguageCode = "en-US" | "zh-CN" | "zh-HK" | "ko-KR";
/** Script of the optional second-language version of a card. */
export type AltScript = "zh-Hans" | "zh-Hant" | "ko";

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  address?: MailingAddress;
  firstVisit?: IsoDate;
  lastVisit?: IsoDate;
  visitCount: number;
  favouriteStaffId?: string;
  /** Resolved display name of the favourite stylist, filled in by the data loader. */
  favouriteStaffName?: string;
  lastServiceId?: string;
  lastServiceName?: string;
  /** "MM-DD" or "YYYY-MM-DD". Only month and day are ever used. */
  birthday?: string;
  preferredLanguage: LanguageCode;
  /** ISO timestamp of the earliest upcoming confirmed booking, if any. */
  nextBookingAt?: string;
  tags: string[];
  /** Client id of whoever referred this client, if known. */
  referredBy?: string;
  /** Short stylist notes a client would expect the salon to remember, e.g. "loves her curtain bangs". */
  notes?: string;
}

export interface Staff {
  id: string;
  name: string;
}

/** Audience rules. Combine with all/any/not. Days are whole calendar days in salon time. */
export type AudienceRule =
  | { all: AudienceRule[] }
  | { any: AudienceRule[] }
  | { not: AudienceRule }
  | { rule: "everyone" }
  | { rule: "firstVisitWithinDays"; days: number }
  | { rule: "birthdayWithinDays"; days: number }
  | { rule: "lastVisitBetweenDays"; min: number; max: number }
  | { rule: "minVisits"; count: number }
  | { rule: "maxVisits"; count: number }
  | { rule: "hasTag"; tag: string }
  | { rule: "preferredLanguage"; language: LanguageCode | "zh" }
  | { rule: "hasUpcomingBooking" }
  | { rule: "referredSomeoneWithinDays"; days: number };

export type DedupeScope = "once" | "year" | "lastVisit" | "firstVisit" | "referral";

export interface Offer {
  code: string;
  description: string;
  expires?: IsoDate;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  occasion: string;
  audience: AudienceRule;
  design: string;
  guidelines: string;
  maxChars: number;
  /** Limit for the Chinese version; Korean gets 1.4x because Hangul needs spaces. */
  maxCharsAlt: number;
  signature: { template: string; fallback: string };
  offer?: Offer | null;
  dedupe: DedupeScope;
  /** Write a second version in the client's language (zh-CN, zh-HK or ko-KR). */
  secondLanguage: boolean;
  /** Skip clients who already have an upcoming booking ("come back" campaigns). */
  excludeIfBooked?: boolean;
  /** Ignore the global "no two cards within N days" cooldown (e.g. birthdays). */
  ignoreCooldown?: boolean;
  handwrytten?: { cardId?: string | number | null; font?: string | null };
}

export interface AudienceMatch {
  client: Client;
  reasons: string[];
  occasion: {
    birthdayDate?: IsoDate;
    daysUntilBirthday?: number;
    daysSinceLastVisit?: number;
    daysSinceFirstVisit?: number;
    referred?: { id: string; firstName: string; firstVisit?: IsoDate };
  };
  idempotencyKey: string;
}

export interface Exclusion {
  client: Client;
  reason: string;
}

export type NoteStatus = "ok" | "needs_attention";

export interface NoteIssue {
  code:
    | "too_long"
    | "too_long_alt"
    | "empty"
    | "emoji"
    | "dash"
    | "unsupported_char"
    | "missing_name"
    | "sensitive_detail"
    | "salesy"
    | "signature_too_long"
    | "offer_missing"
    | "alt_missing"
    | "wrong_script"
    | "translated_place"
    | "refusal"
    | "api_error";
  message: string;
}

export interface Note {
  noteId: string;
  idempotencyKey: string;
  campaignId: string;
  clientId: string;
  recipient: {
    firstName: string;
    lastName: string;
    address?: MailingAddress;
  };
  preferredLanguage: LanguageCode;
  /** Script of messageAlt, when a second-language version was requested. */
  altScript?: AltScript;
  stylistName?: string;
  lastServiceName?: string;
  visitCount: number;
  reasons: string[];
  message: string;
  messageAlt?: string;
  signature: string;
  charCount: number;
  charCountAlt?: number;
  maxChars: number;
  maxCharsAlt: number;
  issues: NoteIssue[];
  status: NoteStatus;
  writer: string; // "claude:<model>" or "mock"
  attempts: number;
}

export interface RunManifest {
  runId: string;
  campaignId: string;
  campaignName: string;
  design: string;
  occasion: string;
  today: IsoDate;
  generatedAt: string;
  writer: string;
  mock: boolean;
  providerForLimits: string;
  /** Where the clients came from: "csv:<file>" or "api:<url>". */
  source?: string;
  offer?: Offer | null;
  notes: Note[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; batchId?: string };
}

export interface ApprovedFile {
  runId: string;
  campaignId: string;
  exportedAt: string;
  approvedBy?: string;
  approved: Array<{
    noteId: string;
    idempotencyKey: string;
    message: string;
    messageAlt?: string;
    signature: string;
    edited?: boolean;
  }>;
}
