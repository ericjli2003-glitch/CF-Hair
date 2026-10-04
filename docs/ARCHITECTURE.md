# CF Hair: System Architecture

Three products share one source of truth: the booking backend inside the website.

```
                 +---------------------------+
  Caller ---->   |  Twilio phone number      |
                 |  (ConversationRelay:      |
                 |   speech-to-text, TTS)    |
                 +-------------+-------------+
                               | WebSocket (text)
                 +-------------v-------------+
                 |  voice-agent/ (Node, TS)  |
                 |  Claude + tool use        |
                 +-------------+-------------+
                               | HTTPS + x-api-key
  Web visitor -> +-------------v-------------+     +------------------------+
                 |  website/ (Next.js)       |<----| notes/ (Node, TS)      |
                 |  marketing site, booking  |     | personalised handwritten|
                 |  flow, admin, REST API    |     | cards via provider API  |
                 |  DB: Prisma (SQLite dev,  |     +------------------------+
                 |      Postgres prod)       |
                 +---------------------------+
```

Salon facts (name, hours, services, staff, prices) live in `shared/salon.json`.
The website seeds its database from that file; the voice agent and notes pipeline
read live data from the website API, falling back to `shared/salon.json`.

## Booking API contract (v1)

Base URL: `BOOKING_API_URL` (default `http://localhost:3000`). All times are ISO 8601
with offset, salon timezone `America/Vancouver`. JSON in and out.

