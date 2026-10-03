# CF Hair Salon: website, booking and owner admin

Next.js (App Router, TypeScript, Tailwind v4) with Prisma. SQLite for local development, Postgres in production. This app is the booking backend that the phone agent (`../voice-agent`) and the handwritten notes pipeline (`../notes`) talk to. The API contract lives in `../docs/ARCHITECTURE.md`.

- Public site: home, services and pricing, team, visit and contact, online booking with "Add to calendar" (.ics).
- Languages: English, 简体中文 and 한국어 (toggle in the header, remembered in a cookie).
- Owner admin at `/admin`: day and week schedule by stylist, bookings list with status changes, walk-in and phone bookings, callback messages, client list with visit counts, language and referral editing, CSV export.
- Promotional texts (Promotions tab): CASL consent records, campaign composer in four languages with live preview and cost, audience builder, quiet hours, frequency cap, STOP handling, results with booking attribution. Works offline in an outbox mode for demos. See [Promotional texts](#promotional-texts-sms-campaigns).
- REST API for the phone agent and notes pipeline, with `x-api-key` auth.

## Run it locally

```bash
cd website
cp .env.example .env        # then set ADMIN_PASSWORD and AGENT_API_KEY
npm install
npm run db:reset            # creates prisma/dev.db and seeds demo data
npm run dev                 # http://localhost:3000, owner login at /admin
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server (syncs `../shared/salon.json` first) |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm test` | Vitest: slot logic, double-booking races, caller profiles, customer fields, SMS keywords, quiet hours, frequency cap, consent and implied expiry, segments, both senders, campaigns |
| `npm run db:reset` | Recreates the local SQLite database and seeds it |
| `npm run db:push` | Applies the schema without deleting data |
| `npm run db:seed` | Re-seeds (wipes demo tables first; refuses on Postgres unless `SEED_ALLOW_REMOTE=1`) |
| `npm run screenshots` | Playwright screenshots into `../docs/screenshots/website` (server must be running) |
| `npm run screenshots:sms` | Screenshots of the promotional SMS screens (`3x-*.png`) |

## Salon data

`../shared/salon.json` is the single source of truth. `scripts/sync-salon.mjs` copies it to `src/data/salon.json` before dev and build so the app also builds on its own (for example on Vercel). Services and stylists are seeded into the database from it; hours, address, phone and policies are read from it directly. Values starting with `PLACEHOLDER: ` are shown without that prefix, and placeholder-only values (like the example email) are hidden. To use the owner's real details, edit `shared/salon.json` and run `npm run db:reset` (local) or `npm run db:seed` (fresh demo database).

Translations live in `src/lib/i18n/dictionary.ts`: one dictionary per language, plus Chinese and Korean names and descriptions for services, categories, roles and bios keyed by id. Anything missing falls back to the English value from `salon.json`.

### Photos

The design uses abstract art where real photos belong. Every slot is marked with a small "Photo slot" label. To use real photos, put them in `public/photos/` and set the paths in `src/data/photos.ts` (`hero`, `interior`, `detail`, and one per stylist id).

## Booking rules

- Slots are every 15 minutes from opening time, and a service must finish by closing time. Hours per weekday come from `salon.json`.
- Only stylists whose `serviceIds` include the service are offered. "No preference" assigns the least-busy free stylist.
- No slots in the past. Overlapping bookings for the same stylist are never offered.
- Double-booking is prevented in the database: each booking writes one `SlotLock` row per 15-minute block, and `(staffId, slotStart)` is the primary key. Two simultaneous requests for the same stylist and time cannot both commit; the loser gets `409 {"error":"SLOT_TAKEN"}` (or is moved to another free stylist when no stylist was requested). Cancelling frees the blocks.
- Phones are stored in E.164, defaulting to Canada (+1). Customers are upserted by phone on every booking.
- The owner (admin session) can book walk-ins starting now or outside regular hours; everyone else is held to the rules above.
- SMS confirmation is sent through Twilio from the appointment sender (`TWILIO_TXN_MESSAGING_SERVICE_SID` or `TWILIO_TXN_FROM`, falling back to `TWILIO_MESSAGING_SERVICE_SID` / `TWILIO_FROM_NUMBER`) when `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set; otherwise it is logged as a dry run. If the client replied STOP to the appointment number, the confirmation goes by email instead (when `RESEND_API_KEY` and `EMAIL_FROM` are set; otherwise logged). Reminders go out 18 to 30 hours before the appointment from the queue endpoint below. None of this depends on promotional consent.

## Promotional texts (SMS campaigns)

The owner can text specials to clients who agreed to receive them. Canada's Anti-Spam Legislation (CASL) is built in; the rules and sources are in [`../docs/sms-compliance.md`](../docs/sms-compliance.md).

**Consent.** Each phone number has a status: `none`, `express`, `implied` or `withdrawn`, with the source (online booking checkbox, owner at the front desk, phone assistant, text keyword, paid visit), the timestamp, the exact wording shown or spoken, and for implied consent the paid visit it is based on and its expiry (visit plus two years). Every change is also written to an append-only `ConsentEvent` log, shown as "Consent history" on each client's page.

- Booking form: an optional checkbox, unchecked by default, in English, Chinese and Korean, naming the salon, what they will get and "Reply STOP any time", with the salon's address and phone under it. Booking confirmations are sent either way.
- Admin, Clients: a "Promo texts" column; click a client to see their consent, the wording they agreed to, the history, and to record a yes (front desk, phone call, paper form) or an opt-out.
- Phone assistant: after a booking, if the caller has caller ID and no answer on file, it asks once and records the answer (`POST /api/customers/consent`, source `phone`). A no is recorded so it never asks again.

**Campaigns.** Admin, Promotions, New campaign:

1. Message in English, plus optional Simplified Chinese (`zh-CN`), Traditional Chinese for Cantonese readers (`zh-HK`) and Korean (`ko-KR`) versions. Each client gets the version for their `preferredLanguage`, or English. "Draft with Claude" (shown only when `ANTHROPIC_API_KEY` is set; model `ANTHROPIC_PROMO_MODEL`, default `claude-sonnet-5-5`) writes all four from a one-line brief, keeping English to one segment where it can.
2. Audience: all clients, visited in the last N days, lapsed (last visit 60 to 120 days ago, nothing booked), by usual stylist, by service category, birthday this month. Express consent only by default; "Include implied consent (visited in the last 2 years)" adds clients with a paid visit in the last two years, with expiry worked out per client.
3. Live preview per language of the final text, which always starts with "CF Hair Salon:" and ends with a localised "Reply STOP to opt out" (both counted), with segments (GSM-7: 160, or 153 per part; Chinese and Korean are UCS-2: 70, or 67 per part), who gets it, who does not and why, and the estimated cost.
4. Send a test to the owner's phone, save a draft, send now, or schedule. No promotions go out before 9:00 am or from 8:00 pm Vancouver time: those times move to 9:00 am. Each client gets at most 4 promotions per 30 days (change it on the Promotions page).
5. Results: sent, delivered, failed, opt-outs, and bookings made by recipients within 14 days of the text (simple attribution), with the value booked and the cost of the texts. Each recipient row shows their status or why they were skipped.

**Replies.** `POST /api/sms/inbound`: STOP, UNSUBSCRIBE, CANCEL, END, QUIT, STOPALL, REVOKE, OPTOUT, ARRET, 退订, 退訂, 取消 and 수신거부 opt out at once and are logged; START and UNSTOP (and YES from an opted-out number) re-subscribe; HELP replies with the salon's name, address and phone; anything else lands in the Messages inbox. A CANCEL from a client with an appointment also adds a high-priority message, in case they meant the appointment.

**Outbox mode (demo).** With no Twilio account variables set, nothing is sent: every text is recorded exactly as it would go out, the campaign page shows it as "In outbox", and "Simulate a reply" next to each recipient runs a STOP, HELP or free text through the same webhook logic. The seed data includes a past campaign with results, a scheduled one and a draft.

### Twilio setup for Canada

1. **Two senders.** Buy two numbers (or create two Messaging Services): one for appointment texts, one for promotions. With Advanced Opt-Out, a STOP blocks that recipient for the sender they replied to, so a client who opts out of promotions must still get confirmations and reminders from the other number. Campaigns refuse to send without a separate promotions sender. Extra cost: one number, $1.15 USD a month for a Canadian local number or $2.15 for toll-free (Twilio list prices), so about 3 to 4 dollars a month.
2. **Which numbers.** Either a Canadian local long code in the salon's area code (Phone Numbers, Buy a number, Country Canada, SMS capable, area code 604 or 778), or a toll-free number. Toll-free numbers cannot text US or Canadian mobiles until Twilio's toll-free verification is approved (Console, Messaging, Regulatory compliance, Toll-free verification); allow a few business days. US A2P 10DLC registration only matters for texting US recipients and is not needed for Canadian clients on a Canadian long code.
3. **Messaging Services.** Messaging, Services, create "CF Hair appointments" and "CF Hair promotions", add one number to each, and copy the `MG...` SIDs into `TWILIO_TXN_MESSAGING_SERVICE_SID` and `TWILIO_PROMO_MESSAGING_SERVICE_SID` (or set `TWILIO_TXN_FROM` / `TWILIO_PROMO_FROM` to the numbers).
4. **Webhooks.** In each service, Integration, "Send a webhook": `https://<your-site>/api/sms/inbound` (POST). The app tells the two senders apart by Twilio's `To` and `MessagingServiceSid`; you can also add `?sender=promo` or `?sender=transactional` to each URL. Status callbacks for campaign texts go to `https://<your-site>/api/sms/status` automatically when `PUBLIC_BASE_URL` is set. `PUBLIC_BASE_URL` must be exactly the public origin Twilio calls, because the `X-Twilio-Signature` check uses it.
5. **Advanced Opt-Out.** Leave it on (Messaging Service, Opt-Out Management). Twilio then answers STOP, START and HELP in English itself and blocks opted-out numbers at the carrier level; set the HELP reply to "CF Hair Salon, 2140-1163 Pinetree Way, Coquitlam BC. Call (604) 475-7705. Reply STOP to opt out." The app keeps its own records in sync (it receives the same replies, reads `OptOutType`, does not reply twice, and treats send error 21610 as an opt-out). The Chinese and Korean keywords are handled by the app only. Set `TWILIO_ADVANCED_OPT_OUT=false` if you turn Advanced Opt-Out off, so the app sends the replies itself.
6. **Credentials.** `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`, and optionally `SMS_OWNER_PHONE` for test sends.

**Cost per text (Canada).** Twilio lists $0.0083 USD per outbound SMS segment to Canada, plus a carrier fee of about $0.0067 to $0.0087 depending on the carrier (Bell, Rogers, Telus, Freedom, Videotron), so about $0.016 USD (2 cents CAD) per segment. A one-segment promo to 200 clients costs about $3.30 USD. The composer uses `SMS_COST_PER_SEGMENT_USD` (default 0.0163). Checked 2026-10-03 through search results quoting [Twilio's Canada SMS pricing page](https://www.twilio.com/en-us/sms/pricing/ca) (twilio.com itself could not be fetched from the build environment); confirm in the console.

### Sending queue and Vercel Cron

`/api/sms/queue` starts campaigns whose time has come, sends one throttled batch (`SMS_SEND_BATCH` texts, `SMS_SEND_INTERVAL_MS` apart, only between 9:00 am and 8:00 pm), sends due appointment reminders and refreshes implied consent. "Send now" in the admin runs it immediately. For scheduled campaigns and reminders, call it every few minutes. In `vercel.json` at the project root (`website/`):

```json
{ "crons": [{ "path": "/api/sms/queue", "schedule": "*/5 * * * *" }] }
```

Set `CRON_SECRET` in Vercel; Vercel sends it as `Authorization: Bearer $CRON_SECRET`, which the endpoint checks. Vercel's Hobby plan only allows daily cron jobs, so use a Pro plan, or an outside scheduler (for example a GitHub Actions schedule or cron-job.org) that calls `curl -X POST -H "x-api-key: $AGENT_API_KEY" https://<your-site>/api/sms/queue`.

### Try the flow with curl (outbox mode)

```bash
B=http://localhost:3000; K="x-api-key: $AGENT_API_KEY"; J='content-type: application/json'
ID=$(curl -s -X POST $B/api/campaigns -H "$K" -H "$J" \
  -d '{"name":"Perm week","bodies":{"en-US":"Perm week: 15% off digital perms Mon to Thu. Book online or call us."},"audience":{"type":"all"},"includeImplied":false}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).campaign.id')
curl -s -X POST $B/api/campaigns/$ID/send -H "$K"            # dry run: recorded in the outbox
curl -s $B/api/campaigns/$ID/results -H "$K"                  # who got what, and why others did not
# A client replies STOP (without Twilio credentials the webhook accepts the agent key instead of a signature)
curl -s -X POST $B/api/sms/inbound -H "$K" --data-urlencode "From=+17785550108" --data-urlencode "Body=STOP"
curl -s "$B/api/customers/consent?phone=%2B17785550108" -H "$K"   # status: withdrawn, excluded from the next campaign
```

## API

All endpoints in the contract are implemented. Times are ISO 8601 with the `America/Vancouver` offset. `(agent)` needs `x-api-key: $AGENT_API_KEY`; `(admin)` accepts the agent key or the owner's session cookie.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/services`, `/api/staff` | Public |
| GET | `/api/availability?serviceId=&date=&staffId=` | Public. Omit `staffId` (or pass `any`) for no preference |
| POST | `/api/bookings` | Public. `201 {booking}`, `409 SLOT_TAKEN`, `400` with codes such as `INVALID_PHONE`, `START_IN_PAST`, `OUTSIDE_HOURS`, `INVALID_START` |
| GET | `/api/bookings/lookup?phone=` | (agent) Returns `{phone, customer, bookings: [booking]}` with upcoming confirmed bookings |
| POST | `/api/bookings/{id}/cancel` | (agent) `{booking}`; `409 NOT_CANCELLABLE` for completed or no-show |
| POST | `/api/bookings/{id}/reschedule` | (agent) `{start, staffId?}`; keeps the same stylist when free |
| POST | `/api/messages` | (agent) Callback request; shows in the admin Messages inbox |
| GET | `/api/customers?since=&tag=&phone=&q=` | (admin) See fields below |
| GET, PUT | `/api/callers/{phone}` | (agent) Caller profile and remembered language; unknown numbers return a default |

Promotional SMS endpoints (consent, campaigns, webhooks, queue) are listed in `../docs/ARCHITECTURE.md`. Extra endpoints used by the site and admin: `GET /api/bookings?from=&to=` (admin), `GET /api/bookings/{id}` (admin), `POST /api/bookings/{id}/status` (admin, `{status}`), `GET /api/bookings/{id}/ics`, `GET /api/messages` and `PATCH /api/messages/{id}` (admin), `PATCH /api/customers/{id}` (admin: `preferredLanguage`, `referredBy`, `tags`, `birthday`, `notes`), `GET /api/customers/export` (admin CSV), `POST /api/contact` (public contact form), `POST /api/admin/login` and `/api/admin/logout`.

Customer fields: `id, name, phone, email, mailingAddress, firstVisit, lastVisit, visitCount, favouriteStaffId, birthday, preferredLanguage, lastServiceId, lastServiceName, nextBookingAt, referredBy, tags`, plus `upcomingCount` and `noShowCount`.

- `mailingAddress` is an object `{line1, line2?, city, province, postalCode, country}` or `null`.
- Visits count completed bookings. `lastServiceId` and `lastServiceName` come from the most recent completed (or already started, confirmed) booking. `nextBookingAt` is the start of the earliest upcoming confirmed booking, or `null`.
- `tags` are the stored tags plus derived ones: `new` (one visit), `regular` (4 or more), `lapsed` (no visit in 90 days and nothing booked), `upcoming`, `birthday-soon` (within 30 days).
- `since` filters on last visit (a date or a timestamp); `tag` filters on any tag.

Languages: `en-US`, `zh-CN` (Mandarin), `zh-HK` (Cantonese), `ko-KR` (Korean). The customer's `preferredLanguage` and the caller profile are kept in sync: a PUT to `/api/callers/{phone}` updates the matching customer, the owner's edit in the admin updates the caller profile, and a new customer inherits the language the phone agent already remembered.

### Quick check with curl

```bash
B=http://localhost:3000; K="x-api-key: $AGENT_API_KEY"
curl -s "$B/api/availability?serviceId=mens-cut&date=2026-10-05"
curl -s -X POST $B/api/bookings -H 'content-type: application/json' \
  -d '{"serviceId":"mens-cut","start":"2026-10-05T11:00:00-07:00","customer":{"name":"Test","phone":"604-555-0199"},"source":"phone"}'
curl -s -H "$K" "$B/api/bookings/lookup?phone=6045550199"
curl -s -X PUT -H "$K" -H 'content-type: application/json' "$B/api/callers/%2B16045550199" -d '{"preferredLanguage":"zh-HK","incrementCallCount":true}'
```

## Deploy (Vercel + Neon or Supabase Postgres)

1. Create a Postgres database on [Neon](https://neon.tech) or [Supabase](https://supabase.com) and copy its connection string (use the pooled URL on Neon, or the "Transaction pooler" URL on Supabase, with `sslmode=require`).
2. In Vercel, import the repository and set **Root Directory** to `website`. Keep "Include files outside the root directory" enabled so `shared/salon.json` is picked up (a committed copy in `src/data/salon.json` is used otherwise).
3. Environment variables: `DATABASE_URL` (Postgres URL), `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (a long random string), `AGENT_API_KEY`, and optionally the `TWILIO_*` variables (two senders, see [Twilio setup for Canada](#twilio-setup-for-canada)), `PUBLIC_BASE_URL`, `CRON_SECRET` and `ANTHROPIC_API_KEY`.
4. Deploy. The build runs `scripts/prepare-db.mjs`, which switches the Prisma provider to `postgresql` because the URL starts with `postgres`, then `prisma generate` and `next build`.
5. Create the tables once from your machine:
   ```bash
   DATABASE_URL="postgresql://..." npm run db:push
   # optional demo data on a fresh database:
   DATABASE_URL="postgresql://..." SEED_ALLOW_REMOTE=1 npm run db:seed
   ```
   After the first push, `scripts/prepare-db.mjs` will have set the provider to `postgresql` in your working copy; run `npm run db:prepare` with the SQLite URL to switch back for local work.
6. Point the phone agent and notes pipeline at the deployed URL with `BOOKING_API_URL` and the same `AGENT_API_KEY`.

## Project layout

```
prisma/schema.prisma      data model (Service, Staff, Customer, CallerProfile, Booking, SlotLock, Message,
                          SmsConsent, ConsentEvent, Campaign, CampaignMessage, Notification, AppSetting)
prisma/seed.ts            seed from salon.json plus demo clients, bookings, caller profiles, messages
prisma/seed-sms.ts        consent mix with history, a past campaign with results, a scheduled one, a draft
src/lib/availability.ts   pure slot computation (unit tested)
src/lib/bookings.ts       create, cancel, reschedule, status, lookup (transactions and slot locks)
src/lib/customers.ts      customer upsert, summaries, CSV
src/lib/callers.ts        caller profiles for the phone agent
src/lib/notify.ts         booking confirmations and reminders (appointment sender, email fallback)
src/lib/sms/              promotional SMS: rules (quiet hours, consent, cap), segments, compose (sender ID and
                          STOP footer), keywords, consent records, campaigns and queue, inbound webhook, Twilio, Claude drafts
src/lib/i18n/             dictionaries and helpers
src/app/(site)/           public pages
src/app/admin/            owner dashboard
src/app/api/              REST API
tests/                    vitest suites (a throwaway prisma/test.db is created per run)
scripts/                  salon.json sync, provider switch, DB reset, screenshots
```
