# CF Hair: Internal Cost Model (not for the client)

Prepared October 3, 2026 for the Friday, October 9, 2026 meeting. All figures CAD unless marked USD. Working script: the numbers below were produced by a small Python model (inputs in section 1, scenarios in section 4); rerun it if any input changes.

**Research caveat.** Direct page fetches (twilio.com, zenoti.com, salontoday.com, hji.co.uk and others) were blocked by the sandbox network proxy on October 3, 2026. Every external number below comes from search-engine result snippets of the cited page, not a full read of the page. Confidence is rated per input. Re-check the HIGH-impact inputs (ConversationRelay rate, Handwrytten per-card price, international postage) on the live pricing pages before signing.

---

## 1. Inputs

### 1.1 Exchange rate

| Input | Value | Source | Date | Confidence |
|---|---|---|---|---|
| USD to CAD | **1.40** | Pound Sterling Live USD/CAD history: 1.401 on Sep 18, 2026; 2026 range 1.348 to 1.425. https://www.poundsterlinglive.com/history/USD-CAD-2026 | 2026-09-18 | Medium. Sensitivity at 1.45 in section 6. |

### 1.2 Phone receptionist (Twilio + Claude)

| Input | Value (USD) | Source | Confidence |
|---|---|---|---|
| Twilio Canada local number | $1.15 / month | Twilio Voice pricing, Canada. https://www.twilio.com/en-us/voice/pricing/ca | Medium-high (official page, via snippet) |
| Twilio inbound, Canada local | $0.0085 / min | Same | Medium-high |
| Twilio outbound to Canada (used for live transfers) | $0.0140 / min | Same | Medium-high |
| Twilio call recording | $0.0025 / min | Same (snippet) | Medium |
| Twilio ConversationRelay (speech-to-text + text-to-speech + orchestration) | **$0.07 / min**, billed on top of the voice minute | Twilio Conversational AI pricing. https://twilio.com/en-us/products/conversational-ai/pricing ; also https://quiq.com/blog/twilio-voice-pricing/ | Medium. HIGH impact: largest line in the phone cost. Confirm whether premium voices (for example ElevenLabs) cost more. |
| Twilio SMS, Canada outbound (confirmations, reminders) | $0.0083 / segment + carrier fees (estimate $0.0037) = **$0.012** | Twilio SMS pricing, Canada. https://www.twilio.com/en-us/sms/pricing/ca | Medium. Carrier pass-through fee is my estimate. |
| Claude model for the voice agent | Claude Sonnet 5.5: $2.00 input / $10.00 output per million tokens; cache reads $0.20; cache writes estimated at 1.25x input = $2.50 | Anthropic model table, claude-api skill (cached 2026-09-25) | High for list prices |
| Claude cost per call (derived) | **~$0.075 / call, ~$0.035 / min in English; blended ~$0.0385 / min across four languages** | Derivation in 1.3 and 1.8 | Low-medium (estimate; measure in pilot) |

### 1.3 Claude per-call derivation (estimate)

Assumes a typical 2-minute call, about 12 model requests (caller turns plus tool calls such as availability lookup and booking).

| Per request | Tokens | Rate (USD/M) | Cost |
|---|---|---|---|
| Cached prefix (system prompt, menu, staff, tools) | 5,000 | 0.20 | $0.0010 |
| Uncached conversation history and tool results | 1,500 | 2.00 | $0.0030 |
| Output (spoken reply plus short reasoning at low effort) | 120 | 10.00 | $0.0012 |
| **Per request** | | | **$0.0052** |

12 requests x $0.0052 = $0.062, plus one cache write of 5,000 tokens at $2.50/M = $0.0125. **Total about $0.075 per call, about $0.037 per minute.** Modelled at **$0.035/min**. If the voice agent uses Claude Haiku 4.5 ($1/$5), this roughly halves; if it uses Opus 5.5 ($4/$20), roughly doubles. Check `voice-agent/` for the model actually configured and measure real `usage` in the pilot.

### 1.4 All-in AI phone minute

