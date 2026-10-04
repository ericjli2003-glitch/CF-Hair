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
- [Why Twilio ConversationRelay and not ElevenLabs?](#why-twilio-conversationrelay-and-not-elevenlabs)
- [Promotional text opt-in](#promotional-text-opt-in)
- [Calls tab](#calls-tab)
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
npm run demo                # six scripted sample calls against a built-in mock calendar
npm run simulate -- --mock  # type as the caller, read what the receptionist would say
```

`npm run demo` plays these calls and prints the transcript, the tools used, the outcome, how the
language was chosen, the token usage, and the one-line summary posted to the website's Calls tab:

1. A new caller books a men's haircut for tomorrow afternoon.
2. A first-time Mandarin speaker asks about prices (detected and switched automatically).
3. An existing client reschedules an appointment.
4. A first-time Korean speaker asks about a men's cut and Saturday hours (detected automatically).
5. A returning caller whose saved language is Cantonese: English greeting, then Cantonese.
6. A first-time Cantonese caller who just starts speaking: detected, switched, and remembered.

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
| `transfer_to_human` | Only while open, if `SALON_FORWARD_NUMBER` is set and the loop guard allows it; `end` with handoff data, then `<Dial>` |
| `end_call` | Hangs up after the goodbye has played |
| `set_language` | Switches voice and transcription and saves the caller's language (see below) |
| `record_sms_consent` | Saves the answer to the one promotional text question (see [Promotional text opt-in](#promotional-text-opt-in)) |

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

**Switching during a call.** Three routes, all of which end the same way: ConversationRelay gets a
`language` message (both `ttsLanguage` and `transcriptionLanguage`), and the preference is saved with
`PUT /api/callers/{phone}` (never for withheld numbers). The next call from that number starts with
the English greeting and goes straight into the saved language.

1. **Automatic (the phone system, `src/agent/langdetect.ts`).** Every final transcript is checked
   before Claude sees it:
   - Korean script (two or more Hangul syllables) switches to Korean.
   - Chinese characters (two or more) switch to Chinese. Cantonese or Mandarin is decided from the
     words: spoken-Cantonese words and particles (嘅 咗 唔 冇 喺 哋 嗰 乜嘢 係 幾多 聽日 and so on) mean
     Cantonese; Mandarin function words (的 了 们 什么 吗 明天 多少) mean Mandarin; with no cues, a
     provider tag of `yue` or traditional characters lean Cantonese.
   - A caller naming a language in that language or romanized ("講廣東話", "普通话", "한국어",
     "gwong dung wa", "hangugeo") switches to it.
   - Claude is told with a short system note and replies in the new language; it does not need a
     tool call, so the switch adds no delay.
2. **Asked, not guessed.** When the evidence is weak (a romanized greeting such as "nei hou",
   "ni hao" or "annyeong" in an English transcript, Japanese-looking output, or a transcriber tag for
   a language we do not serve), the agent does not guess. It asks one short question, each line in
   its own voice: "Sorry, which language would you like? For English, press 1. 普通话请按2。廣東話請按3。
   한국어는 4번을 눌러 주세요." Claude can trigger the same question with the `ask_caller_language` tool
   when a transcript looks like nonsense English. At most twice per call.
3. **Fallbacks.** Keypad 1 English, 2 Mandarin, 3 Cantonese, 4 Korean at any time; or the caller asks
   ("Cantonese please"), and Claude calls `set_language`.

**No flapping.** Short or ambiguous utterances never switch ("OK", "yes", a name, a single
character). A caller in Korean, Mandarin or Cantonese is only moved back to English after two full
English sentences in a row, or an explicit request; one English word never does it, and that
includes Claude: `set_language` refuses a switch the last transcript does not support and tells
Claude to ask instead. Mandarin moves to Cantonese when Cantonese words appear, but Cantonese is never
auto-switched to Mandarin (Cantonese transcripts can look like written Mandarin); only an explicit
request or the keypad does that.

**Privacy.** Nothing is looked up or saved for withheld, anonymous, restricted or unknown caller IDs
(including Twilio's placeholder numbers such as `+266696687`). The language still switches for
that call; it is just not remembered.

**When the website API is down.** Preferences are also written to a small local file,
`voice-agent/data/callers.json` (gitignored). If the API cannot be reached (lookup timeout
`CALLER_LOOKUP_TIMEOUT_MS`, default 1.5 s), the agent uses the local record. A preference saved
while the API was down is marked `pendingSync` and pushed to the API the next time that number calls
and the API is reachable. The API stays the source of truth otherwise. The agent also increments
`callCount` and saves the caller's name after a booking or message.

### What the speech services can and cannot detect (checked 2026-10-04)

The goal was to have the transcriber itself detect the language for first-time callers. That is
not possible today for these four languages:

| Option in ConversationRelay | English | Mandarin | Cantonese | Korean | Notes |
|---|---|---|---|---|---|
| Deepgram `transcriptionLanguage="multi"` (nova-3 multilingual) | yes | no | no | no | The only automatic detection Twilio exposes; the prompt's `lang` then carries the detected tag. Covers en, es, fr, de, hi, ru, pt, ja, it, nl. |
| Deepgram Flux multilingual | yes | no | no | no | Same ten languages. |
| Google (Chirp 3 has an "auto" language mode) | | | | | Twilio does not expose Google's auto-detect or alternate languages. |
| Deepgram nova-3, one language at a time | `en-US` | `zh-CN` | `zh-HK` (added March 2026) | `ko` (added 2026) | Good per language, no detection. |
| Google, one language at a time | yes | `cmn-Hans-CN` | `yue-Hant-HK` | `ko-KR` | Good per language, no detection. |
| Mid-call `language` message | | | | | Changes transcription and voice; this is what every switch uses. |

Sources: Twilio changelog "ConversationRelay now supports a configuration for automatic language
detection" and the ConversationRelay TwiML reference (via search; twilio.com is blocked from the
build environment); Deepgram discussion #1097 (nova-3 multilingual languages; Korean not planned at
the time), Deepgram changelog March 2026 (Cantonese `zh-HK`, Mandarin `zh-CN`) and 2026 Korean
support; Deepgram Flux Multilingual launch (April 2026, ten languages); the LiveKit Deepgram plugin's
language list (includes `zh-HK`, `ko`, `multi`). Confidence: high that `multi` does not cover
Chinese or Korean; medium on the exact Deepgram language codes Twilio passes through, so test them.

So calls start in English (`CR_START_TRANSCRIPTION_LANGUAGE=en-US`) and the hybrid above does the
rest. `CR_START_TRANSCRIPTION_LANGUAGE=multi` is supported: the greeting stays English, transcription
starts in Deepgram's multi mode, and the prompt's `lang` tag feeds the detector. Turn it on if Deepgram
adds Chinese and Korean to multi; until then it only adds a "this is not English" signal and may cost
a little English accuracy.

### Reliability, honestly, per language

- **Returning callers (any language):** reliable. English greeting, one line in their language,
  then the call runs in it with the right transcriber.
- **Korean, first call:** the first sentence is heard by the English transcriber and usually comes
  back as garbled English or romanized syllables, not Hangul. If it contains "annyeong" or similar,
  the four-language question is asked; if it is nonsense, Claude asks it. One keypad press (4) or
  one more sentence after that. Expect one extra exchange, not a silent failure.
- **Mandarin, first call:** same as Korean ("ni hao" is the most common opener and triggers the
  question). Once the call is in Mandarin, Mandarin vs Cantonese cues work on real Chinese text.
- **Cantonese, first call:** same first-sentence problem. After the switch, Cantonese particles are
  distinctive and detection between Mandarin and Cantonese is good when the transcriber writes
  colloquial Cantonese; if it writes standard written Chinese, the call may stay in Mandarin until
  the caller says so or presses 3. This is the language to test hardest on real calls.
- **English:** unaffected. Short English words never trigger a switch.

### Twilio console settings for language

Nothing extra is needed in the console beyond the setup below: the TwiML returned by `/twiml` declares
all four `<Language>` entries (code, voice, transcription provider, speech model). Check:

1. Voice > Settings > General: the "Predictive and Generative AI/ML Features Addendum" is accepted.
2. ConversationRelay voices: the four Google Chirp3-HD voices in `src/languages.ts` play on your
   account (place one test call per language, pressing 2, 3 and 4).
3. Speech recognition: Deepgram is enabled for the account (it is the default provider for new
   ConversationRelay accounts); Korean uses Google `telephony` by default. Override per language with
   `CR_<LANG>_TRANSCRIPTION_PROVIDER` and `CR_<LANG>_SPEECH_MODEL` if a code is rejected.
4. Optional, experimental: `CR_START_TRANSCRIPTION_LANGUAGE=multi` (Deepgram, `nova-3-general`).

Settings: `LANG_AUTODETECT` (default true), `LANG_ASK_QUESTION` (default true),
`CR_START_TRANSCRIPTION_LANGUAGE` (`en-US` or `multi`), `CR_START_SPEECH_MODEL`.

## Why Twilio ConversationRelay and not ElevenLabs?

Checked 2026-10-04. Sources: Twilio blog "Integrate ElevenLabs Voices with Twilio's
ConversationRelay" and the twilio-samples/conversationrelay-elevenlabs-openai repo; ElevenLabs
models docs (Flash v2.5 language list), the ElevenLabs v4 launch (TechCrunch, 2026-09-28), ElevenLabs
Agents docs (language detection tool, SIP trunking, Twilio integration, custom LLM and the list of
Claude models), and ElevenLabs Agents pricing pages (via search; elevenlabs.io itself is blocked
from the build environment).

**ElevenLabs voices inside ConversationRelay (option, off by default).** ConversationRelay accepts
`ttsProvider="ElevenLabs"` with an ElevenLabs voice ID, optionally suffixed with a model
(`flash_v2_5` default, `turbo_v2_5`, `flash_v2`, `turbo_v2`) and speed, stability and similarity.
Flash and Turbo v2.5 speak English, Mandarin and Korean, **not Cantonese**. Cantonese is in
ElevenLabs' new v4 models (launched 2026-09-28), which Twilio does not list for ConversationRelay yet.
Latency: Flash v2.5 is ElevenLabs' lowest-latency model (about 75 ms), comparable to or better than
Google. Cost: Twilio's ConversationRelay rate is per minute with voices included as far as published;
whether ElevenLabs voices carry a premium was not confirmed, so check the Twilio console price list.
To try it: `CR_TTS_PROVIDER=ElevenLabs` and `CR_ELEVENLABS_VOICE=<voice id>` switch English,
Mandarin and Korean; Cantonese stays on Google unless `CR_ZH_HK_TTS_PROVIDER` is set (the server
warns at startup if a language is pointed at a model that does not list it).

**ElevenLabs Agents (their full platform).** It does speech-to-text, the turn-taking, the LLM call
and the voice in one product. Relevant points:

- Language detection: a built-in `language_detection` tool switches the agent's language when the
  caller speaks or asks for another one. That is the automatic detection Twilio lacks. Mandarin and
  Korean are in its language list; Cantonese is in their Scribe speech-to-text and in v4 voices, but
  whether Agents can run a Cantonese conversation end to end was not confirmed. Unsure.
- Telephony: native Twilio number import or SIP trunking, so it can sit behind forwarding from the
  salon's existing Canadian number.
- LLM: Claude models are selectable (including Sonnet 5.5 and Haiku 4.5), or a custom LLM endpoint.
- Tools: webhook tools can call our booking API with the agent key.
- Price: about $0.08 per minute on every plan (plan minutes included), plus LLM tokens and
  telephony billed separately. Roughly comparable to ConversationRelay's $0.07 plus voice minutes.

**Recommendation for this salon: stay on ConversationRelay for Friday, offer ElevenLabs voices as a
listening test, and revisit ElevenLabs Agents only if first-call detection matters more than control.**
Reasons: the whole agent (prompt, tools, booking rules, language memory, barge-in trimming, call
logs, Calls tab) is built and tested here, and Cantonese, the language most likely at Henderson
Place, is covered by Google voices today but not by ElevenLabs voices in ConversationRelay, nor
clearly by ElevenLabs Agents. ElevenLabs Agents would fix first-call detection for Mandarin and
Korean, at the cost of moving tool logic, caller memory and logging onto their platform and
re-testing everything. Worth a spike after the meeting if the owner hears many first-time Mandarin or
Korean callers.

## Promotional text opt-in

The salon texts occasional specials only to clients who agreed (Canada's anti-spam law, CASL; see
`docs/sms-compliance.md`). The phone assistant can collect that agreement politely, at most once:

- Only right after a successful `book_appointment`, only for the caller's own number (caller ID
  present, not withheld, and the booking is under that number), and only when the website says the
  number has no answer on file (`GET /api/callers/{phone}` returns `smsConsent.canAsk: true`: never
  opted in, never opted out, never declined).
- The booking result then carries `smsOptIn.question`, the exact sentence for the current language,
  and Claude asks it once, word for word:
  - English: "Would you like the occasional text about specials? You can reply STOP any time."
  - Mandarin: "您愿意偶尔收到我们优惠活动的短信吗？您随时可以回复STOP退订。"
  - Cantonese: "你想唔想間中收到我哋優惠嘅短訊？你隨時可以回覆STOP取消。"
  - Korean: "가끔 특별 할인 소식을 문자로 받아보시겠어요? 언제든지 STOP으로 회신하시면 수신이 중단됩니다."
- The answer goes to `record_sms_consent`, which posts to `POST /api/customers/consent` with
  `source: "phone"`, the language, the call SID, and the wording as proof, for example
  `[Phone assistant, CF Hair Salon, zh-HK] "你想唔想..." Caller said yes.` A yes is `status:
  "express"`; anything else is `status: "declined"`, which the website stores so the caller is never
  asked again on future calls.
- It is offered once per call even if the caller books twice, never for anonymous callers, and the
  tool refuses to run if the question was not offered. If the API is down, the caller is not asked
  (the lookup could not confirm there is no answer on file).
- The call log records the answer under `smsOptIn`. The text sentences live in
  `src/agent/sms-optin.ts`; changing them changes what is stored as proof, so keep them in step with
  the website's consent wording.

The mock API (`npm run mock-api`, `--mock`) implements the same endpoint and the `smsConsent` field.

## Calls tab

At the end of every call the agent posts one record to the website's admin Calls tab
(`POST /api/calls` with the agent key, upsert by `callSid`; contract in `docs/ARCHITECTURE.md`,
"Calls"). The record has: caller number (`null` when withheld), start and end time, duration, the
call's final language and how it was chosen (`languageSource`: `saved`, `detected`, `keypad`,
`asked`, or `default`), the outcome (`booked`, `rescheduled`, `cancelled`, `message`, `transferred`,
`info`, `abandoned`, `spam`), the `bookingId` or `messageId`, the SMS opt-in answer only if it was
asked, and the transcript with each line's language.

**Summary for the owner.** After the call ends, off the call's critical path, a small, cheap model
(`CALL_SUMMARY_MODEL`, default `claude-haiku-4-5`) writes 1 to 3 plain English sentences for the
owner, whatever language the call was in. If that fails (no key, timeout, refusal) the summary is
built from a template using the outcome, name, service and time. `CALL_SUMMARY=off` uses the template
only.

**Transfers.** When Twilio reports how a transfer went (`/twiml/dial-status`), the call is posted
again with `transferResult` (`answered`, `no-answer`, `busy`, `failed`). If nobody answered and the
caller came back to the agent, that second session is merged into the same record (same `callSid`).

**When the website is down.** The record is queued in `data/pending-calls.json` (gitignored) and
retried at the start and end of the next call and on server startup. A late record is fine; a lost
one is not. The local JSON log in `logs/` is always written as well.

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
6. **Set the transfer number**: `SALON_FORWARD_NUMBER=+1604...`, the owner's mobile or a second
   line, **never the salon's main number**. The main number forwards unanswered calls to this
   receptionist, so a transfer back to it would ring, go unanswered and loop. The agent refuses such
   transfers and takes a message instead (see [Transfer loop guard](#transfer-loop-guard)).
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
- `test/sms-consent.test.ts`: the promotional text question is offered once after a booking only
  when the caller has no answer on file, a yes is posted with the exact wording and source `phone`, a
  decline is stored so later calls never ask, no offer without caller ID or for another number,
  localised questions for all four languages, and the consent endpoint over HTTP with the agent key.
- `test/langdetect.test.ts`: first-time callers whose first sentence is Mandarin, Cantonese or
  Korean are switched (voice and transcription), Claude is told, and the preference is saved and used
  on the next call (English greeting first); Mandarin vs Cantonese from text cues; short English words
  never flip a Korean caller back, even when Claude tries; anonymous callers are switched but never
  saved; romanized greetings get the four-language question without a model call; Claude's
  `ask_caller_language`; `multi` start mode TwiML; ElevenLabs voice configuration.
- `test/calls.test.ts`: the Calls payload shape (booking, detected language, withheld number,
  message id, spam, SMS answer only when asked), the summary fallback template, the retry queue
  (next call and startup), transfer results and merging the resumed session, and `POST /api/calls`
  over HTTP.
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
- **First-time non-English callers** are heard by the English transcriber for their first sentence,
  so detection usually needs one extra exchange or a keypad press (see "Reliability, honestly").
  Test with real Mandarin, Cantonese and Korean speakers before go-live, especially Cantonese.
- **Hang-up timing** after a goodbye is estimated from text length, because ConversationRelay does
  not report when speech finishes. `END_CALL_GRACE_MS` adds margin.
- **Salon data is placeholder** (services, prices, stylist names, policies, parking, hours are
  marked "reported" or "placeholder" in `shared/salon.json`). Confirm with the owner.
- **Transfers** ring one number with a 20 second timeout and no whisper; if nobody answers, the caller
  comes back to the agent to leave a message.
- **Pending messages** queued while the API was down are not replayed automatically (pending Calls
  records are).

## Transfer loop guard

The salon keeps its existing number and forwards unanswered calls to the Twilio number. A transfer
that rang that same main line would go unanswered and forward straight back here. `src/transfer-guard.ts`
blocks a transfer, and the agent takes a message instead, when:

- `SALON_FORWARD_NUMBER` equals the salon's main number (`SALON_MAIN_NUMBER`, or the phone in
  `shared/salon.json` when unset), compared in E.164 so formatting does not matter;
- Twilio reports the call was forwarded from the transfer number (`ForwardedFrom`, passed to the
  session as a ConversationRelay parameter; not every carrier sends it);
- a transfer was already tried on this call and nobody answered.

At startup the server logs where transfers go, or warns that they are disabled and why.

