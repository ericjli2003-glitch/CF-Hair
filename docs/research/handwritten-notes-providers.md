# Handwritten card providers for CF Hair Salon

Date checked: 2026-10-03. Prices are USD unless marked CAD.

Method note: the research sandbox could run web searches but its egress proxy blocked direct page fetches for most vendor sites (handwrytten.com, simplynoted.com, scribeless.co and others). Figures below therefore come from search-result extracts of the vendor pages and from third-party listings, each linked. The one primary source read in full was Handwrytten's official TypeScript SDK on GitHub, which the `notes/` adapter is built against. Anything marked "unconfirmed" should be checked on the vendor's own pricing page or by email before the first live send.

## What we need

- Real pen on paper (ballpoint or gel), not a printed "handwriting" font. Recipients can tell, and the whole point is that the card feels like a stylist wrote it.
- An API we can drive from the `notes/` CLI, with per-recipient messages.
- Mailing to Canadian addresses (Coquitlam, Port Moody, Port Coquitlam, Burnaby).
- No large minimums: a small salon will send roughly 30 to 120 cards a month.

## Comparison

| Provider | API | Price per card | Postage to Canada | Real pen? | Turnaround | Minimum | Custom handwriting font |
|---|---|---|---|---|---|---|---|
| **Handwrytten** (Phoenix, AZ) | Yes. Public REST API v2, official TypeScript and Python SDKs, Zapier, MCP server | 3.75 retail. Subscriptions 10 to 20% off (Silver 100/mo for 24 cards, Gold 198/mo for 50, Platinum 378/mo for 100). Business plans: Pro 449/mo at 1.99/card, Enterprise 649/mo at 1.49, Elite 849/mo at 1.29 | Flat 1.80 international stamp plus 0.10 manual-processing surcharge per card; Canada and 180+ countries supported | Yes, robots holding real pens | 1 to 3 business days to write and mail; default send date is 2 business days out; then cross-border transit | None (single cards allowed) | 1,750 (block/caps) or 2,000 (cursive) one-time, 1 to 4 weeks; signature only 250 |
| **Simply Noted** (Gilbert, AZ) | Yes. REST API, webhooks, Zapier, CSV. Developer docs not public; request from support | From 3.25 including US postage; "Unlimited" plan advertised at 0.89/note (plan fee not captured); contact sales for 1,000+ | Ships to Canada; dispatches from US, UK, Canada and Australia per its site. Canadian postage price not published (unconfirmed) | Yes, 220+ robots with real ballpoint pens | Not captured | None stated | 1,500 one-time, 7 to 10 business days |
| **Scribeless** (UK) | REST API, Zapier, HubSpot, Shopify | From 2.75 plus postage; pay-as-you-go or monthly | Has a production facility in Canada, so Canadian mail can go out with domestic postage | Conflicting sources. A competitor comparison says Scribeless laser-prints a handwriting font; other listings call it robot-written. Treat as printed until a sample proves otherwise | Not captured | None stated | Choice of styles; custom available (price not captured) |
| **Thankster** (US) | API via Zapier and Make; no public REST docs found | About 2.09 on the entry monthly plan, 2.64 for a one-off card; Medium and Large plans take 0.30 and 0.70 off per card | Not documented (unconfirmed) | Conflicting sources: one listing says robotic pens, another says printed font | Not captured | None (free plan, pay per card) | Included on paid plans (1 or 3 fonts) |
| **PostGrid** (Toronto, ON) | Yes. Mature print-and-mail REST API, Canada Post routing, address verification | Starter plan is free up to 500 pieces/month plus per-piece price (letter and postcard rates on their pricing page, not captured) | Domestic Canada Post | No. Printed letters and postcards; a script font in an HTML template is the closest it gets | Print-and-mail SLA | None | Any web font in the template (still printed) |
| **Cardly** (Australia) | REST API and Zapier | AUD 3.95 (1 to 49 cards) down to AUD 2.75 (2,000+), postage included | Operates in 50+ countries; Canadian production not confirmed | No. Printed reproduction of real people's handwriting, "enhanced to emulate the inconsistency of real mail" | Same day dispatch claimed | None | Yes (captured real handwriting) |
| **Canadian real-pen API provider** | None found | | | | | | |