Auth: public endpoints need nothing. Endpoints marked **(agent)** require header
`x-api-key: $AGENT_API_KEY`. Endpoints marked **(admin)** accept either the agent key
or an admin session.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/services` | `[{id, name, category, durationMin, priceCAD, description}]` |
| GET | `/api/staff` | `[{id, name, role, bio, serviceIds}]` |
| GET | `/api/availability?serviceId=&date=YYYY-MM-DD[&staffId=]` | `{date, slots:[{start, end, staffId, staffName}]}`. Omit `staffId` for "anyone". |
| POST | `/api/bookings` | body `{serviceId, staffId?, start, customer:{name, phone, email?}, notes?, source:"web"\|"phone"\|"walk-in"\|"admin"}` returns `201 {booking}`; `409 {error:"SLOT_TAKEN"}` if no longer free |
| GET | `/api/bookings/lookup?phone=` **(agent)** | upcoming bookings for a phone number |
| POST | `/api/bookings/{id}/cancel` **(agent)** | cancel; returns `{booking}` |
| POST | `/api/bookings/{id}/reschedule` **(agent)** | body `{start, staffId?}` |
| POST | `/api/messages` **(agent)** | body `{callerName, phone, message, urgency:"low"\|"normal"\|"high"}` for callback requests |
| GET | `/api/customers?since=&tag=` **(admin)** | `[{id, name, phone, email, mailingAddress?, firstVisit, lastVisit, visitCount, favouriteStaffId, birthday?, preferredLanguage, lastServiceId?, lastServiceName?, nextBookingAt?, referredBy?, tags[]}]`. `nextBookingAt` is the start of the earliest upcoming confirmed booking, or null. |
| GET | `/api/callers/{phone}` **(agent)** | `{phone, name?, preferredLanguage, lastCallAt?, callCount, smsConsent:{status, canAsk, declinedAt}}`; unknown numbers return `200` with `preferredLanguage:"en-US"`, `callCount:0`. `smsConsent.canAsk` is true only when the number has no promotional SMS answer on file (see below). |
| PUT | `/api/callers/{phone}` **(agent)** | body `{preferredLanguage?, name?, incrementCallCount?: boolean}`; upserts a caller profile keyed by E.164 phone (linked to the customer with that phone if one exists) |

### Promotional SMS (CASL)

Consent, campaigns and the SMS webhooks. Rules and sources: `docs/sms-compliance.md`; Twilio setup: `website/README.md`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/customers/consent` **(agent)** | Record consent. Body `{phone, status:"express"\|"withdrawn"\|"declined", source:"web"\|"admin"\|"phone"\|"keyword", wording, language?, detail?}`. `wording` is the exact text shown or spoken (required for `express`). `declined` keeps the status and stops the phone assistant from asking again. Appends a `ConsentEvent`. Returns `201 {consent}` |
| GET | `/api/customers/consent?phone=` **(agent)** | `{phone, status:"none"\|"express"\|"implied"\|"withdrawn", source, wording, consentedAt, impliedBasis, impliedExpiresAt, withdrawnAt, phoneAskDeclinedAt, canAskOnPhone}` |
| GET, POST | `/api/campaigns` **(admin)** | List with stats; create a draft `{name, bodies:{"en-US", "zh-CN"?, "zh-HK"?, "ko-KR"?}, audience:{type:"all"\|"recent"\|"lapsed"\|"stylist"\|"category"\|"birthday", days?, minDays?, maxDays?, staffId?, category?}, includeImplied}` |
| GET, PATCH, DELETE | `/api/campaigns/{id}` **(admin)** | Read; edit a draft or scheduled campaign; delete a draft |
| POST | `/api/campaigns/preview` **(admin)** | Same body as create. Final text per language (sender ID and STOP footer added), segments and encoding, audience counts by consent type and skip reason, estimated cost, current send window |
| POST | `/api/campaigns/{id}/schedule` **(admin)** | `{at?: ISO}`; omit `at` to send now. Quiet hours move it to 09:00. Returns `{campaign, adjustedForQuietHours, run}`. `409 PROMO_SENDER_MISSING` when Twilio is set up without a separate promotions sender |
| POST | `/api/campaigns/{id}/send`, `/api/campaigns/{id}/cancel` **(admin)** | Send now; cancel or stop mid-send |
| POST | `/api/campaigns/{id}/test` **(admin)** | `{phone?, language?}`: one text to the owner's phone (default from settings) |
| GET | `/api/campaigns/{id}/results` **(admin)** | `{campaign, stats:{sent, delivered, failed, skipped, skippedByReason, optOuts, bookings, bookedValueCAD, segments, costUSD}, recipients:[...]}`. Bookings and opt-outs count within 14 days of each text |
| POST | `/api/campaigns/draft` **(admin)** | `{brief}`: `{name, bodies}` in four languages, written by Claude. `404 DRAFTING_DISABLED` without `ANTHROPIC_API_KEY` |
| GET, POST | `/api/sms/queue` | Processes the send queue (one throttled batch, 09:00 to 20:00 only), due reminders and implied consent. GET for Vercel Cron (`Authorization: Bearer $CRON_SECRET`), POST for admin or agent key |
| POST | `/api/sms/inbound` (Twilio) | Inbound texts for both senders. Validates `X-Twilio-Signature`. STOP and equivalents withdraw (promo sender) or turn off appointment texts (transactional sender); START/UNSTOP re-subscribe; HELP replies with name and phone; anything else goes to the Messages inbox. Returns TwiML (JSON with `Accept: application/json`) |
| POST | `/api/sms/status` (Twilio) | Delivery status callback; updates each campaign text to sent, delivered or failed |
| GET, PUT | `/api/sms/settings` **(admin)** | `{capMax, capDays, ownerPhone}` plus the mode of each sender |
| POST | `/api/sms/simulate` **(admin)** | Outbox mode only: process a reply as the webhook would, `{phone, body, channel?}` |

Webhook authentication: with `TWILIO_AUTH_TOKEN` set, the two Twilio webhooks require a valid signature computed over `PUBLIC_BASE_URL` plus the path. Without Twilio credentials (offline outbox mode, demos and tests) they accept the agent key instead; that bypass does not exist once a token is configured.

### Languages

Supported codes: `en-US` (English), `zh-CN` (Mandarin), `zh-HK` (Cantonese), `ko-KR` (Korean).
`preferredLanguage` defaults to `en-US`. The phone agent always greets in English, then uses
the remembered language for that number (see `voice-agent/README.md`). The website and notes
pipeline may also use `preferredLanguage` (e.g. Chinese or Korean card text).

### Calls (phone receptionist log)

