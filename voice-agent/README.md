# CF Hair Salon phone receptionist

An AI receptionist that answers the salon's phone when nobody can: it books, moves and cancels
appointments, answers questions about prices, hours, parking and policies, takes messages, and
transfers to a person when the salon is open. It speaks English, Mandarin, Cantonese and Korean,
and remembers each caller's language.

Twilio handles the phone line, speech recognition and the voice (ConversationRelay). Claude
handles the conversation. Bookings go into the same booking API as the website, so the website,
the admin screen and the phone all see the same calendar.

## Contents

- [Try it without a phone](#try-it-without-a-phone)
- [Architecture](#architecture)
- [Languages and caller memory](#languages-and-caller-memory)
- [Twilio setup, step by step](#twilio-setup-step-by-step)
- [Running locally with ngrok](#running-locally-with-ngrok)
- [Deploying](#deploying)
- [Cost per call minute](#cost-per-call-minute)
- [Configuration](#configuration)
- [Tests](#tests)
- [Call logs](#call-logs)
- [Known gaps and things to confirm before go-live](#known-gaps-and-things-to-confirm-before-go-live)

## Try it without a phone

```bash
cd voice-agent
npm install
cp .env.example .env        # put ANTHROPIC_API_KEY in it
npm run demo                # five scripted sample calls against a built-in mock calendar
npm run simulate -- --mock  # type as the caller, read what the receptionist would say
```

`npm run demo` plays these calls and prints the transcript, the tools used, the outcome and the
token usage of each:

1. A new caller books a men's haircut for tomorrow afternoon.
2. A Mandarin speaker asks about prices (the agent switches to Mandarin).
3. An existing client reschedules an appointment.
4. A Korean speaker asks about a men's cut and Saturday hours.
5. A returning caller whose saved language is Cantonese: English greeting, then Cantonese.

Run a subset with `npm run demo -- 1 5`.

`npm run simulate` runs the exact same agent loop, prompt and tools as the phone server. Useful flags
and commands:

| | |
|---|---|
| `--mock` | Use the built-in in-memory booking API with sample data. Without it, it uses `BOOKING_API_URL`. |
| `--from +16045550188` | Pretend to call from this number (this one is the sample returning Cantonese caller). |
| `/dtmf 3` | Press a key. 1 English, 2 Mandarin, 3 Cantonese, 4 Korean. |
| `/interrupt We have ten` | Barge in, as if you heard "We have ten" and then started talking. |
| `/hangup`, `/new [phone]` | Hang up; start another call. |

You can also pipe a script: `printf 'Hi\nHow much is a men'"'"'s cut?\n' | npm run simulate -- --mock`.

`npm run mock-api` serves the same mock calendar over HTTP on port 3999, so you can run the real
phone server against it (`BOOKING_API_URL=http://localhost:3999`) before the website is deployed.

## Architecture

```
Caller ── phone ──> Twilio number ── POST /twiml ──> voice-agent (this service)
                         │                              │ returns <Connect><ConversationRelay>
                         │ ConversationRelay            │
                         │ speech-to-text, voice        │
                         └──── WebSocket /relay ───────>│ CallSession
                              text in, text out         │   Claude (streaming, tools, prompt caching)
                                                        │   tools ── HTTPS + x-api-key ──> website /api/*
                                                        │   logs/<call>.json
              <Connect action> /twiml/action <──────────┘ on "end": <Dial> the salon, or hang up
```

How a turn works:

1. Twilio transcribes the caller and sends a `prompt` message over the WebSocket.
2. `CallSession` streams Claude's reply. Each finished sentence is sent to Twilio immediately as a
   `text` token (`last: false`), so the caller hears the first sentence while the rest is still
   being written. The final token of the reply has `last: true`.
3. If Claude calls a tool (check availability, book, and so on), the tool calls the booking API
   and the result goes back to Claude, which then continues speaking.
4. If the caller talks over the agent, Twilio sends `interrupt` with the text that was actually
   played. The agent aborts the stream and trims its own history to what the caller heard, so it
   never assumes the caller heard a sentence they cut off.
5. `transfer_to_human` and `end_call` send ConversationRelay `end` once the last sentence has had
   time to play. Twilio then requests `/twiml/action`, which returns `<Dial>` to
   `SALON_FORWARD_NUMBER` for a transfer (or `<Hangup/>`). If nobody answers the transfer,
   `/twiml/dial-status` reconnects the caller to the agent to take a message.

Main files:

| File | What it does |
|---|---|
| `src/server.ts` | Express routes (`/twiml`, `/twiml/action`, `/twiml/dial-status`, `/health`), Twilio signature validation, WebSocket upgrade on `/relay` |
| `src/relay/handler.ts` | ConversationRelay message protocol: `setup`, `prompt`, `interrupt`, `dtmf`, `error` in; `text`, `language`, `end` out |
| `src/relay/twiml.ts` | TwiML for ConversationRelay (greeting, voices, four `<Language>` entries, per-call token), transfer and fallback TwiML |
| `src/agent/session.ts` | One call: Claude streaming loop, sentence streaming, tools, barge-in trimming, language switching, hang-up timing, call log |
| `src/agent/prompt.ts` | Persona and system prompt (static, cached) and the per-call context (time, open or closed, caller, language) |
| `src/agent/tools.ts` | Tool definitions, input validation (zod), and tool execution with offline fallbacks |
| `src/callers.ts` | Caller memory: language preference by phone number, API first, local file fallback |
| `src/api/http.ts`, `src/api/mock.ts` | Booking API client per `docs/ARCHITECTURE.md`, and the in-memory mock |
| `src/simulate.ts`, `src/demo.ts` | Terminal simulator and scripted demo, using the same `CallSession` |

### Claude settings

- Model: `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`, with effort `low` (`ANTHROPIC_EFFORT`) so
  replies start quickly. `claude-haiku-4-5` lowers latency and cost further; it handles simple calls
  well but is less reliable at multi-step booking changes.
- Prompt caching: the tools and the static system prompt carry a cache breakpoint with a one hour
  TTL (calls to a salon are minutes apart, so a five minute cache would usually be cold); the
  growing conversation uses automatic caching. Per-call details (time, caller, language) sit after
  the cached block so they never invalidate it. Each call log records cache reads and writes.
- Refusal fallback: for Sonnet 5.5 the request opts into Anthropic's server-side fallback
  (`fallbacks: "default"`), so a rare safety-classifier decline is retried on another model instead of
  leaving the caller with silence. Set `CLAUDE_FALLBACKS=off` to disable.
- History is append-only (no edits to earlier turns), which keeps the cache warm and keeps Claude's
  thinking blocks valid. The only edit is trimming the agent's last reply after a barge-in.

### Tools

| Tool | Notes |
|---|---|
| `get_services` | Live list from the API; falls back to `shared/salon.json` if the API is down |
| `check_availability` | Up to eight times for a service and date; if the day is full, the next days with openings |
| `book_appointment` | Requires `confirmed_with_caller: true`; phone defaults to caller ID; source `phone` |
| `lookup_bookings` | By caller ID unless another number is given |
| `cancel_booking`, `reschedule_booking` | Require confirmation; flags short-notice cancellations |
| `take_message` | `POST /api/messages`; if the API is down it is queued in `data/pending-messages.jsonl` |
| `transfer_to_human` | Only while open and if `SALON_FORWARD_NUMBER` is set; `end` with handoff data, then `<Dial>` |
| `end_call` | Hangs up after the goodbye has played |
| `set_language` | Switches voice and transcription and saves the caller's language (see below) |

If the booking API is unreachable, the agent still answers questions from `shared/salon.json`, does
not promise times, and takes a message so the team can call back to book.

## Languages and caller memory

Supported languages (codes from `docs/ARCHITECTURE.md`): English `en-US`, Mandarin `zh-CN`,
Cantonese `zh-HK`, Korean `ko-KR`. All four are declared as `<Language>` entries in the TwiML, each
with its own voice and speech recognition settings (`src/languages.ts`), because Twilio rejects a
switch to a language that was not declared.

**Every call starts in English.** The welcome greeting is always English and is played by Twilio
the moment the call connects. It ends with "We can also help you in Mandarin, Cantonese, or Korean."

**Returning callers.** The ConversationRelay `setup` message carries the caller's number. The agent
looks the caller up right then (`GET /api/callers/{phone}`), while the greeting is still playing, so
the lookup adds no delay. Then:

- Saved language is English, or the number is new: nothing changes. The call stays in English and
  only switches if the caller speaks another language.
- Saved language is Mandarin, Cantonese or Korean: right after the English greeting the agent says
  one short sentence in that language (for example, in Cantonese, "Hello, we can continue in
  Cantonese. How can I help?"), switches text-to-speech and transcription to it, and carries on in
  it. If the caller answers in English or asks for English, it switches back and saves English.

**Switching during a call.** When the caller speaks or asks for another language, Claude calls
`set_language`. That sends ConversationRelay a `language` message (both `ttsLanguage` and
`transcriptionLanguage`) and saves the preference with `PUT /api/callers/{phone}`. Switching back to
English saves English. Callers can also press 1 (English), 2 (Mandarin), 3 (Cantonese) or 4 (Korean)
at any time.

**Privacy.** Nothing is looked up or saved for withheld, anonymous, restricted or unknown caller IDs
(including Twilio's placeholder numbers such as `+266696687`). The language still switches for
that call; it is just not remembered.

**When the website API is down.** Preferences are also written to a small local file,
`voice-agent/data/callers.json` (gitignored). If the API cannot be reached (lookup timeout
`CALLER_LOOKUP_TIMEOUT_MS`, default 1.5 s), the agent uses the local record. A preference saved
while the API was down is marked `pendingSync` and pushed to the API the next time that number calls
and the API is reachable. The API stays the source of truth otherwise. The agent also increments
`callCount` and saves the caller's name after a booking or message.

**One limitation to know.** Speech recognition listens in the call's current language. A caller who
starts speaking Cantonese while the call is still in English may be transcribed as garbled English.
The prompt tells Claude to treat garbled or romanized speech ("nei hou", "annyeong") as a hint and
switch, and the greeting tells callers they can ask for their language, but the keypad shortcut is
the most reliable path for a first-time caller. Returning callers are not affected. Twilio also
offers automatic language detection (`transcriptionLanguage="multi"` with Deepgram, which requires
ElevenLabs voices); it would remove this gap and is worth testing once the basic setup works, but it
is not enabled here because it changes the voice provider and the "always greet in English" flow.

## Twilio setup, step by step

1. **Create and upgrade a Twilio account** at twilio.com. A trial account plays a trial message and
   can only call verified numbers, so upgrade (add a card) before the demo.
2. **Turn on the AI features.** In the Console go to Voice > Settings > General and enable the
   "Predictive and Generative AI/ML Features Addendum". ConversationRelay does not connect until this
   is accepted.
3. **Buy a local number.** Phone Numbers > Manage > Buy a number. Country: Canada. Tick Voice.
   Search by area code `604` or `778` (both Lower Mainland). Buy it. If Twilio asks for an address,
   use the salon's business address.
4. **Point the number at this server.** Phone Numbers > Manage > Active numbers > your number >
   Voice Configuration:
   - "A call comes in": Webhook, `https://<your-public-host>/twiml`, HTTP POST.
   - "Primary handler fails" (recommended): a TwiML Bin containing
     `<Response><Dial>+1604XXXXXXX</Dial></Response>` with the salon's landline, so calls still ring
     the salon if this server is down.
   - Save.
5. **Copy credentials** from the Console home page into `.env`: `TWILIO_ACCOUNT_SID` and
   `TWILIO_AUTH_TOKEN`. The auth token is used to validate the `X-Twilio-Signature` header on every
   webhook and to sign a per-call token that the WebSocket `setup` message must carry.
6. **Set the transfer number**: `SALON_FORWARD_NUMBER=+1604...` (the salon landline or the owner's
   mobile).
7. **Go live in stages.** Start by forwarding only unanswered calls to the Twilio number (most
   carriers support "forward on no answer" or "forward when busy"), so the AI picks up only the calls
   the salon would have missed. Later the main number can be ported to Twilio if wanted.
8. **Check voices and languages.** In the Console's ConversationRelay voice list, confirm the
   voices in `src/languages.ts` (Google Chirp3-HD voices for all four languages) are available on
   your account, and change them with the `CR_<LANG>_VOICE` variables if needed. Then place a test
   call per language (press 2, 3 and 4).

## Running locally with ngrok

```bash
cd voice-agent
npm install
cp .env.example .env     # ANTHROPIC_API_KEY, TWILIO_*, AGENT_API_KEY, SALON_FORWARD_NUMBER
npm run dev              # listens on PORT (8080)
# in another terminal
ngrok http 8080
```

Set `PUBLIC_BASE_URL` in `.env` to the `https://...ngrok...` URL (no trailing slash), restart
`npm run dev`, and set the Twilio number's webhook to `https://<ngrok-host>/twiml`. The server
derives the `wss://` URL for ConversationRelay from it. Signature validation uses this exact URL,
so it must match what is in the Twilio console.

To run without the website: `npm run mock-api` in a third terminal and set
`BOOKING_API_URL=http://localhost:3999`, or start the server with `MOCK_API=true`.

## Deploying

The service needs a public HTTPS URL, WebSocket support, and must stay warm (a cold start would
leave a caller in silence). Build from the repository root so `shared/salon.json` is included:

```bash
docker build -f voice-agent/Dockerfile -t cf-hair-voice-agent .
docker run -p 8080:8080 --env-file voice-agent/.env cf-hair-voice-agent
```

### Fly.io

From the repository root:

```bash
fly launch --no-deploy --name cf-hair-voice --dockerfile voice-agent/Dockerfile --region sea
fly secrets set ANTHROPIC_API_KEY=... TWILIO_AUTH_TOKEN=... TWILIO_ACCOUNT_SID=... \
  AGENT_API_KEY=... BOOKING_API_URL=https://<website> SALON_FORWARD_NUMBER=+1604... \
  PUBLIC_BASE_URL=https://cf-hair-voice.fly.dev
fly volumes create voice_data --size 1 --region sea   # optional: keep logs and caller fallback store
fly deploy
```

In `fly.toml` set `internal_port = 8080`, `auto_stop_machines = "off"` and
`min_machines_running = 1`, and if you created the volume, mount it at `/app/voice-agent/data`
(set `LOG_DIR=/app/voice-agent/data/logs` to keep call logs there too). Seattle (`sea`) is the
closest region to Coquitlam. A shared-cpu-1x 256 MB machine is enough for one salon.

### Render

New > Web Service > from this repo. Runtime: Docker. Dockerfile path: `voice-agent/Dockerfile`.
Docker build context: the repository root. Instance type: Starter or higher (the free tier sleeps,
which would drop calls). Add the same environment variables, with `PUBLIC_BASE_URL` set to the
`https://<service>.onrender.com` URL, and a persistent disk mounted at `/app/voice-agent/data` if you
want call logs and the caller fallback store to survive deploys. Health check path: `/health`.

After deploying, update the Twilio number's webhook to `https://<host>/twiml`.

## Cost per call minute

Checked on 2026-10-03. Prices in USD.

| Item | Price | Source |
|---|---|---|
| Twilio inbound call to a Canadian local number | $0.0085 per minute | [Twilio Voice pricing, Canada](https://www.twilio.com/en-us/voice/pricing/ca) |
| Twilio ConversationRelay (speech-to-text and text-to-speech included) | $0.07 per minute | [Twilio Conversational AI pricing](https://www.twilio.com/en-us/products/conversational-ai/pricing) |
| Twilio Canadian local number | $1.15 per month | [Twilio Voice pricing, Canada](https://www.twilio.com/en-us/voice/pricing/ca) |
| Transferred calls: outbound leg to a Canadian number | $0.014 per minute, transfers only | [Twilio Voice pricing, Canada](https://www.twilio.com/en-us/voice/pricing/ca) |
| Claude Sonnet 5.5 | $2 input, $10 output per million tokens; cache reads $0.20, 5 minute cache writes $2.50, 1 hour writes $4 | [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Haiku 4.5 | $1 input, $5 output; cache reads $0.10, 5 minute writes $1.25, 1 hour writes $2 | same |

Token estimate per call minute, for a typical booking call: about 4 caller turns and 6 Claude
requests per minute (tool calls add requests). The cached prefix (tools plus system prompt) is about
4,500 tokens and the conversation adds about 500 tokens per request.

| Per minute | Sonnet 5.5 | Haiku 4.5 |
|---|---|---|
| Cache reads, 6 x ~5,500 tokens | $0.0066 | $0.0033 |
| Cache writes for new conversation, 6 x ~500 tokens | $0.0075 | $0.0038 |
| Output and brief thinking, 6 x ~100 tokens | $0.0060 | $0.0030 |
| One hour prompt cache write, amortized over a 3 minute call | ~$0.006 | ~$0.003 |
| **Claude total** | **~$0.026** | **~$0.013** |
| Twilio voice + ConversationRelay | $0.0785 | $0.0785 |
| **Total per minute** | **~$0.10 USD (about $0.14 CAD)** | **~$0.09 USD** |

So a typical three minute booking call costs about 30 US cents. At 300 calls a month averaging three
minutes, that is about $95 USD a month, plus $1.15 for the number and roughly $5 to $10 for hosting.
Twilio is about three quarters of the per-minute cost. The Twilio figures above were taken from
Twilio's pricing pages via search because twilio.com could not be fetched from the build
environment; confirm them in the Twilio console before quoting the owner. Each call log in `logs/`
records the real token usage so the estimate can be checked after the first week.

## Configuration

All settings are environment variables; see `.env.example` for the full list with comments. The
important ones: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `BOOKING_API_URL`, `AGENT_API_KEY`,
`TWILIO_AUTH_TOKEN`, `PUBLIC_BASE_URL`, `SALON_FORWARD_NUMBER`.

Salon facts (hours, services, prices, stylists, policies) come from `shared/salon.json` at startup
and from the live API during calls. Restart after editing the JSON. Parking and transit directions
are in `src/agent/prompt.ts`.

## Tests

```bash
npm test
```

Vitest suites, all offline (Claude is replaced by a scripted fake that streams word by word):

- `test/tools.test.ts`: tool argument validation (confirmation required, date formats, enums,
  unknown fields, tool name typos), offline fallbacks.
- `test/mock-api.test.ts`: booking flow over HTTP against the mock API (availability, booking,
  double-booking 409, lookup, reschedule, cancel, messages, callers, API key), and the booking
  tools end to end.
- `test/relay.test.ts`: real HTTP server and WebSocket client. Signature validation, TwiML contents,
  per-call token, sentence streaming with the `last` flag, barge-in (`interrupt`) aborting the
  stream and trimming history, keypad language switch, returning Cantonese caller, transfer with
  handoff data, call log and abandoned-call callback.
- `test/languages.test.ts`: returning Cantonese caller hears English then Cantonese, a switch is
  persisted and used next call, switching back saves English, anonymous callers are never saved, and
  the API being down falls back to the local store and syncs later.
- `test/chunker.test.ts`: sentence splitting (English, Chinese, Korean), interrupt matching, phone
  number and language code helpers.

`npm run typecheck` checks types; `npm run build` compiles to `dist/`.

## Call logs

Every call writes `logs/<start time>_<CallSid>.json` (gitignored) with the transcript (what the
caller said, what the agent said, interrupted lines marked), every tool call with input, result and
timing, language switches, token usage, errors, and the outcome: `booked`, `rescheduled`,
`cancelled`, `message`, `transferred`, `info-only` or `abandoned`. When a caller hangs up mid-booking
or mid-question, a low-urgency callback message is posted to `/api/messages` (turn off with
`CALLBACK_ON_ABANDON=false`). Messages that cannot be posted are kept in
`data/pending-messages.jsonl`.

Logs contain phone numbers and what callers said. Keep them on the server, delete them on a schedule
(for example after 90 days), and mention call recording or transcription in the salon's privacy
notice, as BC's PIPA expects.

## Known gaps and things to confirm before go-live

- **Twilio language codes and voices not verified against twilio.com.** The Twilio docs site was
  blocked from the build environment. The message shapes were checked against the Twilio Node SDK's
  TwiML types and a maintained open-source ConversationRelay implementation; the Cantonese and Korean
  voice names (`yue-HK-Chirp3-HD-Aoede`, `ko-KR-Chirp3-HD-Aoede`), the use of Deepgram `nova-3` for
  `zh-CN` and `zh-HK`, and Google `telephony` for Korean transcription should be confirmed in the
  console. All are overridable per language with `CR_<LANG>_*` variables.
- **No real call has been placed yet** and the scripted demo needs an `ANTHROPIC_API_KEY`.
- **First-time non-English callers** are transcribed in English until the switch (see above).
- **Hang-up timing** after a goodbye is estimated from text length, because ConversationRelay does
  not report when speech finishes. `END_CALL_GRACE_MS` adds margin.
- **Salon data is placeholder** (services, prices, stylist names, policies, parking, hours are
  marked "reported" or "placeholder" in `shared/salon.json`). Confirm with the owner.
- **Transfers** ring one number with a 20 second timeout and no whisper; if nobody answers, the caller
  comes back to the agent to leave a message.
- **Pending messages** queued while the API was down are not replayed automatically.
