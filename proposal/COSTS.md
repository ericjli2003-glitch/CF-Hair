# CF Hair: Internal Cost Model (not for the client)

Prepared October 3, 2026 for the Friday, October 9, 2026 meeting. All figures CAD unless marked USD. Working script: the numbers below were produced by a small Python model (inputs in section 1, scenarios in section 4); rerun it if any input changes. The promotions update (section 1.9) was produced the same way.

**Research caveat.** Direct page fetches (twilio.com, zenoti.com, salontoday.com, hji.co.uk and others) were blocked by the sandbox network proxy on October 3, 2026. Every external number below comes from search-engine result snippets of the cited page, not a full read of the page. Confidence is rated per input. Re-check the HIGH-impact inputs (ConversationRelay rate, Handwrytten per-card price, international postage) on the live pricing pages before signing.

**Update, October 3 (later): promotional texting added.** Section 1.9 adds the SMS promotions model. The same proxy blocked twilio.com, crtc.gc.ca, ised-isde.canada.ca, mobile-text-alerts.com and textbee.dev, so the SMS and CASL figures are also from search snippets. That research **corrected the per-segment SMS cost upward** (Canadian carrier fees are about $0.008 USD per message, not the $0.0037 estimated before), which changes every package's base cost. Sections 1.2, 1.6, 2, 3, 4 and 6 are updated; the October 3 language note in 1.8 is kept as written for history.

**Update, October 5: optional add-ons and the returning-caller greeting.** Section 1.10 adds three optional add-ons (More lines, Smart pricing in two options, Pay online ahead of time) with costs, hours and margins. stripe.com and support.twilio.com were blocked by the proxy too, so those figures are also from search snippets. Section 1.8 gets a dated note: returning callers now hear the whole call in their saved language from the first word, so the extra second-language line (and its 4 seconds) is gone. Sections 3 and 4 were **not** rerun for either change; the effect of the greeting change is under $1 a month (see 1.8), and the add-ons are priced separately in 1.10.

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
| Twilio SMS, Canada outbound (confirmations, reminders, promotions) | $0.0083 / segment + carrier fee about $0.0082 (weighted) = **$0.0165 USD = $0.0231 CAD per segment** (was $0.012 USD) | See 1.9 for the breakdown. https://www.twilio.com/en-us/sms/pricing/ca | Medium (snippets). |
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
| Verified toll-free texting number for confirmations and reminders (all packages) | $2.15 USD = **$3.01** | 1.9: Canadian carriers filter app-to-person texts on ordinary local numbers; Twilio recommends verified toll-free or short code | Medium |
| Second verified toll-free number for promotions only (Growth, Complete, Starter add-on) | $2.15 USD = **$3.01** | 1.9: keeps a promotional STOP from blocking booking reminders | Medium |

As more clients join, hosting is shared (one hosting account, many projects), so per-client fixed cost falls to roughly $15.

### 1.7 Labour assumptions

| Item | Value |
|---|---|
| Internal hourly value of developer time | $75/hour (opportunity cost; adjust to your own rate) |
| Ongoing support time per month | Starter 0.5 h, Growth 1 h, Complete 1.5 h (after the first month; first month is heavier and is covered by the setup fee) |

### 1.8 Scope change (Oct 3): Korean added, and the line remembers each caller's language

Scope now: phone receptionist in English, Mandarin, Cantonese and Korean; website in English / 简体中文 / 한국어; each caller's language stored against their phone number (never for calls with no caller ID), owner-editable in the dashboard. Every call opens with the English greeting; a remembered non-English caller then hears one short line in their language. *(History, as written Oct 3. Superseded Oct 5, see the note below the table.)*