| Component | USD / min |
|---|---|
| Inbound voice | 0.0085 |
| ConversationRelay | 0.0700 |
| Recording | 0.0025 |
| Claude (estimate, blended across languages, see 1.8) | 0.0385 |
| **Total** | **0.1195 USD = $0.1673 CAD** |

(English-only, before the October 3 scope change: 0.1160 USD = $0.1624 CAD.)

Plus transfers: assumed 10% of AI-answered calls are transferred, with a 3-minute outbound leg at $0.014 USD/min.

### 1.5 Handwritten cards (Handwrytten)

| Input | Value (USD) | Source | Confidence |
|---|---|---|---|
| Card, pay as you go | $3.25 to $3.75 per card (handwriting, card, envelope) | Search snippets of Handwrytten pricing roundups: https://eseospace.com/blog/best-handwritten-note-services-small-businesses-2026/ ; https://simplynoted.com/blogs/news/handwritten-note-servicessimplynoted-vs-handwrytten-pricing-quality-features (Simply Noted is a competitor: weak) | Medium-low. HIGH impact. |
| International postage (US to Canada) | $1.80 per card flat, plus $0.10 international handling surcharge | Handwrytten help center, International Mailing. https://handwrytten.helpscoutdocs.com/article/23-international-mailing | Medium |
| Subscription plans (not used in model) | Silver $100/mo for 24 cards ($4.17/card); Gold $198/50; Platinum $378/100; Pro $449/mo + $1.99/card; Enterprise $649/mo + $1.49/card | https://pricingsaas.com/companies/handwrytten ; https://toolradar.com/tools/handwrytten/pricing | Medium-low. Plans only pay off above roughly 100 cards/month. |
| Claude to draft one card | ~2,000 input + 300 output tokens on Opus 5.5 ($4/$20) = ~$0.014 | Anthropic model table | High; negligible |
| **All-in cost per card** | **$5.15 to $5.65 USD = $7.21 to $7.91 CAD; modelled at $7.58 CAD** | Derived | Medium |
| Price to client | **$8.50 CAD per card** | Proposal | Margin $0.59 to $1.29 per card |

