import fs from "node:fs";
import path from "node:path";
import { ApiUnavailableError, type BookingApi, type CallerProfile } from "./api/types.js";
import { DEFAULT_LANGUAGE, normalizeLanguage, type LanguageCode } from "./languages.js";
import { isAnonymousCaller, toE164 } from "./phone.js";

interface LocalCallerRecord {
  phone: string;
  preferredLanguage: LanguageCode;
  name?: string;
  callCount: number;
  lastCallAt?: string;
  updatedAt: string;
  /** True when this record changed while the API was unreachable and has not been pushed yet. */
  pendingSync?: boolean;
}

/**
 * Small JSON file store used when the website API is unreachable.
 * Writes are synchronous and tiny (one record per caller), which is fine for one salon.
 */
export class LocalCallerStore {
  private cache: Record<string, LocalCallerRecord> | null = null;
  constructor(private readonly file: string) {}

  private load(): Record<string, LocalCallerRecord> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache ?? {}, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get(phone: string): LocalCallerRecord | undefined {
    return this.load()[phone];
  }

  upsert(phone: string, patch: Partial<LocalCallerRecord>): LocalCallerRecord {
    const all = this.load();
    const cur: LocalCallerRecord = all[phone] ?? {
      phone,
      preferredLanguage: DEFAULT_LANGUAGE,
      callCount: 0,
      updatedAt: new Date().toISOString(),
    };
    const next = { ...cur, ...patch, phone, updatedAt: new Date().toISOString() };
    all[phone] = next;
    this.save();
    return next;
  }
}

export interface CallerInfo {
  phone: string | null;
  anonymous: boolean;
  preferredLanguage: LanguageCode;
  name: string | null;
  callCount: number;
  /** Where the profile came from. */
  source: "api" | "local" | "default";
  /**
   * True only when the website says this number has no promotional SMS answer on file
   * (never opted in, never opted out, never declined). False when unknown (API down).
   */
  smsOptInAskable: boolean;
}

/**
 * Remembers each caller's preferred language (and name) by phone number.
 * The website API (/api/callers/{phone}) is the source of truth; the local store is a fallback.
 * Withheld or anonymous numbers are never looked up or saved.
 */
export class CallerMemory {
  constructor(
    private readonly api: BookingApi,
    private readonly local: LocalCallerStore,
    private readonly lookupTimeoutMs = 1500,
  ) {}

  /** Look up the caller and count this call. Never throws. */
  async beginCall(rawPhone: string | null | undefined): Promise<CallerInfo> {
    const anonymous = isAnonymousCaller(rawPhone);
    const phone = anonymous ? null : toE164(rawPhone);
    if (!phone) {
      return { phone: null, anonymous: true, preferredLanguage: DEFAULT_LANGUAGE, name: null, callCount: 0, source: "default", smsOptInAskable: false };
    }
    const localRec = this.local.get(phone);
    try {
      const profile = await withTimeout(this.api.getCaller(phone), this.lookupTimeoutMs);
      let info = fromProfile(phone, profile, "api");
      if (localRec?.pendingSync) {
        // A preference saved while the API was down wins; push it now.
        info = { ...info, preferredLanguage: localRec.preferredLanguage, name: localRec.name ?? info.name };
        void this.api
          .putCaller(phone, { preferredLanguage: localRec.preferredLanguage, ...(localRec.name ? { name: localRec.name } : {}) })
          .then(() => this.local.upsert(phone, { pendingSync: false }))
          .catch(() => {});
      }
      void this.api.putCaller(phone, { incrementCallCount: true }).catch(() => {
        this.local.upsert(phone, { callCount: (localRec?.callCount ?? 0) + 1, lastCallAt: new Date().toISOString() });
      });
      this.local.upsert(phone, {
        preferredLanguage: info.preferredLanguage,
        ...(info.name ? { name: info.name } : {}),
        callCount: info.callCount + 1,
        lastCallAt: new Date().toISOString(),
      });
      return info;
    } catch {
      const rec = this.local.upsert(phone, {
        callCount: (localRec?.callCount ?? 0) + 1,
        lastCallAt: new Date().toISOString(),
      });
      return {
        phone,
        anonymous: false,
        preferredLanguage: localRec ? rec.preferredLanguage : DEFAULT_LANGUAGE,
        name: rec.name ?? null,
        callCount: localRec?.callCount ?? 0,
        source: localRec ? "local" : "default",
        smsOptInAskable: false,
      };
    }
  }

  /**
   * The saved language for this number, read before the call is answered so the greeting, voice
   * and speech recognition can start in it. Does not count the call (beginCall does). Never throws:
   * withheld numbers, unknown numbers and a slow or unreachable API all give English.
   */
  async openingLanguage(rawPhone: string | null | undefined, timeoutMs: number): Promise<{ language: LanguageCode; known: boolean }> {
    const english = { language: DEFAULT_LANGUAGE, known: false };
    if (isAnonymousCaller(rawPhone)) return english;
    const phone = toE164(rawPhone);
    if (!phone) return english;
    const localRec = this.local.get(phone);
    // A preference saved while the API was down has not reached the website yet, so it wins.
    if (localRec?.pendingSync) return { language: localRec.preferredLanguage, known: true };
    try {
      const p = await withTimeout(this.api.getCaller(phone), timeoutMs);
      const language = normalizeLanguage(String(p.preferredLanguage ?? "")) ?? DEFAULT_LANGUAGE;
      return { language, known: (p.callCount ?? 0) > 0 || language !== DEFAULT_LANGUAGE };
    } catch {
      return localRec ? { language: localRec.preferredLanguage, known: true } : english;
    }
  }

  /** Save the caller's language. Returns where it was saved, or "skipped" for anonymous callers. */
  async saveLanguage(phone: string | null, language: LanguageCode): Promise<"api" | "local" | "skipped"> {
    if (!phone || isAnonymousCaller(phone)) return "skipped";
    try {
      await this.api.putCaller(phone, { preferredLanguage: language });
      this.local.upsert(phone, { preferredLanguage: language, pendingSync: false });
      return "api";
    } catch (err) {
      this.local.upsert(phone, { preferredLanguage: language, pendingSync: true });
      if (!(err instanceof ApiUnavailableError)) console.warn(`[callers] PUT preferredLanguage failed: ${(err as Error).message}`);
      return "local";
    }
  }

  async saveName(phone: string | null, name: string): Promise<void> {
    if (!phone || isAnonymousCaller(phone) || !name.trim()) return;
    try {
      await this.api.putCaller(phone, { name: name.trim() });
      this.local.upsert(phone, { name: name.trim() });
    } catch {
      this.local.upsert(phone, { name: name.trim(), pendingSync: true });
    }
  }
}

function fromProfile(phone: string, p: CallerProfile, source: CallerInfo["source"]): CallerInfo {
  return {
    phone,
    anonymous: false,
    preferredLanguage: normalizeLanguage(String(p.preferredLanguage ?? "")) ?? DEFAULT_LANGUAGE,
    name: p.name ?? null,
    callCount: p.callCount ?? 0,
    source,
    smsOptInAskable: p.smsConsent?.canAsk === true,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ApiUnavailableError(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
