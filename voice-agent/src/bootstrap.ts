import path from "node:path";
import { DateTime } from "luxon";
import { loadConfig, type AppConfig } from "./config.js";
import { loadSalon } from "./salon.js";
import { HttpBookingApi } from "./api/http.js";
import { InMemoryBookingApi } from "./api/mock.js";
import type { BookingApi } from "./api/types.js";
import { CallerMemory, LocalCallerStore } from "./callers.js";
import { relayLanguages } from "./languages.js";
import { AnthropicLlm, type LlmClient } from "./agent/llm.js";
import { staticSystemPrompt } from "./agent/prompt.js";
import type { SessionDeps } from "./agent/session.js";

/** Wire everything together. Shared by the server, the simulator and the demo. */
export function buildDeps(
  opts: { mock?: boolean; config?: Partial<AppConfig>; llm?: LlmClient; api?: BookingApi; now?: () => DateTime } = {},
): SessionDeps & { mockApi?: InMemoryBookingApi } {
  const config = loadConfig(opts.config);
  // Keep mock runs (demo, simulate --mock) from touching the real caller store.
  if (opts.mock && !opts.config?.dataDir) config.dataDir = path.join(config.dataDir, "mock");
  const salon = loadSalon(config.salonJsonPath);
  const mockApi = opts.mock ? new InMemoryBookingApi(salon, { seedDemoData: true, now: opts.now }) : undefined;
  const api = opts.api ?? mockApi ?? new HttpBookingApi(config.bookingApiUrl, config.agentApiKey, config.apiTimeoutMs);
  const callers = new CallerMemory(api, new LocalCallerStore(path.join(config.dataDir, "callers.json")), config.callerLookupTimeoutMs);
  return {
    config,
    salon,
    api,
    callers,
    llm: opts.llm ?? new AnthropicLlm(),
    languages: relayLanguages(),
    staticPrompt: staticSystemPrompt(salon),
    now: opts.now,
    mockApi,
  };
}
