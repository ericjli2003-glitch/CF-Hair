import { buildDeps } from "./bootstrap.js";
import { createServer, RELAY_PATH } from "./server.js";
import { languageWarnings } from "./languages.js";

const useMock = process.env.MOCK_API === "true" || process.argv.includes("--mock");
const deps = buildDeps({ mock: useMock });
const { server } = createServer(deps);
const cfg = deps.config;

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("Warning: ANTHROPIC_API_KEY is not set. Calls will fail until it is.");
}
if (cfg.validateTwilioSignature && !cfg.twilioAuthToken) {
  console.warn("Warning: TWILIO_AUTH_TOKEN is not set, so webhooks will be refused. For local tests set TWILIO_VALIDATE_SIGNATURE=false.");
}

for (const w of languageWarnings(deps.languages)) console.warn(`Warning: ${w}`);

// Calls queued while the website was unreachable are retried on startup (and after each call).
void deps.reporter?.flush().then(() => {
  const left = deps.reporter?.pendingCount() ?? 0;
  if (left) console.warn(`Warning: ${left} call record(s) still queued for the website Calls tab.`);
});

server.listen(cfg.port, () => {
  console.log(`CF Hair voice agent listening on port ${cfg.port}`);
  console.log(`  Voice webhook: POST ${cfg.publicBaseUrl || "https://<public-host>"}/twiml`);
  console.log(`  ConversationRelay socket: ${RELAY_PATH}`);
  console.log(`  Model: ${cfg.anthropicModel} (effort ${cfg.anthropicEffort})`);
  console.log(
    `  Languages: start transcription ${cfg.startTranscriptionLanguage}, auto-detect ${cfg.autoDetectLanguage ? "on" : "off"}, voices ${Object.values(deps.languages).map((l) => `${l.code}=${l.ttsProvider}`).join(" ")}`,
  );
  console.log(`  Booking API: ${useMock ? "built-in mock" : cfg.bookingApiUrl}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
