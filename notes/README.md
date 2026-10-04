# CF Hair handwritten notes

Real pen-on-paper cards for CF Hair Salon clients, at scale: a thank-you after a first visit, a birthday card, a gentle "thinking of you" for lapsed clients, Lunar New Year and holiday greetings, and referral thank-yous. Claude writes every card individually from what the salon knows about the client; the owner reviews and approves every card in the website admin (Cards tab), or offline on a proof sheet; nothing is mailed without that approval.

```
clients (booking API or CSV)
   -> plan       who qualifies, who is excluded and why, what it costs
   -> generate   Claude writes each note (Batches API for big runs), validated and retried
   -> push       upload the batch to the website admin (Cards tab): owner edits, approves or skips
      (or proof  offline HTML proof sheet with the same approve / skip / edit, exported as a file)
   -> send       only approved cards (--from-admin, or --approved <file>); dry run unless --send; never twice
                 results reported back to the admin as sent (with cost) or failed
                 handwrytten (robot pens, mailed for you)  or  plotter (AxiDraw SVGs, you mail them)
```

![Proof sheet card](../docs/screenshots/notes/first-visit-thanks-2026-10-09-card.png)

## Run the demo

```bash
cd notes
npm install
npm run demo        # whole flow on sample/clients.csv; pretends today is Friday 2026-10-09
npm test            # vitest: audience rules, limits, retries, idempotency, Claude request shapes, admin queue
```

Without `ANTHROPIC_API_KEY` the demo uses deterministic template copy, labelled "Mock copy" on the proof sheet, in the CSV (`writer=mock`) and in the run manifest, and the CLI refuses to mail mock copy through a real provider. With the key set, Claude writes every note. Open the proof sheets it prints (for example `out/win-back-2026-10-09/proof.html`) in a browser.

If `BOOKING_API_URL` and `AGENT_API_KEY` are set and the website answers there, the demo also pushes the win-back batch to the admin Cards tab and dry-runs `send --from-admin` for it; otherwise that step prints why it was skipped. The demo's batch is marked mock, so it can be reviewed but never mailed.

Behind a corporate HTTPS proxy, also set `NODE_USE_ENV_PROXY=1` so the proof can fetch its Chinese font subsets (it still works offline; it just links to Google Fonts instead of embedding).

## Commands

```bash
npm run notes -- campaigns
npm run notes -- plan     --campaign win-back --csv sample/clients.csv --staff sample/staff.sample.json --today 2026-10-09
npm run notes -- generate --campaign win-back --csv sample/clients.csv --staff sample/staff.sample.json --today 2026-10-09
# Approve in the website admin (needs BOOKING_API_URL + AGENT_API_KEY)
npm run notes -- generate --campaign win-back --push                    # or later: push --run win-back-2026-10-09
npm run notes -- send     --from-admin --batch <batchId>                # dry run of what the owner approved
npm run notes -- send     --from-admin --batch <batchId> --send         # mail it and report back to the admin

# Or approve offline on the proof sheet
npm run notes -- proof    --run win-back-2026-10-09
npm run notes -- send     --approved ~/Downloads/approved-win-back-2026-10-09.json            # dry run
npm run notes -- send     --approved ~/Downloads/approved-win-back-2026-10-09.json --send     # mail it
npm run notes -- send     --approved ... --send --test-mode      # Handwrytten test_mode: API round trip, nothing mailed
npm run notes -- send     --approved ... --send --provider plotter   # write AxiDraw SVGs instead
npm run notes -- catalog  # Handwrytten card and handwriting-font ids for your account
```

Data source: `--csv <file>` or, with no `--csv`, the live booking API (`BOOKING_API_URL` + `AGENT_API_KEY`, `GET /api/customers` and `GET /api/staff` per `docs/ARCHITECTURE.md`). `--today` defaults to today in America/Vancouver. See `.env.example` for every variable.

## How it works