The phone agent posts one record per call when the call ends (and again if it learns more, e.g. a
transfer result); the website shows them in the admin Calls tab.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/calls` **(agent)** | Upsert by `callSid`. Body below. Returns `201 {call}` (or `200` on update). |
| GET | `/api/calls?from=YYYY-MM-DD&to=YYYY-MM-DD&outcome=&phone=` **(admin)** | Newest first, paginated (`cursor`, `limit` 50). |
| GET | `/api/calls/{id}` **(admin)** | One call with its transcript. |

`call` body: `{callSid, from: E.164 | null (withheld), startedAt, endedAt, durationSec, language: "en-US"|"zh-CN"|"zh-HK"|"ko-KR", languageSource: "saved"|"detected"|"keypad"|"asked"|"default", outcome: "booked"|"rescheduled"|"cancelled"|"message"|"transferred"|"info"|"abandoned"|"spam", summary: string (1 to 3 plain English sentences for the owner, whatever language the call was in), bookingId?: string, messageId?: string, transferResult?: "answered"|"no-answer"|"busy"|"failed", smsConsent?: "yes"|"no"|"not-asked", transcript: [{role: "caller"|"agent", text, lang?, at?}]}`.
The website links a call to the customer with the same phone. Transcripts are kept 90 days, then
the website clears `transcript` and keeps the summary (configurable `CALL_TRANSCRIPT_DAYS`).

Implementation notes (website):
- `POST /api/calls`: a new `callSid` needs `startedAt`, `outcome` and `summary`; a later post for the same `callSid` may send only the fields that changed (e.g. `{callSid, transferResult}`) and the rest are kept. `durationSec` defaults to `endedAt - startedAt`. `from` is normalised to E.164; `null`, `""` or `"anonymous"` mean withheld. Errors: `400 INVALID_BODY` with a `message` naming the field, `401 UNAUTHORIZED`.
- `GET /api/calls` returns `{calls: [call], nextCursor}` (pass `nextCursor` as `cursor` for older calls; `limit` up to 200). List items omit `transcript` and carry `hasTranscript`; `phone` accepts a full number or a few digits, or `withheld`.
- `GET /api/calls/{id}` returns `{call}` with `transcript` (`null` once cleared, with `transcriptClearedAt`). Each call also has `customer: {id, name} | null`.
- The clean-up runs from `/api/sms/queue` (its response has `transcripts: {cleared, days}`).

### Handwritten cards (approval queue)

The notes pipeline generates cards and uploads each batch; the owner reviews, edits, approves or
skips them in the admin Cards tab; the pipeline then fetches the approved cards to mail them and
reports back what was sent.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/cards/batches` **(agent)** | Body `{campaignId, campaignName, occasion, generatedAt, mock: boolean, cards: [card]}`. Returns `201 {batch: {id, cards: [{id, clientRef}]}}`. Idempotent on `(campaignId, clientRef)` for cards still `pending`. |
| GET | `/api/cards/batches` **(admin)** | Batches with counts by status. |
| GET | `/api/cards?batchId=&status=` **(admin, agent)** | Cards, filtered. |
| PATCH | `/api/cards/{id}` **(admin)** | `{status?: "pending"|"approved"|"skipped", message?, messageAlt?}`. Edits re-check `maxChars` and plain-punctuation rules; approving past the monthly cap returns `409 {error: "MONTHLY_CAP"}`. |
| POST | `/api/cards/{id}/sent` **(agent)** | `{provider: "handwrytten"|"plotter", providerOrderId?, sentAt, costCAD?}` sets `sent`; `{failed: true, error}` sets `failed`. |

`card`: `{clientRef (customer id or phone), customerId?, name, mailingAddress: {line1, line2?, city, province, postalCode, country}, stylistName, lastServiceName?, cardDesign, message, messageAlt?, altLanguage?: "zh-CN"|"zh-HK"|"ko-KR", maxChars, mock: boolean}`.
Statuses: `pending` → `approved` | `skipped` → `sent` | `failed`. The monthly cap (cards approved
or sent per calendar month) and the per-card price shown to the owner are admin settings.

