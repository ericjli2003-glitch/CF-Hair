# CF Hair Salon: AI receptionist, booking website, handwritten notes

A proposal and working demos for CF Hair Salon (Henderson Place Mall, Coquitlam BC).

Live demo website: https://cf-hair-salon.vercel.app (owner admin at `/admin`). It deploys from this branch on every push, with a Neon Postgres database; texts run in dry-run outbox mode until Twilio is connected.

| Folder | What it is | Try it |
|---|---|---|
| `website/` | Multilingual (English / 简体中文 / 繁體中文 / 한국어) salon site with live online booking, owner admin, CASL-compliant promotional texts and the booking API | `cd website && cp .env.example .env && npm install && npm run db:reset && npm run dev`, then open http://localhost:3000 and http://localhost:3000/admin |
| `voice-agent/` | 24/7 phone receptionist (Twilio ConversationRelay + Claude) in English, Mandarin, Cantonese and Korean that remembers each caller's language | `cd voice-agent && cp .env.example .env` (add `ANTHROPIC_API_KEY`), `npm install && npm run demo`, or `npm run simulate -- --mock` |
| `notes/` | Personalised handwritten cards: audience rules, Claude-written notes, approval proof sheet, Handwrytten and AxiDraw senders | `cd notes && npm install && npm run demo`, then open the `out/*/proof.html` files |
| `proposal/` | Client proposal, meeting plan with demo script and discovery questions, cost model | Read `proposal/PROPOSAL.md` first |
| `shared/salon.json` | Salon facts used by everything. Values marked `PLACEHOLDER` need confirming with the owner | |
| `docs/` | Architecture and API contract, research, screenshots | `docs/ARCHITECTURE.md` |

All three apps share one booking backend (the website API), so a booking made online, by phone or at the desk lands in the same calendar and client list.