**Audience** (`src/audience.ts`). Each campaign has a rule built from `firstVisitWithinDays`, `birthdayWithinDays`, `lastVisitBetweenDays`, `minVisits`, `maxVisits`, `hasTag`, `preferredLanguage`, `referredSomeoneWithinDays` and `everyone`, combined with `all` / `any` / `not`. A matching client is still skipped, with the reason shown in `plan`, if they have no complete Canadian address or a valid-format postal code, are tagged `do-not-mail` (or `no-mail`, `opt-out`, `moved`), already have an upcoming booking (`nextBookingAt` today or later) in a "come back" campaign (`"excludeIfBooked": true`, set on win-back; `hasUpcomingBooking` is also available as a rule), already got this card for this occasion, or got any card in the last 30 days (`cooldownDays` in `settings.json`; birthday and referral cards ignore it). Referral thanks finds the referrer through each client's `referredBy`.

**Writing** (`src/writer/`). One shared system prompt per run (salon voice, style and privacy rules, the campaign's guidelines, the character limit) is sent with `cache_control`, so every note after the first reads it from the prompt cache; only a short JSON client context changes per note (first name, stylist, last service, a fuzzy "about three months ago", a stylist note, the offer). Output is constrained to `{message, message_zh}` JSON. Runs of 25 or more notes go through the Message Batches API at half price; smaller runs use regular calls (first call alone to warm the cache, then 4 at a time) with server-side refusal fallback. Model `claude-opus-5-5` at `medium` effort (`settings.json`).

Every draft is then sanitised (smart quotes straightened, any em or en dash turned into a comma) and validated: within the character limit (the stricter of the campaign's and the provider's), no emoji, only characters a pen font can write, greets the client by name, never mentions their street, postal code, phone, email or birth year, no salesy phrases, includes the offer code if there is one, signature within Handwrytten's 50-character limit. A failing draft is sent back with the specific problems ("312 characters; the limit is 280, cut at least 57") up to 3 attempts; anything still failing is marked "needs attention" and cannot be approved until edited.

**Second language** (`src/language.ts`). Every card is written in English (that is what the pen robot or plotter writes). When a campaign has `"secondLanguage": true`, clients get a second version from their `preferredLanguage`:

| `preferredLanguage` | Second version |
|---|---|
| `zh-CN` (Mandarin) | Simplified Chinese |
| `zh-HK` (Cantonese) | Traditional Chinese, standard written Chinese with Hong Kong word choices |
| `ko-KR` | Korean (Hangul, polite 해요체 with 님); limit is 1.4x the Chinese one because Hangul needs word spaces |
| `en-US` | none |

Why Traditional for Cantonese clients: Hong Kong readers learn and read Traditional characters, so a card in Simplified would read as mainland and slightly off. We use standard written Chinese rather than colloquial Cantonese characters (嘅, 咗, 啲): those are common in chats and ads, but a handwritten card from a business reads as more respectful in standard written Chinese, especially for the older Cantonese-speaking clients typical of Henderson Place. Validation checks the script too (for example a 们 or 这 in a Traditional card, or a Korean card without Hangul, is sent back for a rewrite). Robot and plotter fonts are Latin-only, so these lines are shown on the proof as "added by hand" (LXGW WenKai for Chinese, Nanum Pen Script for Korean) and listed in `hand-finish.txt` for the plotter.

**Proof** (`src/proof/`). A self-contained HTML page: the printed card front for the campaign's design, the inside in a ballpoint-style hand (Caveat with seeded per-letter tilt, baseline drift and ink-pressure variation on a paper texture), and the addressed envelope. Each card shows why the client was picked, a character meter and any problems, with Approve / Skip and Edit (live re-validation). "Export approved list" downloads `approved-<run>.json`: the only input `send` accepts. Fonts are embedded so the page works offline.

**Approval in the website admin** (`src/admin.ts`). `push` (or `generate --push`) uploads the run to `POST /api/cards/batches` with the agent key. Each note becomes a contract card: `clientRef` (client id), `customerId` (only for runs loaded from the booking API), `name`, `mailingAddress`, `stylistName` ("CF Hair team" when there is no favourite stylist), `lastServiceName`, `cardDesign` (the campaign design), `message`, `messageAlt` and `altLanguage` (zh-CN, zh-HK or ko-KR, only when there is a second version), `maxChars` and `mock`. Notes that failed a check stay local and are listed. The batch id, the card ids and their notes are saved in `out/<run>/admin-batch.json`, and the command prints the review link (`/admin/cards?batch=<id>`). The owner edits, approves or skips cards there (the website enforces the monthly cap and re-checks length and punctuation on edits).

`send --from-admin [--batch <id>]` fetches `GET /api/cards?status=approved` and sends those cards through the same checks, ledger and provider adapters as below, using the owner's edited text. Cards are matched to their local notes through `admin-batch.json`, so they share idempotency keys with the offline flow: a card mailed one way is never mailed again the other way. On another computer, without the local run, the campaign comes from the batch and the key from the card id. Each live result is reported with `POST /api/cards/{id}/sent`: `{provider, providerOrderId, sentAt, costCAD}` or `{failed: true, error}`. If a report-back is lost, the next run sees the card as sent in the ledger, does not resend it, and re-reports it. Dry runs and `--test-mode` never write to the admin.

**Sending** (`src/deliver.ts`, `src/providers/`). Both send paths share one loop. It re-validates every approved card (including any edits), refuses an approved list whose idempotency keys do not match the run, and is a dry run unless `--send` is given. Each card's idempotency key is `campaign:client:occasion` (for example `win-back:c012:lv-2026-07-20`, `birthday:c007:2026`), recorded in `data/history.json` (gitignored) as `submitting` before the provider call and `sent` after it. A key that is `sent` is never mailed again; one left in `submitting` by a crash blocks a resend until someone checks the provider dashboard; a `failed` call can be retried. A lock file stops two sends running at once.

- `handwrytten`: one basket per card (`POST orders/placeBasket` then `POST basket/send`), API key in the `Authorization` header, the idempotency key as `client_metadata` and an `Idempotency-Key` header. Before the first card it checks the basket is empty so a stale item cannot ride along. Built against Handwrytten's official TypeScript SDK (v1.7.0) request shapes.
- `plotter`: two millimetre-accurate single-stroke SVGs per card (A2 card inside 108 x 140 mm in EMS Felix, A2 envelope 146 x 111 mm in EMS Readability Italic) with seeded wobble so no two cards look machine-identical. Plot with `axicli <file>.svg` or Inkscape, add a Canada Post stamp, mail.

## Cost per card

| Provider | Per card (to a Coquitlam address) | Notes |
|---|---|---|
| Handwrytten pay-as-you-go | USD 3.75 card + 1.80 international stamp + 0.10 surcharge = USD 5.65, **about CAD 7.74** | Real pen, mailed from the US. Platinum subscription (20% off cards) about CAD 6.71 |
| AxiDraw in-house | CAD 0.85 card and envelope + 1.24 stamp + 0.05 ink = CAD 2.14, **about CAD 3.47** with 4 minutes of front-desk time | Canadian stamp, local postmark; plotter about CAD 900 to 1,200 one-time |
| Claude writing | about CAD 0.03 per note (CAD 0.015 in batches) | Opus 5.5 with the shared prompt cached |

Prices and the exchange rate live in `settings.json`; `plan` prints the total for each run. Sources and the provider comparison: `docs/research/handwritten-notes-providers.md`.

## Why it pays (ROI framing)

Assumptions to replace with the salon's real numbers: an average ticket of about CAD 60 (between a CAD 50 women's cut and colour services at CAD 85 to 230), and a regular who comes every 6 to 8 weeks, so about CAD 400 to 500 a year.

