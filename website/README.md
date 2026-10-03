# CF Hair Salon: website, booking and owner admin

Next.js (App Router, TypeScript, Tailwind v4) with Prisma. SQLite for local development, Postgres in production. This app is the booking backend that the phone agent (`../voice-agent`) and the handwritten notes pipeline (`../notes`) talk to. The API contract lives in `../docs/ARCHITECTURE.md`.

- Public site: home, services and pricing, team, visit and contact, online booking with "Add to calendar" (.ics).
- Languages: English, 简体中文 and 한국어 (toggle in the header, remembered in a cookie).
- Owner admin at `/admin`: day and week schedule by stylist, bookings list with status changes, walk-in and phone bookings, callback messages, client list with visit counts, language and referral editing, CSV export.
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
| `npm test` | Vitest: slot logic, double-booking races, caller profiles, customer fields |
| `npm run db:reset` | Recreates the local SQLite database and seeds it |
| `npm run db:push` | Applies the schema without deleting data |
| `npm run db:seed` | Re-seeds (wipes demo tables first; refuses on Postgres unless `SEED_ALLOW_REMOTE=1`) |
| `npm run screenshots` | Playwright screenshots into `../docs/screenshots/website` (server must be running) |

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
- SMS confirmation is sent through Twilio when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID`) are set; otherwise nothing is sent.

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

Extra endpoints used by the site and admin: `GET /api/bookings?from=&to=` (admin), `GET /api/bookings/{id}` (admin), `POST /api/bookings/{id}/status` (admin, `{status}`), `GET /api/bookings/{id}/ics`, `GET /api/messages` and `PATCH /api/messages/{id}` (admin), `PATCH /api/customers/{id}` (admin: `preferredLanguage`, `referredBy`, `tags`, `birthday`, `notes`), `GET /api/customers/export` (admin CSV), `POST /api/contact` (public contact form), `POST /api/admin/login` and `/api/admin/logout`.

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
3. Environment variables: `DATABASE_URL` (Postgres URL), `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (a long random string), `AGENT_API_KEY`, and optionally the `TWILIO_*` variables.
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
prisma/schema.prisma      data model (Service, Staff, Customer, CallerProfile, Booking, SlotLock, Message)
prisma/seed.ts            seed from salon.json plus demo clients, bookings, caller profiles, messages
src/lib/availability.ts   pure slot computation (unit tested)
src/lib/bookings.ts       create, cancel, reschedule, status, lookup (transactions and slot locks)
src/lib/customers.ts      customer upsert, summaries, CSV
src/lib/callers.ts        caller profiles for the phone agent
src/lib/i18n/             dictionaries and helpers
src/app/(site)/           public pages
src/app/admin/            owner dashboard
src/app/api/              REST API
tests/                    vitest suites (a throwaway prisma/test.db is created per run)
scripts/                  salon.json sync, provider switch, DB reset, screenshots
```