Implementation notes (website):
- `POST /api/cards/batches`: re-posting the same run (`campaignId` + `generatedAt`) reuses its batch; a client with a `pending` card in that campaign keeps the same card id (its text is refreshed unless the owner already edited it). Cards that are approved, skipped, sent or failed are never changed by an upload. `clientRef` must be unique within a batch (`400 DUPLICATE_CLIENT_REF`). `customerId` is resolved from `customerId`, then `clientRef` as a customer id, then `clientRef` as a phone.
- `GET /api/cards` returns `{cards: [card]}`, oldest first. Each card has the upload fields plus `id, batchId, status, editedAt, approvedAt, skippedAt, provider, providerOrderId, sentAt, costCAD, failedAt, error`; `mailingAddress` is an object. The pipeline mails `GET /api/cards?status=approved`.
- `GET /api/cards/batches` returns `{batches: [{id, campaignId, campaignName, occasion, generatedAt, mock, createdAt, counts: {pending, approved, skipped, sent, failed, total}}], month: {label, used, cap, left, pricePerCardCAD, estimatedCAD}}`.
- `PATCH /api/cards/{id}` returns `{card}`. Text is normalised first (curly quotes to straight, the ellipsis character to three dots), then checked: length in graphemes up to `maxChars` (the second-language line too), no emoji, no em or en dash, and the English message only uses characters a pen font can write (ASCII and Latin-1 letters). Failures: `400 {error: "INVALID_TEXT", issues: [{field, code: "empty"|"too_long"|"dash"|"emoji"|"unsupported_char", message}]}`. `409 MONTHLY_CAP` carries `{cap, used, left}`. `409 CARD_SENT` once mailed. A failed card can be approved again (retry) or skipped.
- The cap counts cards with status `approved` or `sent` whose `approvedAt` is in the current calendar month (America/Vancouver).
- `POST /api/cards/{id}/sent` returns `{card}`. Only `approved` (or `failed`, for a retry) cards can be reported: `409 NOT_APPROVED` otherwise. Repeating the same sent report is a no-op; a different one, or `failed` after `sent`, is `409 ALREADY_SENT`.
- Extra admin endpoints used by the Cards tab: `POST /api/cards/batches/{id}/approve-all` (`{limit?}`; `409 MONTHLY_CAP` with `{ready, left}` when they do not all fit) and `GET, PUT /api/cards/settings` (`{monthlyCap, pricePerCardCAD}`).

`booking` shape:
`{id, serviceId, serviceName, staffId, staffName, start, end, status:"confirmed"|"cancelled"|"completed"|"no-show", customer:{name, phone, email}, source, notes, createdAt}`

Phone numbers are stored in E.164 (`+16045551234`).

## Environment variables

| Var | Used by |
|---|---|
| `DATABASE_URL` | website |
| `AGENT_API_KEY` | website, voice-agent, notes |
| `ADMIN_PASSWORD` | website (simple owner login) |
| `ANTHROPIC_API_KEY` | voice-agent, notes, website ("Draft with Claude", optional) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | voice-agent, website (SMS, optional; without them the website records texts in an offline outbox) |
| `TWILIO_TXN_MESSAGING_SERVICE_SID` or `TWILIO_TXN_FROM` | website: booking confirmations and reminders (falls back to `TWILIO_MESSAGING_SERVICE_SID` / `TWILIO_FROM_NUMBER`) |
| `TWILIO_PROMO_MESSAGING_SERVICE_SID` or `TWILIO_PROMO_FROM` | website: promotional campaigns, a different sender from appointment texts |
| `CALL_TRANSCRIPT_DAYS` | website: days to keep call transcripts (default 90) |
| `CARDS_MONTHLY_CAP`, `CARDS_PRICE_CAD` | website: defaults for the card cap (40) and price per card (8.50) until the owner saves them in the Cards tab |
| `PUBLIC_BASE_URL`, `CRON_SECRET` | website: Twilio callbacks and signature checks; Vercel Cron auth for `/api/sms/queue` |
| `ANTHROPIC_PROMO_MODEL` | website: model for "Draft with Claude" (default `claude-sonnet-5-5`), with `ANTHROPIC_API_KEY` |
| `SALON_FORWARD_NUMBER` | voice-agent (live transfer target) |
| `HANDWRYTTEN_API_KEY` or other provider key | notes |