- **Win-back.** Seven lapsed clients cost about CAD 54 in cards. If one of them comes back for a single visit, the run is paid for. If that client stays for a year, it returns roughly 8 times its cost. Break-even is one returning client in about every 8 cards for a single visit, or one in about 60 if they become a regular again.
- **First-visit thank-you.** The cheapest moment to win a regular. A second visit is the hard one; a handwritten card from the stylist who did the cut is something chains do not do. It is also the most natural place to ask for a Google review, which a salon with almost no online reviews needs most.
- **Birthdays and Lunar New Year** keep the salon in mind between visits for clients who already like it; for many Henderson Place clients a Lunar New Year card in their own language will be remembered.

Track it simply: the offer codes (`WELCOME15`, `BDAYTREAT`) tell you which bookings came from which card.

## Add a campaign

Create `campaigns/<id>.json` (copy `win-back.json`):

```json
{
  "id": "post-colour-check-in",
  "name": "How is the colour?",
  "description": "Two weeks after a colour service.",
  "occasion": "check-in after a colour service",
  "audience": { "all": [ { "rule": "lastVisitBetweenDays", "min": 12, "max": 18 }, { "rule": "hasTag", "tag": "colour" } ] },
  "design": "cf-gratitude",
  "guidelines": "Ask how the colour is settling in and share one care tip. No offer.",
  "maxChars": 340,
  "maxCharsAlt": 120,
  "signature": { "template": "Warmly,\n{stylistFirstName}\nCF Hair Salon", "fallback": "Warmly,\nThe CF Hair team" },
  "offer": null,
  "dedupe": "lastVisit",
  "excludeIfBooked": false,
  "secondLanguage": true,
  "handwrytten": { "cardId": null, "font": null }
}
```