| Question | Finding | Cost effect | Confidence |
|---|---|---|---|
| Does ConversationRelay charge more for Korean (or Chinese) speech? | No per-language pricing found. ConversationRelay is quoted as a flat $0.07/min, with Google, Amazon or ElevenLabs text-to-speech and Google or Deepgram speech-to-text selectable (https://www.twilio.com/docs/voice/twiml/connect/conversationrelay). Third-party sources mention ElevenLabs-based voices sometimes priced differently on other platforms (https://www.retellai.com/resources/inbound-vs-outbound-callers-pricing-comparison-2025), but nothing language-specific on Twilio. | **None modelled.** Re-check if we pick a premium voice for Korean or Cantonese. | Medium-low (snippets only; ko-KR support in ConversationRelay not confirmed) |
| Claude tokens in Chinese and Korean | Non-Latin scripts typically use more tokens for the same meaning. Assumed 40% of AI calls are non-English and those use about 25% more tokens. System prompt grows by a few hundred tokens (Korean menu names, greeting lines), all in the cached prefix. | Claude per minute $0.035 to **$0.0385 USD** (+$0.0035). About +$3.40 CAD/month at Medium. | Low (estimate; measure real `usage` per language in the pilot) |
| Remembered-language greeting (history; this line was removed Oct 5, see note below) | The extra second-language line adds about 4 seconds to calls from remembered non-English callers (assumed 35% of AI calls). | +0.023 min per call on average: about +$1.35 CAD/month at Medium. | Medium |
| Language lookup and storage | One database read per call by caller number, one write when the language changes. | Nil (inside existing hosting). | High |
| SMS confirmations in Chinese or Korean | Chinese and Korean texts use Unicode (UCS-2) encoding: 70 characters per segment instead of 160, so a confirmation that is 1 segment in English can be 2 to 3 segments in Chinese or Korean. Twilio bills per segment (https://www.twilio.com/en-us/sms/pricing/ca). | Assumed 35% of texts non-English at 2.5 segments, English at 1.2: average **1.655 segments** per text (was 1.0). SMS cost rises from $15.12 to **$25.02 CAD/month** at Medium (at the old $0.012 USD rate; **$34.41** at the corrected rate in 1.9). **This is the biggest cost change, and it hits Starter.** | Medium |
| Website translation (Korean) | One more language to translate and review at setup and whenever the menu changes. | About +3 to 4 setup hours (absorbed in setup fee, see section 5); +0.25 h/month support not modelled. | Medium |

**Update, Oct 5: returning callers open in their saved language.** A caller whose number has a saved language now hears the whole call in that language from the first word (greeting, voice and speech recognition are set before the call is answered). New and withheld numbers still open in English, with the short language question and keypad options when the caller sounds unsure. All replies are kept very short. Cost effect:
- The extra second-language line is gone, so the "Remembered-language greeting" row above (+4 seconds on about 35% of AI calls) no longer applies. AI minutes fall by about 4 (Low), 8 (Medium) and 16 (High) a month: Low 304 to 300, Medium 708 to 700, High 1,556 to 1,540.
- Saving: about **$0.67 (Low), $1.37 (Medium), $2.68 (High) CAD a month** at $0.1673/min.
- Net effect on margin is under $1.50 either way: +$0.67 at Low (inside the 400 included minutes), but slightly negative at Medium (-$0.63) and High (-$1.32), because those scenarios bill overage at $0.25 and the 8 or 16 minutes saved were billable. Sections 3 and 4 still show the Oct 3 figures.
- Very short replies should also trim output tokens and call length a little (fewer and shorter text-to-speech turns). Not modelled; measure in the pilot.
- No new per-call cost: the saved-language lookup moves from "during the greeting" to "before answering", still one database read per call.

**Mitigation:** keep Chinese and Korean SMS templates to one 70-character segment (date, time, service, short link). That brings the average back to about 1.2 segments and saves about $8 to $11 CAD/month at Medium. Do this in the website build.

Bottom line: the language scope adds about **$5 a month to the phone side and $10 to $16 a month to SMS** at Medium/High usage. List prices still work; Starter's margin is the one to watch (floor raised to $95).

### 1.9 Promotional texting (scope addition, Oct 3)

Scope: Promotions screen in the dashboard (audience picker, AI-drafted message, preview in English / Simplified Chinese / Traditional Chinese / Korean per client, test to self, schedule or send, results: delivered, opt-outs, bookings by recipients within 14 days). CASL controls: opt-in checkbox off by default, front-desk consent, receptionist offers texts once after a phone booking, salon name and "Reply STOP to opt out" on every promo, instant STOP, 9 am to 8 pm send window, per-client cap (default 4 a month), express consent only unless the owner opts in to implied consent (paid visit in last 2 years).

**Inputs**

| Input | Value | Source | Confidence |
|---|---|---|---|
| Twilio outbound SMS, Canada, base price | $0.0079 to $0.0083 USD per segment (snippets disagree; one third-party page says $0.0075). **Modelled at $0.0083.** Same base for long code and toll-free. | https://www.twilio.com/en-us/sms/pricing/ca (snippet); https://automationatlas.io/answers/twilio-pricing-explained-2026/ | Medium |
| Canadian carrier fees, outbound, long code and toll-free | Bell and Virgin $0.0087; Rogers and Fido $0.0084; Telus $0.0073; Freedom and Videotron $0.0067; others $0.0064 (USD, per message). Weighted by an assumed carrier mix (Rogers 30%, Bell 28%, Telus 28%, others 14%): **about $0.0080; modelled at $0.0082** to cover Twilio's small failed-message fee. A different snippet (mobile-text-alerts.com) quotes slightly higher CAD figures (Bell $0.011, Telus up to $0.0133). | Twilio Canada SMS pricing (snippet); https://mobile-text-alerts.com/articles/sms-carrier-fees-breakdown | Medium. HIGH impact for Starter. |
| **All-in outbound segment** | **$0.0165 USD = $0.0231 CAD** | Derived | Medium |
| Inbound SMS (STOP and other replies) | $0.0083 + inbound carrier fee (Bell $0.0323, Rogers $0.017, Telus $0.0146) about $0.019 = $0.027 USD = **$0.038 CAD** per reply | Same | Medium-low |
| Toll-free number | $2.15 USD/month (local long code $1.15; short code $1,000/month, not viable) | Same | Medium-high |
| Toll-free verification | **Free**, about 3 to 5 business days. Unverified toll-free numbers have been blocked from texting since January 31, 2024. | https://www.twilio.com/docs/messaging/compliance/toll-free/console-onboarding ; https://support.twilio.com/hc/en-us/articles/360038172934 (snippets) | Medium |
| Why not a local 604/778 number | Twilio's Canada guidelines: "Canadian mobile carriers enforce strict filtering on A2P messages"; recommends short codes or verified toll-free. Some platforms also report that Canadian 10DLC numbers bought after March 26, 2025 need A2P brand registration or "persona verification" (US-style fees: brand $4.50 to $46 one time, campaign vetting $15, $1.50 to $10/month); this appears to be platform-specific and was not confirmed for Twilio. | https://www.twilio.com/en-us/guidelines/ca/sms ; https://help.gohighlevel.com/support/solutions/articles/155000004915 | Medium. **Decision: send all texts from verified toll-free numbers.** |
| Segment rules | GSM-7: 160 characters in one segment, 153 per segment when concatenated. UCS-2 (any Chinese, Korean, emoji, or even one curly apostrophe): 70, or 67 per segment when concatenated. Twilio falls back to UCS-2 if any character is outside GSM-7. | https://www.twilio.com/docs/glossary/what-sms-character-limit (snippet) | High |
| AI drafting and translation per campaign | About 3 drafts x (3,000 input + 1,500 output tokens) on Opus 5.5 ($4/$20 per M): about $0.21 USD = **$0.30 CAD per campaign** | Anthropic model table | High; negligible |

**Segments per promotional text**

| Language | Typical promo | Segments | Share of recipients (assumed) |
|---|---|---|---|
| English | 110 to 200 characters incl. "CF Hair Salon:", short link and "Reply STOP to opt out" | 1 or 2, **modelled 1.5** | 65% |
| Simplified Chinese, Traditional Chinese, Korean | 60 to 130 characters incl. salon name, link and STOP line (UCS-2) | 2 or 3 (sometimes 1), **modelled 2.5** | 35% |
| **Weighted average** | | **1.85 segments per text** | |

So a promo to a Chinese or Korean client costs about 1.7 times an English one ($0.058 vs $0.035 CAD). 500 segments is about **270 promo texts** at this mix. If the composer holds English to 1 segment and Chinese/Korean to 2, the average drops to 1.35 (500 segments = 370 texts).

**Usage scenarios (promotions only, per month)**

| Scenario | Campaigns | Promo texts sent | Segments | Outbound cost | Replies (3%) | AI drafting | Promo toll-free number | **Promo cost** | Overage revenue above 500 at $0.05 |
|---|---|---|---|---|---|---|---|---|---|
| Low | 1 x 150 | 150 | 278 | 6.41 | 0.17 | 0.30 | 3.01 | **9.89** | 0.00 |
| Medium | 2 x 300 | 600 | 1,110 | 25.64 | 0.69 | 0.60 | 3.01 | **29.94** | 30.50 |
| High | 4 x 500 | 2,000 | 3,700 | 85.47 | 2.29 | 1.20 | 3.01 | **91.97** | 160.00 |

The frequency cap (4 a month per client) bounds High; a salon with about 500 consented clients cannot exceed about 2,000 promo texts a month.

**Pricing decision**

| Item | Price | Our cost | Margin |
|---|---|---|---|
| Included in Growth and Complete | 500 segments/month | $11.55 at full use + $3.01 number + drafting | Absorbed (see section 4) |
| Overage, all packages | **$0.05 per segment** | $0.0231 | $0.027 (54%); still 52% at FX 1.45 and 48% if carrier fees rise 25% |
| Starter add-on | **$49/month incl. 500 segments, $150 one-time setup** | $9.89 to $29.94 at Low/Medium + 0.25 h support ($18.75) | Add-on alone: $20 to $31/month after time at Low/Medium, $98 at High |

Why $49 and not $39: at $39, Starter plus add-on is only $1 to $6 a month after time at Low/Medium, because Starter itself is now loss-making after time (section 4). Vagaro's English-only text marketing starts at about $20 USD ($28 CAD) per month; ours adds four languages, consent capture across three channels, and booking attribution, so $49 is defensible. Setup $150 covers about 2 h: second number and verification, consent wording in 4 languages, first campaign.

**Separate numbers for reminders and promotions.** Twilio and carriers process STOP at the number level: a client who replies STOP to a promo stops receiving **every** text from that number, including booking reminders. Using one toll-free number for confirmations/reminders and another for promotions keeps reminders working after a promo opt-out. Check how `website/` implements this; if it uses one number, either add the second or make sure the dashboard tells the owner that a STOP also ends reminders. Also honour common non-English opt-outs (退订, 退訂, 取消, 수신거부, ARRET) in the app, since Twilio's built-in keywords are English only.

**CASL requirements checked (CRTC, ISED; all via snippets)**

| Requirement | Detail | How the build meets it | Source |
|---|---|---|---|
| Consent | Express (opt-in, oral or written) or implied. Implied via existing business relationship: a purchase within the 2 years before the message, or an inquiry within 6 months. Express consent does not expire unless withdrawn. | Checkbox, front desk, receptionist offer; implied mode only if the owner turns it on, based on paid visits | https://crtc.gc.ca/eng/com500/guide.htm ; https://crtc.gc.ca/eng/archive/2019/2019-111.htm |
| No pre-checked boxes | Consent must be a positive act | Checkbox off by default | Bulletin CRTC 2012-548, https://www.crtc.gc.ca/eng/archive/2012/2012-548.htm |
| Consent request is a CEM | A text asking for consent is itself a commercial message, so the salon cannot mass-text non-consenting numbers to ask | Explained in proposal section 3 | CASL s. 1(3) (from memory; not re-read) |
| Proof | Sender must prove consent; keep records of how and when consent was given, and of unsubscribes | Store timestamp, channel, staff member or call ID, and wording shown. **Call recordings are deleted after 30 days, so the phone consent record must be a saved transcript excerpt, not the recording.** | https://www.torys.com/insights/publications/2016/07/crtc-releases-guidelines-on-casl-consent-records |
| Identification | Name the sender plus mailing address and one contact method; for texts, may be on a web page reached by a clear link in the message | Salon name in every promo; booking link landing page must show address and phone. **Confirm in `website/`.** | https://www.bennettjones.com/Insights/Updates/CRTC-Finalizes-Electronic-Commerce-Protection-Regulations ; https://crtc.gc.ca/eng/com500/faq500.htm |
| Unsubscribe | Mechanism in every CEM; honour within 10 business days; contact info valid 60 days after sending | "Reply STOP", honoured instantly | https://crtc.gc.ca/eng/com500/faq500.htm |
| Penalties | AMPs up to $1M per violation (individuals), $10M (organizations). Examples: Compu.Finder $200,000 (2017, 317 emails without consent or working unsubscribe); $40,000 to an individual for 31,000 phishing texts (2023). The CASL private right of action was never brought into force. | | https://www.blg.com/en/insights/2017/11/casl-enforcement-decision--interpretive-guidance-for-compliance-and-penalties ; https://www.blg.com/en/insights/2023/11/casl-enforcement-40000-penalty-for-sending-phishing-text-messages |
| Carrier rules (not law) | CWTA/carrier guidance: support STOP and ARRET (French) and HELP/AIDE; promotional texts only 9 am to 9 pm local; no SHAFT content | 9 am to 8 pm window; salon content is not SHAFT | https://www.infobip.com/docs/essentials/canada-messaging-content-requirements ; https://support.app.sinch.com/hc/en-us/articles/16600847085967 |

Who is the sender under CASL? The salon. We "cause or permit" the send, so the service agreement should say the owner is responsible for the content of promotions and for consent they record by hand, and we are responsible for the system enforcing STOP, quiet hours and caps. Add a line to the one-page agreement. Not legal advice; if the owner wants implied-consent mode, suggest a quick check with a lawyer.

### 1.10 Optional add-ons (scope addition, Oct 5)

Three add-ons on top of any package, priced in proposal section 6: **More lines** $39/month + $150 setup (Growth or Complete only); **Smart pricing** Option 1 "Quiet-hour savings" $59/month + $400 setup, Option 2 "Full smart pricing" $99/month + $600 setup; **Pay online ahead of time** $29/month + $400 setup. Labour at $75/h (1.7). stripe.com and support.twilio.com were blocked by the proxy on Oct 5; figures below are from search snippets.

**Inputs**

| Input | Value | Source | Confidence |
|---|---|---|---|
| Twilio port-in fee, Canadian local number | **$7.00 USD one time per number = $9.80 CAD** (porting US numbers is free; other countries carry a one-time fee) | Twilio support, "How much does it cost to port my number to Twilio" and "International Porting Charges": https://support.twilio.com/hc/en-us/articles/223131967-How-much-does-it-cost-to-port-my-number-to-Twilio ; https://support.twilio.com/hc/en-us/articles/115000781088 | **Low-medium** (search-engine summary of a blocked page). Small either way. |
| Port time | Up to 4 weeks once paperwork is complete; the owner must approve within 90 minutes of the losing carrier's confirmation text or the port is rejected | Twilio Canada porting guidelines: https://www.twilio.com/en-us/guidelines/ca/porting | Medium. The proposal says "usually 1 to 2 weeks, up to 4"; the 1 to 2 weeks is our expectation, not a Twilio figure. |
| Ported number, monthly | $1.15 USD = $1.61 CAD (same as a Twilio local number) | 1.2 | Medium-high |
| Pass-through minutes if ported (staff-answered calls bridged from Twilio to the salon phone) | Inbound $0.0085 + outbound $0.0140 USD = $0.0225 USD = **$0.0315 CAD per minute** | 1.2 | Medium-high |
| Concurrent AI calls | Each call is its own ConversationRelay session and its own Claude conversation; no per-concurrency fee found | Not specifically researched | Medium. Test 4 simultaneous calls at setup (Twilio account concurrency, Anthropic rate limits). |
| Stripe, Canada | **2.9% + C$0.30** per successful domestic card payment; same rate for Apple Pay and Google Pay; +0.8% international cards; +2% currency conversion; no setup or monthly fee; processing fee not returned on refunds; C$15 per dispute (returned if won). Charged by Stripe to the salon's own account. | https://stripe.com/en-ca/pricing (snippet); https://support.stripe.com/questions/understanding-fees-for-refunded-payments ; https://www.venn.ca/resources/how-to-save-on-your-stripe-payments-for-canadian-businesses ; https://help.invoicesimple.com/en/articles/12758900-what-are-the-stripe-processing-fees | Medium-high (several snippets agree). |
| Stripe cost to us | **$0.** Salon owns the Stripe account (Connect Standard, or the salon's own keys); we charge no application fee. | Assumption | Medium. Confirm Connect Standard carries no platform fee before building. |
| Smart pricing compute | Nightly aggregation query on our Postgres (bookings, cancellations, no-shows, calls, visits by day and hour) plus a price lookup per slot; Claude summary of the monthly report about 10,000 input + 2,000 output tokens on Opus 5.5 = about $0.08 USD | Estimate | High; negligible (call it $0.15 CAD/month) |
| Payment-link texts (phone deposits) | About 30 a month x 1.655 segments x $0.0231 = **about $1.15 CAD/month** | 1.9 rates | Medium (volume is a guess) |

**More lines: answer several callers at once**

Two ways to do it; pick per line at discovery:
1. **Carrier path:** the carrier adds call-forward-busy plus a hunt or overflow group so extra calls also forward to our Twilio number. No marginal cost to us; any carrier fee (extra line, hunt group) is on the salon's own phone bill. Depends on line type: some single business lines can't do it.
2. **Port path:** port (604) 475-7705 to Twilio. All calls hit Twilio first, which rings the salon phone (backup mode) and hands unanswered or extra calls to the receptionist, up to the cap (max 4), with overflow to a take-a-message flow. The salon's handset then needs its own line to ring (keep the carrier line on a new number, or a VoIP desk phone or app). **Every staff-answered call now passes through Twilio too.** At 12 calls a day with about 9 answered by staff, 2.5 minutes each: about 675 minutes a month x $0.0315 = **$21.26**, plus $1.61 for the ported number = **about $23 CAD a month**. Not in section 3.

| Item | Carrier path | Port path |
|---|---|---|
| Setup hours | 2 to 3 h (line check, call with carrier, cap and overflow flow, test with 4 phones at once) | 2.5 to 3 h (same, plus Letter of Authorization, bill copy, port approval window) |
| Setup effective rate at $150 | $50 to $75/h | $50 to $60/h |
| One-time hard cost | $0 | $9.80 (port fee) |
| Monthly marginal cost | $0 (extra AI minutes come from the 400-minute pool; overage billed at $0.25) | about $23 at 12 calls a day (scales with staff-answered minutes) |
| Support time | 0.25 h = $18.75 | 0.25 h = $18.75 |
| **Margin after time at $39** | **$20.25** | **about -$2.60** |

**Read:** $39 works on the carrier path. On the port path it is break-even or slightly loss-making at 12 calls a day, and worse at busier salons. Prefer the carrier path whenever the carrier supports it. If a port is needed: either ring the salon over SIP (Twilio SIP pricing not researched; likely well under the $0.014 PSTN outbound leg) or quote **$49** for the ported version. Low-medium confidence on staff-answered minutes: ask call volume at discovery.

**Smart pricing**

| Item | Option 1: Quiet-hour savings | Option 2: Full smart pricing |
|---|---|---|
| Free data phase (4 to 6 weeks after launch): report plus proposed rules table | 2 to 3 h ($150 to $225). Sales cost: recovered by the setup fee if they buy, lost if not. | Same |
| Per-client setup after the data phase | Review meeting 1 h, rules and caps 1 h, test website prices and phone quotes 1 to 1.5 h, client wording in 4 languages 0.5 h: 3.5 to 4 h | Option 1 plus peak rules, regulars exemptions and extra testing: 5 to 5.5 h |
| Total per-client hours incl. data report | 5.5 to 7 h | 7 to 8.5 h |
| Setup effective rate | $400: $57 to $73/h | $600: $71 to $86/h |
| Monthly review time | 0.5 h = $37.50 | 0.75 h = $56.25 (two directions to watch, plus regulars' reactions) |
| Monthly compute | about $0.15 | about $0.15 |
| **Margin after time** | **$59 - $37.65 = $21.35 (36%)** | **$99 - $56.40 = $42.60 (43%)** |

Review time is **low confidence**: the first two months will be heavier (likely 1 h each), roughly break-even on Option 1 in those months.

**Pay online ahead of time**

| Item | Value |
|---|---|
| Per-client setup hours | 4 to 5 h: owner creates the Stripe account and verification with us, deposit rules per service, no-show and refund policy wording in 4 languages, Apple Pay domain verification, test payments and refunds, phone payment-link test |
| Setup effective rate at $400 | $80 to $100/h |
| One-time hard cost | $0 (Stripe has no setup fee; test-mode payments are free) |
| Monthly cost to us | Payment-link texts about $1.15 + support 0.25 h ($18.75) = **$19.90** |
| **Margin after time at $29** | **$9.10** (about $17 once support settles to about 0.15 h) |
| Cost to the salon, paid to Stripe | 2.9% + $0.30: $1.46 on a $40 deposit, $3.78 on a $120 colour paid in full. Fee kept by Stripe on refunds. |
| Card data | Stripe-hosted payment fields (Payment Element or Checkout) and Stripe payment links: card numbers never reach our servers. Keeps us in the lightest PCI scope (SAQ A, from memory; not re-checked). |

**First-build effort (one time, not per client).** Neither the website nor the voice agent has any pricing-rule or payment code yet. Estimated one-time build: smart pricing engine (rules by day, hour and service, caps, exemptions, price lock at booking, all-in price shown on the site and passed to the voice agent, owner approval screen) **12 to 18 h**; payments (Stripe checkout with Apple Pay and Google Pay, deposits, webhooks, dashboard refunds, no-show handling, payment-link text from the voice agent) **14 to 20 h**. That is $1,950 to $2,850 of time, **not covered by one client's setup fee**; it is product investment reused for later clients. **Do not build either before a client signs for it.** More lines needs no new product code beyond the concurrency cap and overflow flow (about 2 h, one time). Low confidence on all build estimates.

**Summary**

| Add-on | Setup | Monthly | Monthly cost to us incl. support time | Margin after time | Suggested floor (monthly) |
|---|---|---|---|---|---|
| More lines (carrier path) | $150 | $39 | $18.75 | $20.25 | $29 ($10.25 after time) |
| More lines (port path) | $150 | $39 | about $41.60 at 12 calls/day | about -$2.60 | $39; quote $49 if busy |
| Quiet-hour savings | $400 | $59 | $37.65 | $21.35 | $39 (about $1 after time) |
| Full smart pricing | $600 | $99 | $56.40 | $42.60 | $79 ($22.60 after time) |
| Pay online ahead of time | $400 | $29 | $19.90 | $9.10 | $19 (-$0.90 after time at 0.25 h; only if support stays light) |

Legal notes for smart pricing and payments (not legal advice): the Competition Act deems a price unattainable because of fixed mandatory fees to be misleading (s. 74.01(1.1), s. 52(1.3), since June 2022; the 2024 amendments limit the exception to taxes imposed on the buyer by law), and the Cineplex penalty (about $38.9 million, upheld by the Federal Court of Appeal in January 2026) shows the Bureau enforces it. BC's BPCPA s. 4 treats failing to give the total price prominence, or a price benefit that does not exist, as deceptive. So: one all-in price per time slot, never "regular price + peak fee"; any "save X%" measured against the real everyday menu price; no card surcharge added at checkout; deposit and no-show policy shown before booking. Sources in proposal [21] to [25]. The Bureau's algorithmic pricing consultation (What We Heard, January 2026) is a watch item, not a rule yet.

---

## 2. Unit prices charged to the client

| Item | Price | Our cost | Unit margin |
|---|---|---|---|
| Extra phone minute (beyond 400 included) | $0.25 | $0.167 | $0.083 (33%) |
| Handwritten card, all in | $8.50 | $7.21 to $7.91 | $0.59 to $1.29 |
| Extra promo SMS segment (beyond 500 included) | $0.05 | $0.0231 | $0.027 (54%) |
| Starter promotions add-on (500 segments) | $49/month + $150 setup | $14.56 at full use (segments + number) + drafting | See 1.9 |
| Optional add-ons: More lines, Smart pricing (2 options), Pay online | $39 / $59 or $99 / $29 a month; $150 / $400 or $600 / $400 setup | See 1.10 | See 1.10 |

Included minutes (400 per month in Growth and Complete) cost us about **$67** at full use. Included promo segments (500) cost about **$11.55** at full use, plus $3.01 for the promo number.

---

## 3. Usage scenarios (per month)

AI-answered calls depend heavily on the answering mode. Low and Medium assume backup plus after-hours mode (only missed and after-hours calls reach the AI). High assumes "every call" mode at a busy salon.

| Scenario | AI-answered calls | Avg minutes per call | AI minutes (incl. the Oct 3 language greeting line, removed Oct 5: about 4 / 8 / 16 fewer, see 1.8) | Bookings (all channels) | SMS sent (2 per booking, avg 1.655 segments) | Promo texts (avg 1.85 segments) | Cards mailed |
|---|---|---|---|---|---|---|---|
| Low | 150 | 2.0 | 304 | 250 | 500 | 150 (278 segments) | 15 |
| Medium | 350 | 2.0 | 708 | 450 | 900 | 600 (1,110 segments) | 40 |
| High | 700 | 2.2 | 1,556 | 700 | 1,400 | 2,000 (3,700 segments) | 80 |

All volumes are estimates. Real call volume, miss rate and booking count are discovery questions for Friday.

### 3.1 Monthly running cost by component (CAD)

| Component | Low | Medium | High |
|---|---|---|---|
| Hosting + database + domain | 43.70 | 43.70 | 43.70 |
| SMS confirmations and reminders ($0.0231/segment, Unicode segments for Chinese/Korean) | 19.12 | 34.41 | 53.52 |
| Toll-free texting number (verified) | 3.01 | 3.01 | 3.01 |
| **Base (all packages)** | **65.83** | **81.12** | **100.23** |
| AI phone minutes ($0.1673/min) | 50.78 | 118.48 | 260.37 |
| Transfers (10% of calls, 3 min, outbound) | 0.88 | 2.06 | 4.12 |
| Twilio number | 1.61 | 1.61 | 1.61 |
| **Phone subtotal** | **53.27** | **122.14** | **266.10** |
| **Promotions subtotal** (segments, replies, drafting, second toll-free number; see 1.9) | **9.89** | **29.94** | **91.97** |
| Cards ($7.58 each) | 113.70 | 303.20 | 606.40 |

Base was 57.60 / 68.72 / 82.63 before the SMS rate correction and the toll-free number.

---

## 4. Margin by package

List prices (unchanged): Starter $99/mo (promotions add-on $49/mo), Growth $279/mo (400 min and 500 promo segments included), Complete $349/mo (same, plus cards at $8.50 each). Overage: $0.25/min, $0.05/promo segment. Support time: Starter 0.5 h, Growth 1 h, Complete 1.5 h, plus 0.25 h wherever promotions are on.

| Package | Scenario | Revenue | Running cost | Gross margin | Gross % | After support time | Before promotions (old table) |
|---|---|---|---|---|---|---|---|
| Starter | Low | 99.00 | 65.83 | 33.17 | 34% | -4.33 | 3.90 |
| Starter | Medium | 99.00 | 81.12 | 17.88 | 18% | -19.62 | -7.22 |
| Starter | High | 99.00 | 100.23 | -1.23 | -1% | -38.73 | -21.13 |
| Starter + promo add-on | Low | 148.00 | 75.72 | 72.28 | 49% | 16.03 | |
| Starter + promo add-on | Medium | 178.50 | 111.06 | 67.44 | 38% | 11.19 | |
| Starter + promo add-on | High | 308.00 | 192.20 | 115.80 | 38% | 59.55 | |
| Growth | Low | 279.00 | 128.99 | 150.01 | 54% | 56.26 | 93.13 |
| Growth | Medium | 386.50 | 233.20 | 153.30 | 40% | 59.55 | 90.13 |
| Growth | High | 728.00 | 458.30 | 269.70 | 37% | 175.95 | 144.27 |
| Complete | Low | 476.50 | 242.69 | 233.81 | 49% | 102.56 | 139.43 |
| Complete | Medium | 796.50 | 536.40 | 260.10 | 33% | 128.85 | 159.43 |
| Complete | High | 1,478.00 | 1,064.70 | 413.30 | 28% | 282.05 | 250.37 |

Revenue includes overage minutes, promo segments and cards. Example, Growth Medium: $279 + (708 minus 400) x $0.25 + (1,110 minus 500) x $0.05 = $386.50. Figures use unoptimised confirmation templates (1.655 segments); with one-segment Chinese/Korean confirmations (1.2 average), add back $5.26 (Low), $9.46 (Medium) or $14.71 (High) per month to every package.

**What changed and why:** the $31 to $37/month drop in Growth and Complete at Low/Medium is about $5 to $9 from the corrected SMS rate on confirmations (would have hit us anyway), $3 for the toll-free number, $10 to $30 for the promotions themselves, and $18.75 for the extra 0.25 h of support, partly offset at Medium by $30.50 of promo overage. At High, promo overage more than pays for itself.

**Reading the table:**
- **Starter is now loss-making after time** (gross margin still positive except at High), mainly because confirmations cost more per segment than we thought and the first client carries the whole hosting bill. It is the entry door, not the profit centre. One-segment confirmation templates (now a must, not a nice-to-have) and shared hosting (3 or more clients, roughly +$28/month) bring it back to about $5 to $30/month after time. **Do not discount Starter at all ($99 is now the floor).** I kept $99 rather than raising it because the fix is mostly on our side (templates, shared hosting) and the price was set before the meeting; revisit for the next client.
- **Starter + promotions add-on** is profitable after time in every scenario. Use it as the upsell when Growth is too much.
- **Growth is still the sweet spot**: about $56 to $176 a month after time (was $90 to $144), 37% to 54% gross. Including 500 segments costs us only about $15 a month at full use; the bigger cost is support time. Kept at $279: the promotions make Growth a much easier sell against Starter + add-on ($148), and overage protects us from heavy texters.
- **Complete** adds about $45 to $105 a month over Growth at Low to High. Gross % falls at high card volume because cards are nearly pass-through, but absolute margin grows.

---

## 5. Setup fee economics

| Package | Setup fee | Estimated hours | Effective rate | One-time hard costs |
|---|---|---|---|---|
| Starter | $1,200 | 19 to 24 h (adapt demo to real menu and photos, Chinese and Korean translation review, deploy, Google Business Profile and Yelp claim, onboarding, training) | $50 to $63/h | Domain about $20 |
| Growth | $2,200 | Starter + 13 to 17 h (prompt tuning in 4 languages, saved-language opening tests, call forwarding with the carrier, test calls, 2 weeks of transcript review) | $57 to $69/h | Test calls about $15 |
| Complete | $2,700 | Growth + 6 to 8 h (card templates EN/ZH, approval flow, consent capture, first batch) | $59 to $70/h | 3 to 5 sample cards about $40 |
| Promotions (inside Growth and Complete setup) | no change | + 3 to 4 h (two toll-free verifications, consent wording in 4 languages, front-desk training, first campaign with the owner) | Growth falls to $49 to $63/h; Complete to $51 to $66/h | None (verification is free) |
| Starter promo add-on | $150 | about 2 h | about $75/h | None |

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
| Carrier SMS fees rise 25% | Segment $0.0260. Confirmations +$4 (Medium); promo overage margin 48%. Fine; revisit if fees rise more than 50%. |
| Half of promo recipients non-English (instead of 35%) | 2.0 segments per promo text. Medium promo cost +$2.08, overage revenue +$4.50. Fine. |
| Composer holds English to 1 segment, Chinese/Korean to 2 | 1.35 segments per promo text. Medium promo cost -$6.93 (and the owner fits about 370 texts in 500 segments). Worth building: live segment counter, warn on emoji and curly quotes in English (they force UCS-2 and can triple the segments). |
| Owner turns on implied consent (2-year paid visit) | Audience grows, so segments grow. Covered by overage. Compliance risk rises slightly (proof rests on our booking records); keep that mode off by default. |
| Twilio requires A2P-style registration for Canadian toll-free in future | One-time fees of roughly $20 to $50 USD and $2 to $10 USD/month if US-style fees applied. Absorb; small. |

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

**SMS marketing evidence (added Oct 3)**

| Claim | Value | Source | Quality |
|---|---|---|---|
| Text reminders improve attendance | Cochrane review, 8 RCTs, 6,615 people: SMS reminders increase attendance vs no reminder; cost per attendance 55% to 65% of phone-call reminders | https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD007458/abstract | Good (independent), but healthcare reminders, not promotions. **Used, carefully.** |
| "98% open rate" for SMS | 98% open, 45% response (vs 20% and 6% for email) | Gartner, widely recycled; SMS has no open tracking, so this is an estimate. https://www.clickminded.com/sms-marketing-statistics/ ; https://blog.burstsms.com.au/sms-marketing/2015/12/1/how-accurate-is-the-98-sms-open-rate/ | Weak as a measurement. **Not used as a number**; proposal says it is an estimate. |
| SMS click-through and opt-out | CTR 19% to 36%; opt-out 1% to 2% per send; evening sends see the most unsubscribes | Sakari, Infobip (both sell SMS). https://sakari.io/blog/sms-marketing-benchmarks-2025-performance-metrics-and-industry-insights ; https://infobip.com/blog/sms-marketing-benchmarks | Weak (vendor). **Opt-out range used** (1 to 3 STOPs per 150); CTR not used. |
| Salon rebooking lift | "15% to 25% higher rebooking", "30% more repeat bookings", "70% more likely to return" | EZ Texting, Bird/Aimy case study, Sakari playbooks: https://www.eztexting.com/use-cases/hospitality/salons-spas ; https://bird.com/en-gb/customers/aimy | Weak (vendor marketing, methods unclear). **Not used.** |
| Salon win-back campaigns | Phorest Client Reconnect: one salon "recouped $21,000" in 2019; another about 175 clients and $12,000 from a few campaigns; an Illinois salon gets about 12 calls in 20 minutes after an overdue-client text or email | https://www.salontoday.com/articles/how-these-salons-are-reclaiming-at-risk-clients (trade press quoting Phorest customers) | Weak to medium (anecdotes). Can be mentioned verbally, not in the proposal. |
| Promo ROI assumption | 5% of 150 recipients book within 14 days; 2 of 7 would have come anyway | My assumption, deliberately below every vendor figure | Estimate. The dashboard's "booked within 14 days" counts attribution, not true lift; to measure lift later, hold back 10% of an audience as a comparison group. |

No independent salon-specific study of SMS promotion results was found. No salon-specific study of handwritten card win-back rates was found. The proposal says so implicitly by framing the card program as a measured test.

---

## 9. To verify before or soon after signing

1. ConversationRelay per-minute rate for the voices we will use, especially Cantonese (yue-HK), Mandarin (cmn-CN) and Korean (ko-KR); confirm all three are supported for transcription and speech in ConversationRelay and that switching language mid-call works (not confirmed in research).
2. Handwrytten current per-card price, Canada delivery time, and whether Chinese-character and Korean (Hangul) handwriting fonts are available. If not, Chinese-language cards may need a different provider or English-only handwriting with a printed Chinese greeting. **This matters for the Lunar New Year pitch.**
3. Which Claude model `voice-agent/` uses, and measured tokens per call.
4. Hosting plan costs.
5. The owner's phone carrier and whether conditional call forwarding (no answer / busy) is available on their line.
6. Twilio Canada SMS price and carrier fees on the live pricing page (base $0.0075 vs $0.0079 vs $0.0083 USD; carrier fees per carrier). Rerun section 1.9 if the all-in segment differs from $0.0165 USD by more than 15%.
7. Whether `website/` sends confirmations and promotions from separate numbers (see 1.9), whether it uses toll-free numbers, and whether it honours non-English STOP words.
8. That the booking link in promos lands on a page showing the salon's mailing address and phone number (CASL identification by link), and that consent records store channel, time, staff member or call ID, and the wording shown.
9. How a phone-booking "yes" is recorded, given call recordings are deleted after 30 days.
10. Add to the one-page agreement: the owner is responsible for promo content and hand-recorded consent; we are responsible for STOP, quiet hours and caps working; promo segment price may change on 30 days' notice if carrier fees change.
11. More lines: the owner's carrier and line type, and whether it supports call-forward-busy plus a hunt or overflow group (carrier path, no cost to us). If a port is needed, confirm the Twilio Canada port fee ($7 USD per number, from a snippet), plan for up to 4 weeks, and price the staff-answered pass-through minutes (or a SIP desk phone) before quoting $39.
12. Four simultaneous AI calls on one Twilio account and one Anthropic key work without hitting concurrency or rate limits (test at setup).
13. Stripe: the live Canada rate (2.9% + C$0.30, from snippets), that Connect Standard (or the salon's own keys) carries no platform fee for us, and Apple Pay domain verification on the salon's domain.
14. Smart pricing: that the website shows one all-in price per slot and the voice agent quotes the same number; no "peak fee" line at checkout. If the owner wants surge pricing (Option 2), suggest a quick check with a lawyer; not legal advice.
15. The new returning-caller behaviour (Oct 5): that ConversationRelay accepts the opening language, voice and transcription per call from the saved language for yue-HK, cmn-CN and ko-KR, and that the English-to-other switch for new callers still works mid-call.
