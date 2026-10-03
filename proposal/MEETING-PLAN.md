# Meeting Plan: CF Hair Salon (developer only, do not share)

**When:** Friday, October 9, 2026, 2:00 to 2:45 PM PT
**Where:** CF Hair Salon, Unit 2140, Henderson Place Mall, 1163 Pinetree Way, Coquitlam (confirm whether the owner prefers to meet at the salon or nearby; 2 PM Friday may be busy, so ask for a quiet corner or offer to wait for a gap)
**Goal:** a signed Growth package (or Starter with a booked upgrade date) and an onboarding session booked for Oct 13 to 16.
**Companion docs:** `PROPOSAL.md` (print 2 copies), `COSTS.md` (internal, keep on laptop only).

---

## 0. Before the meeting (checklist)

**Research and setup (by Thursday Oct 8)**
- [ ] Call (604) 475-7705 three or four times at different times (for example Tue 11 AM, Wed 3 PM, Thu 6:15 PM after close) as a normal enquiry (ask about a price or availability). Note how many were answered, how many rings, and whether there is voicemail and in what language. Real evidence beats industry stats. Be honest if asked: "I called a few times this week to see what a client experiences."
- [ ] Walk past the salon: note signage, any price board (photograph it if public), how many chairs, how busy, staff languages overheard.
- [ ] Check Google Maps for the salon's listing (rating, reviews, hours, claimed or not). This could not be retrieved in research.
- [ ] Pull the latest demos from `website/`, `voice-agent/` and `notes/`; read each README and confirm the exact commands and routes below still match. Run all three end to end twice.
- [ ] Load the demo with `shared/salon.json` data but rename stylists to neutral names if the placeholder "Stylist A/B/C" looks odd on screen. Make sure no PLACEHOLDER text is visible on the website demo.
- [ ] Record a 60-second screen capture of each demo as a backup (mall Wi-Fi may be poor). Bring a phone hotspot.
- [ ] If a live phone number is configured for `npm run demo`, test calling it from a mobile in English, Mandarin, Cantonese and Korean. If Cantonese or Korean quality is shaky, demo the strongest languages live and say the others will be tuned with them.
- [ ] Prepare the returning-caller demo (section 2.3, step 7): make sure your demo phone number is already saved with language = Cantonese in the demo database (call once in Cantonese beforehand, or set it in the dashboard). Check `voice-agent/README.md` for how `npm run simulate` sets the caller's number.
- [ ] Prepare the promotions demo (section 2.4): seed the demo database with about 20 clients across English, Simplified Chinese, Traditional Chinese (Cantonese) and Korean, a mix of opted-in, not opted-in and one already opted out, a few with last visit 4+ months ago, and one with a birthday this month. Add your own mobile as an opted-in client so "send test to yourself" and the STOP reply work live. Check `website/README.md` for the Promotions route (expected under `/admin`) and whether texts actually send in the demo or are simulated. Have a Chinese or Korean speaker sanity-check the drafted translations once.
- [ ] Print: 2 x PROPOSAL.md, 1 x notes proof sheet (colour), 1-page agreement (scope, fees, payment terms, 30-day pilot, data ownership, card price change clause on 30 days' notice, and the texting responsibilities line from `COSTS.md` section 9, item 10).
- [ ] If possible, order one physical sample card from the handwriting provider now (Oct 3) addressed to yourself. It may not arrive by Friday (mailed from the US), but if it does, it is the single best prop.
- [ ] Language: the owner may be more comfortable in Cantonese, Mandarin or Korean. If you do not speak the owner's language, consider bringing a bilingual friend, or at least have the website's Chinese and Korean versions and the Chinese card samples ready to show.

**Bring:** laptop (charged) + charger, phone with speakerphone, hotspot, printed proposal, proof sheet, agreement, pen, business card, a small tablet if available (owner dashboard looks best on a tablet).

---

## 1. Agenda (45 minutes)

| Time | Block | What to do |
|---|---|---|
| 0:00 to 0:04 | Hello and purpose | Thank them for the time. "I build websites and booking tools for local businesses. I looked CF Hair up online and saw some easy wins, and I built a working demo with your salon in mind. I'd love to ask a few questions first, then show you." |
| 0:04 to 0:14 | Discovery | Ask the priority questions in section 3 (aim for the top 8, including the texting question). Listen more than talk. Write numbers down; you'll use them in the ROI. |
| 0:14 to 0:31 | Live demo | Website and booking (4 min), dashboard (2 min), phone receptionist (6 min), text promotions (3 min), handwritten cards (2 min). Script in section 2. Tie each demo back to something they said in discovery. |
| 0:31 to 0:38 | Proposal and pricing | Walk through section 6 of the proposal. Rebuild the ROI table with THEIR numbers (calls per day, miss rate, average ticket). Recommend Growth. |
| 0:38 to 0:43 | Questions and concerns | Handle objections (section 4). |
| 0:43 to 0:45 | Close | Ask for the decision. Book the onboarding slot. If not ready, book a follow-up date and leave the printed proposal. |

---

## 2. Live demo script

Keep each demo short and in the owner's world: their services, their mall, their clients. Let the owner drive the mouse or phone when possible.

### 2.1 Website and online booking (about 5 minutes)

Setup: `cd website && npm run dev`, open http://localhost:3000 (confirm routes against `website/README.md`; expected: home, services, booking flow, `/admin`).

1. **Home page, English.** Say: "This is what a client sees when they search 'hair salon Coquitlam' on their phone. Your hours, your location in Henderson Place, near Lincoln SkyTrain."
2. **Tap the language switch: English / 简体中文 / 한국어.** Say: "One tap and the whole site is in Chinese, or in Korean for the North Road crowd. Your neighbours in the mall mostly don't offer this."
3. **Services page.** Show the menu with prices. Say: "These prices are placeholders; we'll use your real menu."
4. **Book an appointment** (hand them the phone or laptop):
   - Service: Women's Haircut. Stylist: "Anyone available". Date: next Saturday. Pick an afternoon slot.
   - Name: use the owner's first name if they're happy to, phone: your own mobile.
   - Confirm. Say: "That's it. It's 9 PM on a Sunday, the salon is closed, and you just got a booking." If SMS confirmation is wired up, show the text arriving on your phone.

### 2.2 Owner dashboard (about 3 minutes)

1. Open `/admin` (password = `ADMIN_PASSWORD` from `website/.env`).
2. **Calendar by stylist**: point out the booking just made. Say: "Every booking, from the website, the phone or a walk-in, lands here."
3. **Add a walk-in**: one tap, Men's Haircut, Stylist B, now. Say: "So the calendar always matches what's really happening in the chairs, and the phone assistant never offers a time that's taken."
4. **Customers**: show the client list (visits, last visit, favourite stylist). Say: "This list builds itself. It's what lets us send the right card to the right person."
5. **Messages**: show a callback message (one will exist after the phone demo; you can come back here).

### 2.3 AI phone receptionist (about 6 minutes)

Option A (live call, best): `cd voice-agent && npm run demo` (confirm in `voice-agent/README.md`), then call the demo number on speakerphone, or better, hand the owner your phone and let them call.
Option B (no network or no live number): `cd voice-agent && npm run simulate` runs a text conversation in the terminal; type as the caller.

Run 4 or 5 of these, in this order (always finish with step 7, it is the wow moment):

1. **English booking.** "Hi, do you have anything Saturday afternoon for a men's haircut?" Let it offer times; pick one; give a name and number.
2. **Mandarin.** "你好，我想预约这个星期六下午剪头发。" (Hello, I'd like to book a haircut this Saturday afternoon.) Then "多少钱？" (How much?)
3. **Cantonese.** "你好，我想約星期六下晝剪頭髮，幾多錢呀？" (Hello, I'd like to book a haircut Saturday afternoon, how much is it?) If quality is shaky in the demo, be upfront: "Cantonese is the one we'll tune most carefully with your real clients during the pilot."
4. **Price question.** "How much is a digital perm, and how long does it take?"
5. **Reschedule.** "I need to move my Saturday appointment to Sunday."
6. **Ask for a person.** "Can I talk to someone?" Show it offers a transfer or takes a message.
   - Optional **Korean** line: "안녕하세요, 토요일 오후에 커트 예약하고 싶어요. 얼마예요?" (Hello, I'd like to book a cut Saturday afternoon. How much is it?)
7. **Returning Cantonese caller.** Call again from the number that used Cantonese earlier (or that is saved as Cantonese). The call opens with the normal English greeting, then immediately adds a short Cantonese line, for example "你好，歡迎返嚟！我哋可以用廣東話傾。" (Hi, welcome back! We can talk in Cantonese.), and carries on in Cantonese. Say: "Every call starts in English, but she spoke Cantonese last time, so it greets her in Cantonese and keeps going. Your regulars never have to ask twice." Then say "Can we speak English?" to show it switches back, and that the new choice is remembered.
   - Then in `/admin`, open that client and show the **Language** field, and change it. Say: "You can always see and change it. Private or blocked numbers are never remembered."

Then go back to `/admin`: show the new booking and the message from the call. Say: "Your phone rang, nobody had to stop cutting hair, and the booking is already in your calendar."

Talking points while it runs:
- "In backup mode your phone rings first. It only answers what you'd miss."
- "It only says what you've approved. If it doesn't know, it takes a message."
- "It tells callers it's the salon's virtual assistant. No pretending."

### 2.4 Text promotions (about 3 minutes)

Setup: same dashboard (`/admin`), Promotions screen (confirm the route in `website/README.md`). Your phone on the table, face up, sound on.

1. **Open Promotions and pick an audience.** Choose "Clients not seen in 4+ months". Point at the count and the split: "23 clients match. 15 said yes to texts; the other 8 haven't, so they're left out." Show the other audiences briefly: all opted-in clients, one stylist's clients, birthdays this month.
2. **Draft the message.** Type the idea in plain words, for example "15% off any cut Monday to Thursday until November 20, we miss you". Let it draft. Say: "You can rewrite any word. Every promotion always includes the salon name and 'Reply STOP to opt out'."
3. **Language preview.** Flip through English, 简体中文, 繁體中文 (for Cantonese clients) and 한국어. Say: "Each client gets it in their own language: the same language the phone line remembers for them." Point at the segment counter: "Chinese and Korean texts take more space, so the counter helps keep them short. That's what keeps your cost down."
4. **Send a test to yourself.** Send to your own phone; show it arriving. If the owner is willing, send it to their phone instead.
5. **STOP handling.** Reply "STOP" from your phone. Back in the dashboard, open your own client record: show it is now marked opted out, with the date and time, and that the next campaign's count drops by one. Say: "That's instant. The law gives you 10 business days; we do it in a second, and we keep a record in case anyone ever asks."
6. **Schedule.** Pick tomorrow at 7 pm, then try 10 pm: show it won't send after 8 pm (rehearse this; check whether the build blocks the time or moves it to 9 am next day). Mention the 4-a-month cap per client.
7. **Results.** Show the results view on a seeded past campaign: delivered, opt-outs, and "booked within 14 days". Say: "This is how you'll know if an offer works, in real bookings, not guesses."

Talking points:
- "Only people who said yes get these. The website box is unticked; they have to choose."
- "Booking confirmations and reminders are separate. They're not promotions."
- "Included in Growth: 500 segments a month, roughly 250 to 300 texts."

If live sending is not wired up in the demo, show the preview and results screens, and use a screenshot of a received text from your rehearsal.

### 2.5 Handwritten cards (about 2 minutes)

1. Open the notes proof sheet (generated by `notes/`; see `notes/README.md` for the command and output path; print it in colour as backup).
2. Show 4 cards: a first-visit thank-you, a birthday card, a "we miss you" card, and a Lunar New Year card (in Chinese if available).
3. Say: "Each one is written by a robot holding a real pen, on real card stock, with a real stamp. The words are personal: the client's name, their stylist, what they had done. And nothing is mailed until you approve it."
4. Show the approval step (approve / edit / skip) if the demo includes it.
5. Hook: "Lunar New Year is February 6. If we start in November, your clients get a handwritten 新年快乐 card from you in late January. Nobody else in the mall is doing that."

Caveat to keep in mind (do not volunteer unless asked): Chinese-character handwriting support from the provider is unconfirmed (see `COSTS.md` section 9). If asked, say you will show real Chinese samples before they commit to the card package.

---

## 3. Discovery questions

Many facts in `shared/salon.json` are placeholders. Write the answers straight into a copy of the JSON after the meeting.

### Top priority (ask these for sure)

1. **Calls:** "Roughly how many calls do you get on a normal day? How many do you think you miss, especially when everyone is with a client, or after closing? What happens to those callers?"
2. **Menu and team:** "Can you walk me through your main services and prices, and who on the team does what?" (Ask for a photo of the price list. Get stylist names, specialties, working days.)
3. **Languages:** "Which languages do your clients speak on the phone? Mandarin, Cantonese, English? Which should the assistant handle best?"
3a. **Korean clients:** "Do you get Korean-speaking clients, for example from the North Road and Lougheed area? Roughly what share? Does anyone on your team speak Korean, and are there Korean styles (perms, down perms) clients ask for?"
4. **Current booking and client records:** "How do you book now: paper book, phone, WeChat? Do you keep any client list with names, phone numbers, birthdays or addresses?"
5. **Budget and success:** "What would a good result look like in 30 days? And what monthly amount would feel comfortable for something that brings in more bookings?"
5a. **Texting:** "Do you text clients today? From which phone: the salon line, your own mobile, WeChat or KakaoTalk? Do you have a list of clients who've agreed to get offers from you?" (Details in "Text promotions" below.)

### Business basics (confirm the placeholders)

6. Opening hours each day, including holidays and Sunday. (Fresha directory says Mon to Sat 10 to 6, Sun 12 to 6; unconfirmed.)
7. Walk-ins: what share of clients are walk-ins vs booked?
8. No-shows and late cancellations: how often? Any deposit or cancellation policy?
9. Busiest days and slowest days or times (slow slots are where online booking helps most).
10. Average spend per visit, roughly. Mix of cuts vs colour, perms, treatments.
11. How many chairs and stylists? Any plans to hire?
12. What does "CF" stand for? Is there a logo, brand colours, signage?
13. Is it unisex? Any barbering, kids, extensions, Japanese straightening, Korean perms (match the Fresha tags)?

### Phone and tech

14. Who is the phone provider (Telus, Rogers, Shaw, other)? Landline or mobile? Who owns the account? Does the line have voicemail?
15. Do you use any software now (POS, Square, a booking app, WeChat groups, Xiaohongshu, Instagram)?
16. Do you have a Google Business Profile you can log into? Yelp?
17. Who would look at the dashboard day to day? Comfortable with a phone or tablet?

### Clients and marketing

18. Where do new clients come from today (mall foot traffic, referrals, WeChat, Google)?
19. What do clients most often ask on the phone?
20. Do you do anything for regulars now (loyalty, birthday discount, holiday greetings)?
21. Have you ever sent cards or gifts to clients? How did it go?
22. Is Lunar New Year a busy period? Any other peaks (graduation, weddings, back-to-school)?

### Text promotions

22a. **Current texting:** Do you already text clients (reminders, offers, "your stylist is running late")? From which phone or app? Roughly how many clients? Any complaints or replies like "stop texting me"? (Our texts come from a dedicated, carrier-verified texting number, not the salon landline, because Canadian carriers filter business texts from ordinary numbers. If they insist on texting from (604) 475-7705, note it and check whether the landline can be text-enabled later; do not promise it.)
22b. **Existing opt-in list:** Do you have any list of clients who agreed to receive offers (a sign-up sheet, a WeChat group, a loyalty card form)? How did they agree, and is it written down anywhere? (Only clients with recorded consent, or with a paid visit in the last 2 years if they choose implied consent, can be included. We can't mass-text the others to ask.)
22c. **Frequency:** How often would you want to send a promotion: once a month, twice, only around holidays? (Default cap is 4 a month per client; most salons will want 1 or 2.)
22d. **Typical promotions:** Which offers would you run? Prompt with: weekday or quiet-hour specials (Mon to Thu), Lunar New Year (Feb 6, 2027, also Seollal), back-to-school kids' cuts (late August), Mother's Day, graduation and wedding season, a new stylist's introductory price, colour or perm specials, "we miss you" for lapsed clients, birthday month treats.
22e. **Discounts:** Are you comfortable offering discounts, or would you rather offer an add-on (free treatment, free blow-dry)?
22f. **Languages:** For Chinese-speaking clients, which script do they read: simplified or traditional? Do Cantonese clients expect traditional characters? Who on the team can check a Korean or Chinese message before it goes out?
22g. **Who writes and approves:** Will you write the offers yourself, or should a manager do it?

### Decision

23. "Is there anyone else who'd be part of this decision?" (partner, family, landlord rules about signage)
24. "If this looks right, is there anything that would stop you from starting next week?"

---

## 4. Likely objections and responses

| Objection | Response |
|---|---|
| **"It's too expensive."** | "Compared with what? A part-time receptionist at BC's $18.25 minimum wage is about $2,200 a month for 25 hours a week. Growth is $279 and covers every hour. It pays for itself at just over one saved booking a week." Then offer Starter now and Growth later, or the pilot. |
| **"My clients like talking to a real person. Older clients won't talk to a robot."** | "Totally agree, and that's why the default is backup mode: your phone rings first and your team answers like today. The assistant only picks up calls that would otherwise ring out, and anyone can ask for a person. Let's try it for 30 days; if your clients don't like it, it's off and you get that month back." |
| **"We're busy enough already."** | "That's exactly when calls get missed. And online booking fills the quiet weekday slots, so the busy days stay busy and the slow days get better. It also gets you reviews and a real Google listing, which you'll want when the salon down the hall gets more aggressive." (The SOOM, in the same mall, already uses Fresha.) |
| **"I'll just use Fresha / Booksy, it's cheaper."** | "Those are good apps. Three things to know: Fresha takes 20% of a new client's first visit when they come through the marketplace, Booksy's Boost takes 30%, and both list you right next to your competitors, including salons in this building. Neither answers your phone in Cantonese or Korean. With us there are no commissions and the client list is yours." |
| **"What if the AI says something wrong?"** | "It only uses the menu and policies you approve, it never guesses a price, and it can only book real free slots. For the first two weeks I personally read every call summary. You can switch it to after-hours only with one tap." |
| **"Handwritten cards sound like a gimmick" / "too expensive per card."** | "It's optional, and you set the monthly cap. Start with 20 'we miss you' cards: $170. If three people come back, it's paid for. We track exactly who returns after a card, so you'll know." |
| **"I don't have time to set this up."** | "You need about two hours total: one onboarding session and a quick review. I do everything else, including call forwarding with your phone company." |
| **"What about privacy?"** | "We follow BC's privacy law (PIPA): we only collect what's needed, birthdays and addresses are optional and with permission, there's a privacy policy on the site, and clients can ask to see or delete their info. You own all the data." |
| **"Will clients find texts annoying?" / "I don't want to spam my clients."** | "Good instinct, and the system is built around it. Only clients who said yes get promotions; the website box starts unticked. Nobody gets more than 4 a month (most salons send 1 or 2), nothing goes out before 9 am or after 8 pm, every text has the salon name and 'Reply STOP', and STOP works instantly. After every campaign you see how many people opted out, so if an offer annoys people, you'll know the same day. The trick is to send fewer, better texts: a real offer, in their language, for a quiet weekday. Industry figures put opt-outs around 1 to 2% per send; if yours run higher, we send less." |
| **"Is texting even legal? I heard about anti-spam fines."** | "Yes, with consent, and that's why consent is built in. Canada's anti-spam law (CASL) needs three things: permission, the salon's name and contact details, and an easy opt-out. The system records every 'yes' with the date and how it was given, and every STOP. The big fines go to people texting strangers without permission; we only text people who said yes, or, if you choose, recent paying clients, which the law allows for two years." (Do not give legal advice; if they want implied-consent mode or have an old list, suggest a quick check with a lawyer.) |
| **"Isn't it creepy that it remembers people?"** | "It only remembers one thing: which language they used last time, so it can say hello in that language. It still opens in English every time, callers can switch back with one sentence, you can edit it in the dashboard, and private numbers are never remembered. It's what a good receptionist does anyway." |
| **"You're one person. What if you disappear?"** | "Fair question. The domain is registered in your name, your data can be exported any time, and everything is built on standard, widely used tools any developer can maintain. It's month to month, so you're never locked in." |
| **"Let me think about it."** | "Of course. What's the main thing you'd want to think through?" Address it. Then: "The founding-client offer runs until October 23. Can we pencil in the onboarding for next week and you can cancel it by Monday if you decide not to?" |
| **"Can you do it cheaper?"** | Trade, don't cut: see section 5. |

---

## 5. Pricing and negotiation

**List prices (from the proposal):**

| Package | Setup | Monthly | Included |
|---|---|---|---|
| Starter | $1,200 | $99 | Website, booking, dashboard, booking SMS, Google/Yelp setup. Promotions add-on: $49/month incl. 500 segments, $150 setup |
| Growth | $2,200 | $279 | + AI phone, 400 min ($0.25/min after) + promotions, 500 segments ($0.05/segment after) |
| Complete | $2,700 | $349 | + cards at $8.50 each |

**Recommend Growth.** It is the best value for them and the best margin for you (about $56 to $176/month after time, see `COSTS.md` section 4). Promotions make the jump from Starter easier to justify: Starter + promotions is $148, Growth is $279 and adds the phone receptionist.

**Explaining segments simply:** "Phone companies charge per 'segment': about 160 letters in English, or 70 characters in Chinese or Korean. Most English offers are 1 or 2 segments, Chinese and Korean 2 or 3. 500 segments is roughly 250 to 300 texts a month at your language mix." Our cost is about 2.3 cents a segment, so 5 cents is honest and still leaves margin.

**Floor (do not go below):**

| Package | Setup floor | Monthly floor | Notes |
|---|---|---|---|
| Starter | $800 | $99 (no monthly discount at all) | Starter is now loss-making after time on the first client once the corrected SMS cost is counted (see COSTS.md 1.9 and 4). Push the promotions add-on or Growth instead of discounting. |
| Starter promotions add-on | $100 | $39 | Below $39 the add-on barely covers support time. |
| Promo segment overage | | $0.04 | Our cost is $0.0231 ($0.024 at FX 1.45). Never below $0.04. |
| Growth | $1,500 | $229 (with 300 included minutes) | Never below $199/month. Below that, offer Starter only. |
| Complete | $1,900 | $299 | |
| Overage minutes | $0.20 | | Our cost is about $0.17 at FX 1.45. Never below $0.20. |
| Cards | $8.00 | | Our cost is $7.21 to $7.91; never below $8.00. |

**Concessions to trade, in this order (before cutting price):**
1. Split setup into 3 payments (signing, website live, phone live).
2. Free first month of overage minutes, or 20 free cards (already in the founding offer; use it as the closer).
3. Extra included minutes (for example 500 instead of 400; costs you about $17 more at full use), or extra included promo segments (for example 1,000 instead of 500; costs you about $12 more at full use, and is a cheap, visible concession).
4. Waive $300 to $500 of setup in exchange for: a written testimonial, permission to use CF Hair as a case study, and two referrals to other salons or shops in Henderson Place.
5. Prepay 6 months: one month free.
6. Only then, move toward the floor.

**What not to concede:** owner approval on cards (protects both of you), call disclosure, the texting safeguards (unticked opt-in box, STOP, 9 am to 8 pm window, salon name in every promo; express consent by default), the right to adjust card and segment prices on 30 days' notice if the provider, carrier fees or exchange rate change.

**Payment terms:** 50% setup at signing, 50% at website go-live. Monthly fees start per product at go-live. Month to month after the 30-day pilot, 30 days' notice.

---

## 6. After the meeting

- Same day: send a thank-you message (text or WeChat if they use it) with the proposal PDF and the onboarding time.
- Update `shared/salon.json` with confirmed facts (and set `verified.*.status` to "owner-confirmed" with the date).
- Rebuild the ROI section of the proposal with their real numbers before the onboarding session.
- If signed: register the domain in the owner's name, start Google Business Profile verification (it can take days), and ask their phone provider about conditional call forwarding. Buy the two toll-free texting numbers (booking texts, promotions) and submit Twilio toll-free verification the same week (free, about 3 to 5 business days), so the opt-in box can go live with the website in Week 2.
- If they have an existing opt-in list, get a copy with how and when each person agreed; import only those with a record, and mark the consent source as "imported, [date], [method]".
- Draft their first two campaigns from the discovery answers (for example a weekday special and a Lunar New Year offer) for the Week 3 session.
- Order a few sample cards (English, Chinese and Korean) to show at onboarding, and confirm the provider's Chinese and Korean handwriting support.
