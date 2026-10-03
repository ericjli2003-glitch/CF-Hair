import { buildDeps } from "./bootstrap.js";
import { createServer, RELAY_PATH } from "./server.js";

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

server.listen(cfg.port, () => {
  console.log(`CF Hair voice agent listening on port ${cfg.port}`);
  console.log(`  Voice webhook: POST ${cfg.publicBaseUrl || "https://<public-host>"}/twiml`);
  console.log(`  ConversationRelay socket: ${RELAY_PATH}`);
  console.log(`  Model: ${cfg.anthropicModel} (effort ${cfg.anthropicEffort})`);
  console.log(`  Booking API: ${useMock ? "built-in mock" : cfg.bookingApiUrl}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