No Canadian company offering robot pen-written cards through an API turned up. The Canadian-based options are PostGrid (printed only) and Scribeless's Canadian facility (production method disputed).

## In-house option: AxiDraw pen plotter

| Item | Detail |
|---|---|
| Hardware | AxiDraw V3 about USD 550, AxiDraw V3/A3 about USD 700 (Solarbotics listings, model now marked discontinued at some retailers in favour of the SE line). The current AxiDraw SE/A4 is sold by Evil Mad Scientist and RobotShop Canada; price not captured. Budget CAD 900 to 1,200 landed with a pen kit. |
| Speed | Maximum XY travel 28 cm/s (11 in/s). Evil Mad Scientist says addressing an envelope "might typically take a minute or two". Our estimate for a 300 to 400 character card at a natural-looking speed: 2 to 3 minutes, plus about 1 minute for the envelope and card handling, so roughly 12 to 15 cards an hour with someone feeding cards. |
| Fonts | Plotters need single-stroke ("engraving") fonts, otherwise each letter is traced as an outline. Evil Mad Scientist's Hershey Text extension ships Hershey and EMS single-line fonts (the EMS fonts are SIL OFL derivatives of Google Fonts such as Felipa and Source Sans). `notes/` vendors five of them and renders millimetre-accurate SVG with seeded human jitter. |
| Running cost | Blank A2 card and envelope about CAD 0.85 in packs; Canada Post stamp CAD 1.24 in booklets (CAD 1.44 single) since 2025-01-13; pen refills negligible. About CAD 2.14 per card in materials and postage, or about CAD 3.47 if four minutes of front-desk time at CAD 20/hour is counted. |
| Pros | Canadian stamp and a local postmark, delivered in 1 to 3 days locally; cheapest per card; staff can add the Chinese lines by hand (no robot font writes Chinese); owner controls everything. |
| Cons | Hardware cost up front; someone has to load cards; quality depends on pen choice and setup. |

## Recommendation

**Default provider: Handwrytten.** It is the only real-pen service that publishes all three things this project depends on: a documented REST API with an official TypeScript SDK (so the adapter is built against real request shapes, including a basket `test_mode`), an explicit price and process for mailing to Canada, and no minimum order. Planning cost per card to a Coquitlam address:

- Pay-as-you-go: 3.75 card + 1.80 stamp + 0.10 surcharge = **USD 5.65, about CAD 7.74** (at 1.37 CAD per USD).
- Platinum subscription (20% off the card): about USD 4.90, about CAD 6.71.
- Business plans bring the card itself to 1.49 to 1.99, but the 449 to 649 monthly fee only pays off above roughly 200 cards a month.

Caveats to tell the owner: the cards are mailed from the US with US international postage, so they take longer than a local card and the stamp is not Canadian; and Chinese text cannot be robot-written, so Chinese-preference clients get the English card (the proof sheet shows the Chinese version for a staff member to add by hand if desired).

**Upgrade path: an in-house AxiDraw** once the salon is steadily sending more than about 60 cards a month. At about CAD 3.47 per card including labour versus CAD 7.74, a CAD 1,000 plotter pays for itself after roughly 235 cards (about four months at 60 a month), and it fixes both caveats above. The `notes/` CLI already supports it (`--provider plotter`).

**Not recommended for this use:** PostGrid, Cardly and probably Scribeless print the handwriting; Thankster's method and Canadian support are unclear. PostGrid remains a good, cheap Canadian option if the salon ever wants printed postcards (for example a seasonal promo), which is a different job.

## Sources