Set `excludeIfBooked` to true for any "come back" campaign so clients with an upcoming booking are skipped. `dedupe` decides what "the same card" means: `once` (ever), `year`, `lastVisit` (once per lapse), `firstVisit`, or `referral` (once per referred friend). Designs: `cf-thank-you`, `cf-birthday`, `cf-thinking-of-you`, `cf-gratitude`, `cf-referral`, `cf-lunar-new-year`, `cf-holiday` (`src/proof/designs.ts`); for Handwrytten, upload the matching front as a custom card and put its id in `handwrytten.cardId`. Run `npm run notes -- plan --campaign <id>` to check the audience before generating.

## Sample data

`sample/clients.csv`: 27 fictional clients across Coquitlam and Port Moody (valid-format postal codes, invented addresses and contact details) anchored to 2026-10-09, covering every campaign plus the edge cases: just outside the win-back window on both sides, a lapsed client who has already rebooked, a missing address, a do-not-mail tag, a Feb 29 birthday, Mandarin, Cantonese and Korean speakers, and two referrals. Columns mirror the API: `preferred_language` (en-US, zh-CN, zh-HK, ko-KR), `last_service_id`, `last_service_name`, `next_booking_at`, `referred_by`; every column except `id` and `first_name` may be missing. `sample/staff.sample.json` gives the placeholder stylists sample first names (Vivian, Jason, Anna); `shared/salon.json` still has "Stylist A/B/C", which are never printed on a card (the signature falls back to "The CF Hair team").

## Known gaps

- The live Claude path is covered by tests against a stubbed SDK client but has not been run against the real API from this environment (no API key here). Run `generate` once with a key and read the proof before the first real send.
- Handwrytten prices come from search extracts and third-party listings because the vendor site was not reachable from the build sandbox; confirm Canadian postage and the card id/font on the account (`catalog`, then `send --send --test-mode`).
- `/api/customers` now carries `preferredLanguage`, `lastServiceId`/`lastServiceName`, `nextBookingAt`, `referredBy` and a structured `mailingAddress`; all are mapped and optional. It has no stylist-notes field, so live cards are a little less specific than the sample ones (which use the CSV `notes` column).
- Chinese and Korean are never robot-written; they need a person or a printed insert.
- The website's Cards API was being built at the same time; `notes/` is written to the contract in `docs/ARCHITECTURE.md` and tested against an in-memory fake of it. Run `push` and `send --from-admin` once against the real admin before the first live send.
- "Henderson Place" is never translated: the writer prompt says so and validation rejects common Chinese and Korean renderings of the name.
- The Korean and Traditional Chinese copy has only been checked by validation rules, not by a native reader. Have a Cantonese- and a Korean-speaking team member read the first proofs.
