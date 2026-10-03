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
| GET | `/api/customers?since=&tag=` **(admin)** | `[{id, name, phone, email, mailingAddress?, firstVisit, lastVisit, visitCount, favouriteStaffId, birthday?, preferredLanguage, tags[]}]` |
| GET | `/api/callers/{phone}` **(agent)** | `{phone, name?, preferredLanguage, lastCallAt?, callCount}`; unknown numbers return `200` with `preferredLanguage:"en-US"`, `callCount:0` |
| PUT | `/api/callers/{phone}` **(agent)** | body `{preferredLanguage?, name?, incrementCallCount?: boolean}`; upserts a caller profile keyed by E.164 phone (linked to the customer with that phone if one exists) |

### Languages

Supported codes: `en-US` (English), `zh-CN` (Mandarin), `zh-HK` (Cantonese), `ko-KR` (Korean).
`preferredLanguage` defaults to `en-US`. The phone agent always greets in English, then uses
the remembered language for that number (see `voice-agent/README.md`). The website and notes
pipeline may also use `preferredLanguage` (e.g. Chinese or Korean card text).

`booking` shape:
`{id, serviceId, serviceName, staffId, staffName, start, end, status:"confirmed"|"cancelled"|"completed"|"no-show", customer:{name, phone, email}, source, notes, createdAt}`

Phone numbers are stored in E.164 (`+16045551234`).

## Environment variables

| Var | Used by |
|---|---|
| `DATABASE_URL` | website |
| `AGENT_API_KEY` | website, voice-agent, notes |
| `ADMIN_PASSWORD` | website (simple owner login) |
| `ANTHROPIC_API_KEY` | voice-agent, notes |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | voice-agent, website (SMS confirmations, optional) |
| `SALON_FORWARD_NUMBER` | voice-agent (live transfer target) |
| `HANDWRYTTEN_API_KEY` or other provider key | notes |
