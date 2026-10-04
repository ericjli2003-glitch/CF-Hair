import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  /** "auto" enables server-side refusal fallbacks on models that support them. */
  claudeFallbacks: "auto" | "on" | "off";
  maxTokens: number;
  bookingApiUrl: string;
  agentApiKey: string;
  apiTimeoutMs: number;
  callerLookupTimeoutMs: number;
  twilioAuthToken: string;
  validateTwilioSignature: boolean;
  salonForwardNumber: string;
  salonJsonPath: string;
  logDir: string;
  dataDir: string;
  callbackOnAbandon: boolean;
  endCallGraceMs: number;
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
    publicBaseUrl: env("PUBLIC_BASE_URL").replace(/\/+$/, ""),
    anthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
    anthropicEffort: env("ANTHROPIC_EFFORT", "low") as Effort,
    claudeFallbacks: env("CLAUDE_FALLBACKS", "auto") as AppConfig["claudeFallbacks"],
    maxTokens: envInt("ANTHROPIC_MAX_TOKENS", 4096),
    bookingApiUrl: env("BOOKING_API_URL", "http://localhost:3000").replace(/\/+$/, ""),
    agentApiKey: env("AGENT_API_KEY"),
    apiTimeoutMs: envInt("BOOKING_API_TIMEOUT_MS", 5000),
    callerLookupTimeoutMs: envInt("CALLER_LOOKUP_TIMEOUT_MS", 1500),
    twilioAuthToken: env("TWILIO_AUTH_TOKEN"),
    validateTwilioSignature: envBool("TWILIO_VALIDATE_SIGNATURE", true),
    salonForwardNumber: env("SALON_FORWARD_NUMBER"),
    salonJsonPath: env("SALON_JSON_PATH", path.resolve(PROJECT_ROOT, "..", "shared", "salon.json")),
    logDir: env("LOG_DIR", path.resolve(PROJECT_ROOT, "logs")),
    dataDir: env("DATA_DIR", path.resolve(PROJECT_ROOT, "data")),
    callbackOnAbandon: envBool("CALLBACK_ON_ABANDON", true),
    endCallGraceMs: envInt("END_CALL_GRACE_MS", 1200),
    welcomeGreeting: env(
      "WELCOME_GREETING",
      "Hi, thanks for calling CF Hair Salon at Henderson Place Mall. I'm the salon's virtual assistant. We can also help you in Mandarin, Cantonese, or Korean. How can I help you today?",
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