Handwrytten
- API reference: https://www.handwrytten.com/api/ and https://www.handwrytten.com/api-redoc/
- Official TypeScript SDK (read in full; request shapes, auth header, `test_mode`, `client_metadata`, countries list): https://github.com/handwrytten/handwrytten-js-sdk
- International mailing (Canada, flat 1.80 stamp, 0.10 surcharge): https://handwrytten.helpscoutdocs.com/article/23-international-mailing
- Custom fonts (1,750 / 2,000, 1 to 4 weeks): https://handwrytten.helpscoutdocs.com/article/53-make-your-mark-with-custom-fonts
- Custom signature (250): https://handwrytten.helpscoutdocs.com/article/7-custom-signature-handwrytten-cards
- Sign-off limit 50 characters: https://handwrytten.helpscoutdocs.com/article/39-wishes-is-longer-than-50-characters-error-received
- Message length "about 560 characters": Handwrytten knowledge base, Cards category, https://handwrytten.helpscoutdocs.com/category/13-cards
- Turnaround (1 to 3 business days, default send date): https://handwrytten.helpscoutdocs.com/article/52-how-to-send-a-single-card-with-handwrytten
- Plans and per-card prices: https://toolradar.com/tools/handwrytten/pricing, https://us.fitgap.com/products/handwrytten, https://www.techjockey.com/us/detail/handwrytten, https://handwrytten.helpscoutdocs.com/article/37-subscription-vs-prepaid-credits
- MCP server: https://mcp.handwrytten.com/

Simply Noted
- Home page (220+ robots, ballpoint pens, API, dispatch countries): https://simplynoted.com/
- FAQ (custom font 1,500, 7 to 10 business days): https://simplynoted.com/pages/faq
- Pricing claims (3.25 including postage, 0.89 Unlimited plan): https://simplynoted.com/blogs/news/handwritten-note-servicessimplynoted-vs-handwrytten-pricing-quality-features, https://g2.com/products/simply-noted/pricing
- Cost guide comparing 14 services (vendor-authored): https://simplynoted.com/blogs/news/handwritten-note-service-cost-pricing-guide-2026

Scribeless
- Listings (2.75 plus postage, integrations, US/UK/Canada facilities): https://www.capterra.com/p/197113/Scribeless/, https://apps.shopify.com/scribeless, https://ecosystem.hubspot.com/marketplace/listing/scribeless-202755
- Production method (competitor claim that it is printed): https://simplynoted.com/blogs/news/simply-noted-vs-scribeless

Thankster
- https://www.g2.com/products/thankster/pricing, https://osher.com.au/tools/thankster/, https://www.make.com/en/help/app/thankster, https://eseospace.com/blog/best-handwritten-note-services-small-businesses-2026/

PostGrid
- https://www.postgrid.com/letter-api/, https://www.postgrid.com/plans-and-pricing/, https://postgrid.readme.io/docs/design-and-templates

Cardly
- https://cardly.net/business/products, https://www.g2.com/compare/cardly-vs-handwrytten-vs-simply-noted

AxiDraw and postage
- Prices: https://www.solarbotics.com/?p=88588 (V3, USD 550), https://solarbotics.com/?p=173348 (V3/A3, USD 700), https://shop.evilmadscientist.com/938 (SE/A4), https://ca.robotshop.com/products/axidraw-v3-personal-writing-drawing-robot
- Speed and envelope timing: https://www.evilmadscientist.com/?p=7172, https://elektor.com/products/axidraw-v3-writing-and-drawing-machine
- Single-stroke fonts: https://wiki.evilmadscientist.com/AxiDraw_Fonts, https://www.evilmadscientist.com/?p=20566, https://github.com/techninja/hersheytextjs
- Canada Post stamp prices from 2025-01-13: https://www.canadapost-postescanada.ca/cpc/en/our-company/news-and-media/corporate-news/news-release/2025-01-13-price-of-a-domestic-stamp-increases-by-25-cents
