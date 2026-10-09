import { buildDeps } from "./bootstrap.js";
import { claudeCredentialSource } from "./config.js";
import { transferBlockReason } from "./transfer-guard.js";
import { createServer, RELAY_PATH } from "./server.js";
import { openAiAuthFromConfig } from "./s2s/openai-auth.js";
import { languageWarnings } from "./languages.js";

const useMock = process.env.MOCK_API === "true" || process.argv.includes("--mock");
const deps = buildDeps({ mock: useMock });
const { server, wss } = createServer(deps);
const cfg = deps.config;

const claudeAuth = claudeCredentialSource();
if (claudeAuth === "none") {
  console.warn(
    "Warning: no Claude credentials. Set ANTHROPIC_API_KEY, or workload identity federation " +
      "(ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID, ANTHROPIC_IDENTITY_TOKEN_FILE). Calls will fail until then.",
  );
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
  console.log(`  Model: ${cfg.anthropicModel} (effort ${cfg.anthropicEffort}), Claude auth: ${claudeAuth}`);
  console.log(
    `  Languages: start transcription ${cfg.startTranscriptionLanguage}, auto-detect ${cfg.autoDetectLanguage ? "on" : "off"}, voices ${Object.values(deps.languages).map((l) => `${l.code}=${l.ttsProvider}`).join(" ")}`,
  );
  console.log(`  Booking API: ${useMock ? "built-in mock" : cfg.bookingApiUrl}`);
  const openAi = openAiAuthFromConfig(cfg);
  const openAiMode = openAi.mode();
  console.log(
    `  Speech-to-speech test line: ${openAiMode !== "none" ? `on, POST /s2s/twiml (${cfg.realtimeModel}, voice ${cfg.realtimeVoice}), OpenAI auth: ${openAiMode}` : "off (set OPENAI_API_KEY, or OpenAI workload identity)"}`,
  );
  if (openAi.missing().length) console.warn(`  Warning: OpenAI workload identity is missing ${openAi.missing().join(", ")}`);
  console.log(
    `  Azure Voice Live test line: ${cfg.azureVoiceLiveEndpoint && cfg.azureVoiceLiveKey ? `on, POST /azure/twiml (${cfg.azureVoiceLiveModel}, voices ${Object.values(cfg.azureVoices).join(", ")})` : "off (set AZURE_VOICELIVE_ENDPOINT and AZURE_VOICELIVE_API_KEY)"}`,
  );
  console.log(`  MiniMax: ${cfg.minimaxApiKey ? `key set (${cfg.minimaxModel})` : "off (set MINIMAX_API_KEY)"}; Chinese voice choice: ${cfg.chineseVoice || "automatic"}`);
  console.log(
    `  ElevenLabs agent test line: ${cfg.elevenAgentApiKey && cfg.publicBaseUrl ? `on, POST /eleven/twiml (${cfg.elevenAgentLlm})` : "off (needs ELEVENLABS_API_KEY and the public URL)"}`,
  );
  console.log(`  Language ID for new callers: ${cfg.elevenLabsApiKey ? "ElevenLabs Scribe" : "off (set ELEVENLABS_API_KEY)"}`);
  const transferIssue = transferBlockReason({ target: cfg.salonForwardNumber, mainNumber: cfg.salonMainNumber || deps.salon.phone });
  if (!cfg.salonForwardNumber) console.log("  Transfers: off (SALON_FORWARD_NUMBER not set); callers can leave a message");
  else if (transferIssue) console.warn(`Warning: transfers disabled. ${transferIssue} Set SALON_FORWARD_NUMBER to the owner's mobile or a second line.`);
  else console.log(`  Transfers: to ${cfg.salonForwardNumber}`);
});

// A redeploy sends SIGTERM once the new instance is taking calls. Stop accepting new ones here,
// let calls in progress finish (up to DRAIN_TIMEOUT_MS), then exit.
let draining = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (draining) process.exit(0); // second signal: stop now
    draining = true;
    server.close();
    const deadline = Date.now() + cfg.drainTimeoutMs;
    console.log(`${sig} received: no new calls; waiting for ${wss.clients.size} live call(s) to finish`);
    const check = () => {
      if (wss.clients.size === 0) {
        // Give the last call's log and Calls tab report a moment to send.
        setTimeout(() => process.exit(0), 2000).unref();
        return;
      }
      if (Date.now() >= deadline) {
        console.warn(`Drain timeout: ending ${wss.clients.size} live call(s)`);
        process.exit(0);
      }
      setTimeout(check, 1000);
    };
    check();
  });
}
