import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Anthropic SDK lets ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN win over workload identity
// federation even when they are empty (for example a blank line copied from .env.example), so
// drop empty ones before any client is created.
for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
  if (process.env[name] !== undefined && process.env[name]!.trim() === "") delete process.env[name];
}

/** How the Claude client will authenticate: an API key or token, workload identity federation, or nothing. */
export function claudeCredentialSource(e: NodeJS.ProcessEnv = process.env): "api-key" | "federation" | "none" {
  if (e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN) return "api-key";
  const federation =
    e.ANTHROPIC_FEDERATION_RULE_ID &&
    e.ANTHROPIC_ORGANIZATION_ID &&
    e.ANTHROPIC_SERVICE_ACCOUNT_ID &&
    e.ANTHROPIC_IDENTITY_TOKEN_FILE;
  return federation ? "federation" : "none";
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** voice-agent/ (works from src/ under tsx and from dist/ after build). */
export const PROJECT_ROOT = path.resolve(here, "..");

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  anthropicModel: string;
  anthropicEffort: Effort;
  /** "off" (default): no extended thinking where the model allows it, for faster replies. "adaptive": the model decides. */
  anthropicThinking: "off" | "adaptive";
  /** "auto" enables server-side refusal fallbacks on models that support them. */
  claudeFallbacks: "auto" | "on" | "off";
  maxTokens: number;
  bookingApiUrl: string;
  agentApiKey: string;
  apiTimeoutMs: number;
  callerLookupTimeoutMs: number;
  /** How long the incoming-call webhook waits for the caller's saved language before opening in English. */
  openingLookupTimeoutMs: number;
  twilioAuthToken: string;
  validateTwilioSignature: boolean;
  salonForwardNumber: string;
  /** The salon's public number that forwards unanswered calls here; defaults to salon.json phone. */
  salonMainNumber: string;
  salonJsonPath: string;
  logDir: string;
  dataDir: string;
  callbackOnAbandon: boolean;
  endCallGraceMs: number;
  /** Ask the one promotional-text question after a phone booking. Off by default: it lengthens every call. */
  phoneSmsOptIn: boolean;
  /** Services whose openings are fetched at call start (empty turns the prefetch off). */
  prefetchServiceIds: string[];
  /** On SIGTERM (a redeploy), how long live calls may continue before the process exits. */
  drainTimeoutMs: number;
  welcomeGreeting: string;
  /** Detect the caller's language from transcripts and switch automatically. */
  autoDetectLanguage: boolean;
  /** When the evidence is weak, ask one short question in all four languages. */
  askLanguageQuestion: boolean;
  /** Transcription at call start: "en-US" (default) or "multi" (Deepgram automatic detection). */
  startTranscriptionLanguage: "en-US" | "multi";
  /** Speech model at call start when startTranscriptionLanguage is "multi". */
  startSpeechModel: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: Omit<AppConfig, "autoDetectLanguage" | "askLanguageQuestion" | "startTranscriptionLanguage" | "startSpeechModel"> = {
    port: envInt("PORT", 8080),
    // Render sets RENDER_EXTERNAL_URL (https://<service>.onrender.com) on every web service.
    publicBaseUrl: env("PUBLIC_BASE_URL", env("RENDER_EXTERNAL_URL")).replace(/\/+$/, ""),
    anthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
    anthropicEffort: env("ANTHROPIC_EFFORT", "low") as Effort,
    anthropicThinking: env("ANTHROPIC_THINKING", "off") === "adaptive" ? "adaptive" : "off",
    claudeFallbacks: env("CLAUDE_FALLBACKS", "auto") as AppConfig["claudeFallbacks"],
    maxTokens: envInt("ANTHROPIC_MAX_TOKENS", 4096),
    bookingApiUrl: env("BOOKING_API_URL", "http://localhost:3000").replace(/\/+$/, ""),
    agentApiKey: env("AGENT_API_KEY"),
    apiTimeoutMs: envInt("BOOKING_API_TIMEOUT_MS", 5000),
    callerLookupTimeoutMs: envInt("CALLER_LOOKUP_TIMEOUT_MS", 1500),
    openingLookupTimeoutMs: envInt("OPENING_LOOKUP_TIMEOUT_MS", 1000),
    twilioAuthToken: env("TWILIO_AUTH_TOKEN"),
    validateTwilioSignature: envBool("TWILIO_VALIDATE_SIGNATURE", true),
    salonForwardNumber: env("SALON_FORWARD_NUMBER"),
    salonMainNumber: env("SALON_MAIN_NUMBER"),
    salonJsonPath: env("SALON_JSON_PATH", path.resolve(PROJECT_ROOT, "..", "shared", "salon.json")),
    logDir: env("LOG_DIR", path.resolve(PROJECT_ROOT, "logs")),
    dataDir: env("DATA_DIR", path.resolve(PROJECT_ROOT, "data")),
    callbackOnAbandon: envBool("CALLBACK_ON_ABANDON", true),
    endCallGraceMs: envInt("END_CALL_GRACE_MS", 1200),
    drainTimeoutMs: envInt("DRAIN_TIMEOUT_MS", 280_000),
    phoneSmsOptIn: envBool("PHONE_SMS_OPTIN", false),
    prefetchServiceIds: env("PREFETCH_SERVICES", "mens-cut,womens-cut,kids-cut")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "off"),
    welcomeGreeting: env(
      "WELCOME_GREETING",
      "Hi, CF Hair Salon.",
    ),
  };
  const start = env("CR_START_TRANSCRIPTION_LANGUAGE", "en-US").toLowerCase() === "multi" ? "multi" : "en-US";
  const lang: Pick<AppConfig, "autoDetectLanguage" | "askLanguageQuestion" | "startTranscriptionLanguage" | "startSpeechModel"> = {
    autoDetectLanguage: envBool("LANG_AUTODETECT", true),
    askLanguageQuestion: envBool("LANG_ASK_QUESTION", true),
    startTranscriptionLanguage: start,
    startSpeechModel: env("CR_START_SPEECH_MODEL", "nova-3-general"),
  };
  return { ...base, ...lang, ...overrides };
}