Notes: Handwrytten mails from the US with international postage, so transit to Coquitlam is slower (plan 2 to 3 weeks; Lunar New Year batch must be approved by about Jan 12, 2027). For comparison, a Canada Post domestic stamp is $1.24 to $1.44 (https://store.canadapost.ca/postage-stamps/c/5); a Canadian handwriting provider, if one exists with an API, could be cheaper and faster. Worth checking after the sale.

### 1.6 Fixed monthly platform costs (per client, first client carries all of it)

| Item | Monthly | Basis | Confidence |
|---|---|---|---|
| App hosting (for example Vercel Pro) + small managed Postgres + backups/monitoring on free tiers | $30 USD = **$42.00** | My estimate: about $20 USD hosting + about $10 USD database. Not researched; check current plans. | Low-medium |
| Domain (.ca or .com), about $20/year | **$1.70** | Estimate | Medium |
| Twilio number (Growth and Complete only) | **$1.61** | 1.2 | Medium-high |

As more clients join, hosting is shared (one hosting account, many projects), so per-client fixed cost falls to roughly $15.

### 1.7 Labour assumptions

| Item | Value |
|---|---|
| Internal hourly value of developer time | $75/hour (opportunity cost; adjust to your own rate) |
| Ongoing support time per month | Starter 0.5 h, Growth 1 h, Complete 1.5 h (after the first month; first month is heavier and is covered by the setup fee) |

### 1.8 Scope change (Oct 3): Korean added, and the line remembers each caller's language

Scope now: phone receptionist in English, Mandarin, Cantonese and Korean; website in English / 简体中文 / 한국어; each caller's language stored against their phone number (never for calls with no caller ID), owner-editable in the dashboard. Every call opens with the English greeting; a remembered non-English caller then hears one short line in their language.

| Question | Finding | Cost effect | Confidence |
|---|---|---|---|
| Does ConversationRelay charge more for Korean (or Chinese) speech? | No per-language pricing found. ConversationRelay is quoted as a flat $0.07/min, with Google, Amazon or ElevenLabs text-to-speech and Google or Deepgram speech-to-text selectable (https://www.twilio.com/docs/voice/twiml/connect/conversationrelay). Third-party sources mention ElevenLabs-based voices sometimes priced differently on other platforms (https://www.retellai.com/resources/inbound-vs-outbound-callers-pricing-comparison-2025), but nothing language-specific on Twilio. | **None modelled.** Re-check if we pick a premium voice for Korean or Cantonese. | Medium-low (snippets only; ko-KR support in ConversationRelay not confirmed) |
| Claude tokens in Chinese and Korean | Non-Latin scripts typically use more tokens for the same meaning. Assumed 40% of AI calls are non-English and those use about 25% more tokens. System prompt grows by a few hundred tokens (Korean menu names, greeting lines), all in the cached prefix. | Claude per minute $0.035 to **$0.0385 USD** (+$0.0035). About +$3.40 CAD/month at Medium. | Low (estimate; measure real `usage` per language in the pilot) |
| Remembered-language greeting | The extra second-language line adds about 4 seconds to calls from remembered non-English callers (assumed 35% of AI calls). | +0.023 min per call on average: about +$1.35 CAD/month at Medium. | Medium |
| Language lookup and storage | One database read per call by caller number, one write when the language changes. | Nil (inside existing hosting). | High |
| SMS confirmations in Chinese or Korean | Chinese and Korean texts use Unicode (UCS-2) encoding: 70 characters per segment instead of 160, so a confirmation that is 1 segment in English can be 2 to 3 segments in Chinese or Korean. Twilio bills per segment (https://www.twilio.com/en-us/sms/pricing/ca). | Assumed 35% of texts non-English at 2.5 segments, English at 1.2: average **1.655 segments** per text (was 1.0). SMS cost rises from $15.12 to **$25.02 CAD/month** at Medium. **This is the biggest cost change, and it hits Starter.** | Medium |
| Website translation (Korean) | One more language to translate and review at setup and whenever the menu changes. | About +3 to 4 setup hours (absorbed in setup fee, see section 5); +0.25 h/month support not modelled. | Medium |

**Mitigation:** keep Chinese and Korean SMS templates to one 70-character segment (date, time, service, short link). That brings the average back to about 1.2 segments and saves about $8 to $11 CAD/month at Medium. Do this in the website build.

Bottom line: the language scope adds about **$5 a month to the phone side and $10 to $16 a month to SMS** at Medium/High usage. List prices still work; Starter's margin is the one to watch (floor raised to $95).

---

## 2. Unit prices charged to the client

| Item | Price | Our cost | Unit margin |
|---|---|---|---|
| Extra phone minute (beyond 400 included) | $0.25 | $0.167 | $0.083 (33%) |
| Handwritten card, all in | $8.50 | $7.21 to $7.91 | $0.59 to $1.29 |

Included minutes (400 per month in Growth and Complete) cost us about **$67** at full use.

---

## 3. Usage scenarios (per month)

AI-answered calls depend heavily on the answering mode. Low and Medium assume backup plus after-hours mode (only missed and after-hours calls reach the AI). High assumes "every call" mode at a busy salon.

| Scenario | AI-answered calls | Avg minutes per call | AI minutes (incl. language greeting) | Bookings (all channels) | SMS sent (2 per booking, avg 1.655 segments) | Cards mailed |
|---|---|---|---|---|---|---|
| Low | 150 | 2.0 | 304 | 250 | 500 | 15 |
| Medium | 350 | 2.0 | 708 | 450 | 900 | 40 |
| High | 700 | 2.2 | 1,556 | 700 | 1,400 | 80 |

All volumes are estimates. Real call volume, miss rate and booking count are discovery questions for Friday.

### 3.1 Monthly running cost by component (CAD)

| Component | Low | Medium | High |
|---|---|---|---|
| Hosting + database + domain | 43.70 | 43.70 | 43.70 |
| SMS (Unicode segments for Chinese/Korean) | 13.90 | 25.02 | 38.93 |
| **Base (all packages)** | **57.60** | **68.72** | **82.63** |
| AI phone minutes ($0.1673/min) | 50.78 | 118.48 | 260.37 |
| Transfers (10% of calls, 3 min, outbound) | 0.88 | 2.06 | 4.12 |
| Twilio number | 1.61 | 1.61 | 1.61 |
| **Phone subtotal** | **53.27** | **122.14** | **266.10** |
| Cards ($7.58 each) | 113.70 | 303.20 | 606.40 |

---

## 4. Margin by package

List prices: Starter $99/mo, Growth $279/mo (400 min included, $0.25/min after), Complete $349/mo (400 min included, cards $8.50 each).

| Package | Scenario | Revenue | Running cost | Gross margin | Gross % | After support time |
|---|---|---|---|---|---|---|
| Starter | Low | 99.00 | 57.60 | 41.40 | 42% | 3.90 |
| Starter | Medium | 99.00 | 68.72 | 30.28 | 31% | -7.22 |
| Starter | High | 99.00 | 82.63 | 16.37 | 17% | -21.13 |
| Growth | Low | 279.00 | 110.87 | 168.13 | 60% | 93.13 |
| Growth | Medium | 356.00 | 190.87 | 165.13 | 46% | 90.13 |
| Growth | High | 568.00 | 348.73 | 219.27 | 39% | 144.27 |
| Complete | Low | 476.50 | 224.57 | 251.93 | 53% | 139.43 |
| Complete | Medium | 766.00 | 494.07 | 271.93 | 36% | 159.43 |
| Complete | High | 1,318.00 | 955.13 | 362.87 | 28% | 250.37 |

Revenue includes overage minutes and cards. Example, Growth Medium: $279 + (708 minus 400) x $0.25 = $356. Figures include the October 3 language scope (section 1.8) with unoptimised SMS templates; with one-segment Chinese/Korean templates, add back about $8 (Medium) to $13 (High) per month to every package.

**Reading the table:**
- **Starter is break-even to slightly negative** once time is counted, because the first client carries the whole hosting bill and multilingual texts cost more per message. It is the entry door, not the profit centre. Short one-segment SMS templates and shared hosting (3 or more clients) bring it back to roughly $35 to $60/month. Do not discount Starter's monthly fee below $95.
- **Growth is the sweet spot**: about $90 to $145 a month after time, with healthy margin in every scenario, because the included 400 minutes are cheap (about $65) and overage is priced above cost.
- **Complete** adds about $70 a month of fee margin plus a small per-card margin. Gross % falls at high card volume because cards are nearly pass-through, but absolute margin grows.

---

## 5. Setup fee economics

| Package | Setup fee | Estimated hours | Effective rate | One-time hard costs |
|---|---|---|---|---|
| Starter | $1,200 | 19 to 24 h (adapt demo to real menu and photos, Chinese and Korean translation review, deploy, Google Business Profile and Yelp claim, onboarding, training) | $50 to $63/h | Domain about $20 |
| Growth | $2,200 | Starter + 13 to 17 h (prompt tuning in 4 languages, remembered-language greeting tests, call forwarding with the carrier, test calls, 2 weeks of transcript review) | $57 to $69/h | Test calls about $15 |
| Complete | $2,700 | Growth + 6 to 8 h (card templates EN/ZH, approval flow, consent capture, first batch) | $59 to $70/h | 3 to 5 sample cards about $40 |

The demos being built in `website/`, `voice-agent/` and `notes/` already cover much of the build, which is why these setup fees can sit below typical agency rates. Hours are estimates.

Founding-client offer cost: 20 free cards = $152 of cost; first month's overage minutes free = $0 to $40 at Low/Medium usage.

---

## 6. Sensitivities

| Change | Effect |
|---|---|
| FX moves to 1.45 | AI minute $0.173; card $7.83 (still under the $8.50 price). Growth Medium margin falls by about $4. |
| Card at $3.75 USD and FX 1.45 | Card $8.19: margin only $0.31. Reprice cards if FX passes 1.47 or the provider raises prices. The proposal does not promise a fixed card price forever; add a clause allowing changes on 30 days' notice. |
| Voice agent on Haiku 4.5 instead of Sonnet 5.5 | Claude cost about $0.019/min; AI minute about $0.14. Saves about $14/month at Medium. Only do it if quality in Cantonese, Mandarin and Korean holds. |
| Half of all calls are non-English (instead of 40%) and texts 50% non-English | AI minute about $0.169; SMS average about 1.85 segments. About +$4/month at Medium. |
| ConversationRelay premium voice surcharge | Unknown. If, say, +$0.03/min, AI minute becomes about $0.20 CAD and overage margin shrinks to $0.05. Check before signing. |
| Owner chooses "every call" mode at a busy salon (High) | Still profitable because overage is billed. Warn the owner that this mode uses more minutes. |
| Average call 3 minutes instead of 2 | Medium AI minutes 1,050: cost +$57, overage revenue +$87. Fine. |

---

## 7. Reference prices used in the proposal comparison

All third-party roundups (vendor-adjacent content sites); treat as approximate and re-check if the owner pushes back.

| Item | Value | Source | Confidence |
|---|---|---|---|
| BC general minimum wage | $18.25/h from June 1, 2026 (up from $17.85) | https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/wages/minimum-wage ; https://news.gov.bc.ca/releases/2026lbr0021-000581 | High (government) |
| Part-time receptionist, 25 h/week | 25 x 18.25 x 52 / 12 = $1,977/month wages; with 4% vacation pay and employer CPP (about 5.95%) and EI (about 2.3%), roughly +12% = **about $2,214/month** | Derived; payroll percentages are my estimates | Medium |
| Fresha | Team plan $14.95 USD per bookable member/month; 20% new-client marketplace fee (min $6 USD); processing about 2.19% + $0.20 (US) | https://pabau.com/blog/fresha-pricing/ ; https://costbench.com/software/salon-spa/fresha/hidden-costs | Medium-low (roundups) |
| Booksy | $29.99 USD/month + $20 per extra staff; Boost 30% of new client's first visit (min $10, max $100 USD) | https://koalendar.com/blog/booksy-pricing ; https://www.schedulingkit.com/pricing-guides/booksy-pricing | Medium-low |
| Square Appointments (Canada) | Free, Plus $35, Premium $85 per location per month | https://square.com/ca/en/appointments/pricing ; https://square.com/help/ca/en/article/6359-square-appointments-subscription-options | Medium (official, via snippet; CAD assumed) |
| Vagaro | $25 USD/month + $10 per extra calendar (to 7); website builder +$10, text marketing from $20 | https://koalendar.com/blog/vagaro-pricing | Medium-low |
| Goodcall | $79 / $129 / $249 USD per month for 100 / 250 / 500 unique callers | https://dupple.com/learn/best-ai-receptionists | Low-medium |
| Smith.ai AI Receptionist | From $95 USD/month; overage about $2.10 to $2.40 per call; appointment booking add-on $1.50 per call. Human receptionist plans from $292.50 USD for 30 calls | https://fast.io/resources/smith-ai-review-2026 | Low-medium |
| Rosie | From $49 USD/month for 250 minutes | https://dupple.com/learn/best-ai-receptionists | Low-medium |

---

## 8. Market and ROI evidence used (with quality flags)

| Claim | Value | Source | Quality |
|---|---|---|---|
| Salon calls unanswered | 37%, 82% of them during business hours | Zenoti (salon software vendor), data across thousands of locations, over a million calls a month. https://www.zenoti.com/blog/how-to-measure-your-salon-call-conversion-rate | Medium: vendor data but large sample. **Used in proposal.** |
| Salon calls unanswered (higher figure) | 62% during business hours, attributed to "Salon Today 2025" | Only seen second-hand on AI-receptionist vendor blogs (trtc.io, agentzap.ai). | Weak. **Not used.** |
| Consumers abandon after unanswered call | 78% abandoned a business, 82% would call a competitor, 42% leave voicemail | CallRail survey of 1,000 US consumers (2025), via roundups: https://beside.com/blog/missed-calls-cost-small-business | Medium (vendor survey, reported second-hand). **Used.** |
| "85% of callers who reach voicemail never call back" | 85% | Widely repeated on vendor blogs; original source unclear. | Weak. **Not used.** |
| After-hours online bookings | About 40% outside business hours (2025 platform data); UK report "nearly half" | https://simplybook.me/blog/online-booking-statistics (booking vendor); https://hji.co.uk/nearly-half-of-salon-appointments-booked-outside-of-salon-hours (UK trade press) | Medium-low. **Used, as "about 40%".** |
| Clients who would switch for 24/7 booking | 48% more likely to return to a salon with anytime booking; 71% have not booked because it was too hard to reach someone | Zenoti survey (vendor). https://www.zenoti.com/en-uk/thecheckin/salon-booking-survey-data | Low-medium. Not used in proposal; can be mentioned verbally. |
| First-visit retention | Top salons 70% second visit vs 45% average | Boulevard (salon software vendor) report, Oct 2023. https://www.joinblvd.com/newsroom/boulevard-report-reveals-top-performing-salons-retain-56-percent-more-first-time-visitora | Medium. **Used.** |
| Online-booked first visits return more | 78% vs 39% for walk-ins | Seen in a retention roundup, likely Boulevard data | Weak (unclear origin). Not used. |
| Visit frequency | 4.88 visits/year industry average | https://www.meevo.com/blog/?p=10123 (salon software vendor) | Medium-low. **Used as "about 5".** |
| Handwritten personal touch | Sticky-note request: 75%+ compliance vs 48% (handwritten on letter) vs 36% (none) | Garner (2005), Journal of Consumer Psychology; summarized at https://thedecisionlab.com/languages/fr-ca/intervention/how-a-personalized-post-it-note-increased-survey-responses-by-113 | Good (peer-reviewed), but not a salon setting. **Used.** |
| Handwritten "thank you" | Tips rose from about 17% to 20% | Rind and Bordia (1995), Journal of Applied Social Psychology. https://researchportalplus.anu.edu.au/en/publications/effect-of-servers-thank-you-and-personalization-on-restaurant-tip/ | Good (peer-reviewed), restaurant setting. **Used.** |
| Handwritten mail open/response rates | 99% open; up to 10% response vs 4.4% | Simply Noted (handwriting vendor). https://simplynoted.com/blogs/news/handwritten-direct-mail-roi-statistics-case-studies | Weak (vendor marketing). Not used. |
| Coquitlam Centre traffic | 12.1 million shoppers/year | Mall's own marketing figure, via directories. https://www.bestprosintown.com/bc/coquitlam/coquitlam-centre-/ | Medium-low (self-reported). **Used, attributed to the mall.** |
| Korean community | Korean is a home language for about 9% of Burquitlam to Lougheed residents; North Road Koreatown straddles Burnaby, Coquitlam and New Westminster near Lougheed Highway | https://coquitlam.ca/DocumentCenter/View/217/2019-Burquitlam-Lougheed-PDF (City of Coquitlam neighbourhood profile, via snippet); https://en.wikipedia.org/wiki/Korean_Canadians | Medium. **Used.** |
| Chinese-speaking population | 14,770 of 132,004 in Coquitlam to Port Coquitlam riding speak Mandarin or Cantonese most often at home (2021 Census) | https://electionsanddemocracy.ca/sites/default/files/2022-12/59008_2022FactSheet.pdf | Medium (census, but riding not city; Town Centre itself is likely higher). **Used as "about 1 in 9".** |

No salon-specific study of handwritten card win-back rates was found. The proposal says so implicitly by framing the card program as a measured test.

---

## 9. To verify before or soon after signing

1. ConversationRelay per-minute rate for the voices we will use, especially Cantonese (yue-HK), Mandarin (cmn-CN) and Korean (ko-KR); confirm all three are supported for transcription and speech in ConversationRelay and that switching language mid-call works (not confirmed in research).
2. Handwrytten current per-card price, Canada delivery time, and whether Chinese-character and Korean (Hangul) handwriting fonts are available. If not, Chinese-language cards may need a different provider or English-only handwriting with a printed Chinese greeting. **This matters for the Lunar New Year pitch.**
3. Which Claude model `voice-agent/` uses, and measured tokens per call.
4. Hosting plan costs.
5. The owner's phone carrier and whether conditional call forwarding (no answer / busy) is available on their line.
