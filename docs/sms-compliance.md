# Promotional texts: CASL compliance

How the CF Hair Salon system meets Canada's Anti-Spam Legislation (CASL) for promotional SMS, and what the owner still needs to do. This is a practical summary for a small business, not legal advice.

Checked on 2026-10-03. Government sites (laws-lois.justice.gc.ca, crtc.gc.ca, ised-isde.canada.ca, fightspam.gc.ca) and twilio.com could not be fetched from the build environment, so the points below were confirmed through search results that quote those pages. Read the sources before go-live.

## What CASL requires, and where the system does it

| Obligation | What the law says | How the system handles it |
|---|---|---|
| Consent before sending | A commercial electronic message (a promotional text) needs express or implied consent (CASL s. 6(1)). | Campaigns go only to express consent by default. Implied consent is used only when the owner ticks "Include implied consent" for that campaign. Everyone else is skipped, with the reason recorded per recipient. |
| Express consent must be opt-in | Pre-checked boxes are not valid; the person must actively agree (CRTC Compliance and Enforcement Information Bulletin 2012-548). | The booking form checkbox is unchecked by default and is not needed to book. |
| What a consent request must say | The request must identify who is asking, with a mailing address and a phone, email or web address, and say that consent can be withdrawn (Electronic Commerce Protection Regulations (CRTC), s. 4). | The checkbox wording names CF Hair Salon, says what texts they will get, says "Reply STOP any time", and the line under it gives the salon's address, phone and "You can withdraw consent at any time". The phone assistant's question and the owner's front desk script name the salon and mention STOP. |
| Implied consent: existing business relationship | A purchase of goods or services in the two years before the message creates implied consent (CASL s. 10(10)); an inquiry gives only six months. The two years restart with each new purchase. | Implied consent comes only from a completed, paid visit. The expiry date (visit plus two years) is calculated per client, extended by each new paid visit, and expired relationships drop out automatically. Free consultations and no-shows do not count. |
| Proof of consent | The sender has the burden of proving consent (CASL s. 13). | Every consent change is written to an append-only `ConsentEvent` log: type, source (web checkbox, owner, phone assistant, text keyword, paid visit), who recorded it, timestamp, the exact wording shown, spoken or received, and the language. The client page in the admin shows this history. |
| Identification in every message | Each message must identify the sender and give contact information that stays valid for 60 days (CASL s. 6(2), Regulations s. 2 and 3). Where that does not fit, a link to a page with the information is accepted. | `compose.ts` always adds "CF Hair Salon:" at the start, and refuses to send a message without it. Set `SMS_INFO_URL` (for example the site's contact page) to add a short link with the full mailing address and phone. |
| Unsubscribe mechanism in every message | Free, simple, works for at least 60 days, and processed within 10 business days (CASL s. 6(2)(c) and 11). For SMS, replying STOP is an accepted mechanism. | Every promotional text ends with a localised "Reply STOP to opt out" line, counted in the segment length. STOP, UNSUBSCRIBE, CANCEL, END, QUIT, STOPALL, REVOKE, OPTOUT, ARRET, 退订, 退訂, 取消 and 수신거부 withdraw consent the moment the webhook receives them (well inside 10 business days), and consent is re-checked right before each text is sent. |
| Transactional messages | Booking confirmations and reminders about an appointment the client made are not promotional (CASL s. 6(6)). | They never depend on promotional consent and carry no promotional content. They also leave from a separate number (see below). |

Penalties: administrative monetary penalties of up to $1 million per violation for an individual and $10 million for a business.

## Things the system adds on top of the law

- Quiet hours: no promotional texts before 9:00 am or from 8:00 pm, America/Vancouver. A campaign scheduled into quiet hours moves to 9:00 am, and queued texts are held if the clock passes 8:00 pm mid-send. CASL has no time-of-day rule for texts; this follows the spirit of the CRTC telemarketing rules (calls 9:00 am to 9:30 pm on weekdays) and is kinder to clients.
- Frequency cap: at most 4 promotional texts per client per 30 days by default, changeable on the Promotions page.
- A withdrawal is permanent until the client opts in again (START, the web checkbox, the phone question, or the owner recording a yes). A later paid visit does not quietly restore implied consent.
- The phone assistant asks at most once per client, only after a successful booking, only with caller ID, and records a "no" so it never asks again.

## Two senders: promotions and appointments

Promotions and appointment texts leave from different Twilio senders (`TWILIO_PROMO_*` and `TWILIO_TXN_*`). With Twilio Advanced Opt-Out, a STOP blocks that recipient for the sender they replied to. With one shared number, a client who opts out of promotions would also stop getting booking confirmations and reminders.

- STOP to the promotions number: withdraws promotional consent only.
- STOP to the appointment number: marks the client as "appointment texts off" (the carrier blocks those texts anyway). Confirmations and reminders then go by email when there is one, and the admin shows it on the client list and client page. START to that number turns texts back on. Promotional consent is not changed.
- Only promotional texts carry "Reply STOP to opt out". Appointment texts still honour STOP, as Twilio requires.
- The system refuses to send a campaign if no separate promotions sender is configured (or if it is the same as the appointment sender), except in the offline outbox mode.

Cost: one extra number. Twilio lists a Canadian local number at $1.15 USD a month and a toll-free number at $2.15 USD a month, so budget about 3 to 4 dollars a month for it.

## Twilio Advanced Opt-Out

Twilio's Advanced Opt-Out (on by default for Messaging Services) handles the English keywords STOP, UNSUBSCRIBE, END, QUIT, STOPALL, REVOKE, OPTOUT and CANCEL at the carrier level, replies on its own, and then blocks further texts from that sender (error 21610) until the person texts START, UNSTOP or (on long codes) YES. The app must stay in sync with that block list, so:

- the inbound webhook still receives those replies and records the withdrawal, and uses Twilio's `OptOutType` field when present;
- the app does not send its own reply to keywords Twilio already answered (no double replies);
- YES re-subscribes only a number that is currently opted out, because Twilio treats it as an opt-in keyword;
- a send that fails with 21610 is treated as a carrier-level opt-out and recorded;
- the Chinese and Korean keywords are not known to Twilio, so the app is the only thing honouring them and it replies itself.

## Before go-live

- Confirm the checkbox and phone wording with the owner (and a lawyer if in doubt).
- Set `SMS_INFO_URL` to a page with the salon's mailing address and phone, or keep messages short enough to include them.
- Add the same opt-out sentence to the HELP reply configured in Twilio's Advanced Opt-Out settings.
- Keep consent records for as long as you text the client and well after the last message (CASL sets no minimum retention period).
- Mention text messaging in the salon's privacy notice (BC PIPA).

## Sources

- [Canada's Anti-Spam Legislation (CASL), consent and existing business relationship](https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/node/7) (ISED), and [Getting consent to send email](https://www.fightspam.gc.ca/eic/site/030.nsf/eng/00008.html): implied consent from a purchase lasts two years.
- [CASL guidance on implied consent](https://crtc.gc.ca/eng/com500/guide.htm) (CRTC).
- [Frequently Asked Questions about CASL](https://crtc.gc.ca/eng/com500/faq500.htm) (CRTC): unsubscribe by replying STOP or by a link; information by link when space is limited.
- [Compliance and Enforcement Information Bulletin CRTC 2012-548](https://crtc.gc.ca/eng/archive/2012/2012-548.htm): no pre-checked boxes; required content of a consent request.
- [Telecom Regulatory Policy CRTC 2012-183](https://crtc.gc.ca/eng/archive/2012/2012-183.htm) and the [Electronic Commerce Protection Regulations (CRTC)](https://laws.justice.gc.ca/eng/regulations/SOR-2012-36/section-6-20120307.html).
- Unsubscribe within 10 business days, contact details valid for 60 days: [Conestoga College CASL summary](https://www.conestogac.on.ca/canadas-anti-spam-legislation), [Lexpert CASL FAQ](https://www.lexpert.ca/news/legal-faq/is-your-company-complying-with-canadian-anti-spam-legislation/379649).
- Penalties and burden of proof: [Gowling WLG, "CASL: is your business ready"](https://gowlingwlg.com/fr/insights-resources/articles/2017/casl-is-your-business-ready), [BLG, CASL year in review](https://www.blg.com/en/insights/2017/01/casl--year-in-review).
- [Unsolicited Telecommunications Rules: Know your obligations](https://crtc.gc.ca/eng/phone/telemarketing/tobligations.htm) (CRTC): telemarketing calling hours.
- Twilio: [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out), [Support for opt-out keywords](https://support.twilio.com/hc/en-us/articles/223134027-Twilio-Support-for-Opt-Out-Keywords-SMS-STOP-Filtering), [error 21610](https://www.twilio.com/docs/api/errors/21610), [SMS pricing for Canada](https://www.twilio.com/en-us/sms/pricing/ca).
