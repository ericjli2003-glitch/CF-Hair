# CF Hair Salon: public site redesign plan (approved)

Applies to the public pages: home, services, team, contact, booking flow and confirmation. The owner admin keeps its layout and only picks up the new type.

## Concept

The page opens on a photo of the salon, beside a tight column with the name, where it is, whether it is open, the phone, "Book a time" and the languages spoken. Directly below is the salon's price board: real services, durations and prices in the visitor's language, with a Book button on each row. (Until 2026-10-05 the board was the hero; the owner asked for "an image before" the menu.) The second distinctive element is wayfinding: how to reach Unit 2140 from Lincoln SkyTrain through Henderson Place, drawn as a simple route.

## Logo

Added 2026-10-05 at the owner's request ("use their logo"). The logo is recreated from the storefront sign in Henderson Place (`website/src/components/art/Logo.tsx`): a large Didone "CF" in brick red, set tight, and "Hair Salon" to its lower right in widely spaced geometric capitals (H and S full height, the rest a size smaller) where the O of SALON is a small solid red square.

- "CF" is a vector path: the outlines of Bodoni Moda ExtraBold (wght 800, opsz 28) converted with fontTools, so no serif webfont is downloaded and the icons use the same drawing. "Hair Salon" is live text in Jost Medium, loaded with next/font and used only in the logo.
- Variants: full lockup (public header from 1024px, mobile menu, footer, admin login); compact "CF" only (public header under 1024px, admin top bar, favicon, the hero placeholder); reversed on deep green (footer, hero placeholder): CF and Hair Salon in board white, the square in light terracotta `#F2BFA9`.
- Accessible name "CF Hair Salon" (`role="img"`); where the name is already written or the logo is a duplicate it is `aria-hidden`.
- Icons: `src/app/icon.svg` (the CF path in logo red on board white), `apple-icon.png` (180px) and `favicon.ico` (16, 32, 48px) rendered from it. The small sizes carry a thin stroke so the hairlines survive.
- **Logo red `#9B2226`** (`--color-logo`) is a brand colour for the logo and the seal only. Never for buttons, links, UI elements or text. Deep green stays the UI palette and the only action colour.

**TODO (owner):** this is a faithful recreation from a photo of the sign, not the original artwork. When the owner sends their logo file (SVG, AI or a high-resolution PNG), replace `Logo.tsx` and regenerate the three icon files from it.

## Colour

The owner chose the palette on 2026-10-04: three colours sampled from their image, deep green `#3B5147`, terracotta `#DD7551` and lilac `#C892DE`. They replace the earlier black-and-rod palette on the public site and in the owner admin. Layout, type and every accessibility fix stay as they were. All values live as tokens in `website/src/app/globals.css` (`@theme`); components use the token names, not hex.

Roles:

- Deep green is the brand and the only action colour: primary buttons (Book a time, Book, Continue, Approve), the active language segment, the active booking step, selected times and days, link hover, focus rings, and the dark statement areas (the public footer, highlighted stat cards in the admin, the login panel). Text on it is white.
- Terracotta is a marker, used sparingly and always with dark text: the Haircuts category, the destination on the route diagram, and the admin's "needs you" counts (nav badges, waiting and message chips). Never body text, never a large wash. White on terracotta fails (3.1:1) and is not used.
- Lilac is a second marker with dark text: the Perms category, and pending or informational chips (sent, scheduled, queued, rescheduled).
- Neutrals are tinted toward the green, so the page reads as one family.

| Token | Hex | Role |
|---|---|---|
| Tile | `#EEF2EF` | Page background, light green-grey |
| Board / Paper | `#FBFCFB` | Price board, forms, cards, admin surfaces |
| Ink | `#1C2622` | Text, near-black green |
| Slate (admin: ink-soft) | `#4B5A53` | Secondary text |
| Mute | `#56655E` | Tertiary text, disabled button fill |
| Rule / Line | `#C8D3CC` | Hairlines, never text |
| Edge | `#74857C` | Form field borders (3:1 or more) |
| Sand | `#DFE7E2` | Pressed and hover fills on tile |
| Primary | `#3B5147` | Deep green, see roles above |
| Primary hover | `#2E4038` | Hover and pressed |
| Primary wash / line | `#E1EAE4` / `#A9BEB1` | Selected rows, confirmed and sent chips |
| On primary soft | `#D6E0DA` | Secondary text on green |
| Terra | `#DD7551` | Terracotta fill and marker |
| Terra wash / line / deep | `#FBE6DD` / `#EDB49C` / `#8C3A1C` | Waiting, message and sample-text chips |
| Lilac | `#C892DE` | Lilac fill and marker |
| Lilac wash / line / deep | `#F4EAF8` / `#DABEE7` / `#61327A` | Sent, scheduled and rescheduled chips |
| Alert | `#A3122A` | Errors and destructive actions (hover `#851022`) |
| Logo red | `#9B2226` | The logo and the seal only, never UI (see Logo) |
| Alert wash / line | `#FBEBEE` / `#EBB4BD` | Failed, no-show and cancelled chips |

Service categories keep the perm-rod idea: one colour per category on the price board bands, the rod markers (team rows, services nav, booking summary) and the schedule blocks. The category name is always written next to the colour. Each has a lighter tint for row hover, the selected service and confirmed schedule blocks (completed blocks use the tint at 45%).

| Category | Fill | Text on fill | Tint |
|---|---|---|---|
| Haircuts | `#DD7551` terracotta | Ink | `#F3CDC0` |
| Styling | `#F2BFA9` light terracotta | Ink | `#F7D9CB` |
| Colour | `#A9BFB2` green tint | Ink | `#D0DCD5` |
| Perms | `#C892DE` lilac | Ink | `#E8D1F1` |
| Treatments | `#E4CFEE` light lilac | Ink | `#ECDDF3` |
| Extensions | `#3B5147` deep green | White | `#D4D9D7` |

Stylist markers in the admin schedule (dot and block edge) are dark palette inks, distinct from the category fills: `#3B5147`, `#7A3518`, `#5E3474`, `#1C2622`, `#5F6B2F`.

Status colours in the admin always sit next to their word: confirmed, approved, booked and delivered in green wash; waiting, message, sending and implied consent in terracotta wash; scheduled, queued, sent (cards) and rescheduled in lilac wash; failed, no-show and withdrawn in alert red; completed, cancelled, skipped and spam in neutral.

The handwritten card mock-ups keep their own paper, ink, stamp and sample-text sticker; only the chrome around them uses the palette.

## Type

- Barlow, one family in three widths (Barlow, Barlow Semi Condensed, Barlow Condensed), via next/font. Signage feel. Prices use tabular figures and right alignment.
- Chinese and Korean: system fonts first (PingFang SC/TC, Microsoft YaHei/JhengHei, Apple SD Gothic Neo, Malgun Gothic), Noto Sans SC/TC/KR as fallback. Avoid shipping large CJK webfonts.
- Clear type scale; body line length under 80 characters; sentence case everywhere.

## Layout

```
Desktop
+--------------------------------------------------------------+
| CF Hair Salon (logo)    Services Team Visit  EN 简体 繁體 한국어 [Book a time] |
+------------------------+-------------------------------------+
| CF Hair Salon          |  +-------------------------------+  |
| Cuts, colour and perms |  |                               |  |
| at Unit 2140, ...      |  |   photo of the salon, 4:3,    |  |
| ---------------------- |  |   on a thin paper mat,        |  |
| o Open today until 6 pm|  |   at most 680 px wide         |  |
| (604) 475-7705         |  |                               |  |
| [Book a time]          |  +-------------------------------+  |
| We speak ...           |                                     |
+------------------------+-------------------------------------+
| Services and prices (the board, full width, two columns)     |
|  Haircuts ...   [Book]   |  Perms ...        [Book]          |
|  Styling ...    [Book]   |  Treatments ...   [Book]          |
|  Colour ...     [Book]   |  Extensions ...   [Book]          |
+--------------------------------------------------------------+
| Getting here: Lincoln Station -> Henderson Place -> Unit 2140  |
+--------------------------------------------------------------+
| Team: one row per stylist, what they do, languages they speak |
+--------------------------------------------------------------+

Mobile: the photo first at full content width (4:3), then the
name, status, phone and languages, then the board in one column,
then a "Book a time" bar fixed to the bottom of the screen.
```

The board on the home page splits its categories, in order, into two columns from 1024px where the two sides come out closest in rows. It no longer scrolls inside itself. The hero photo is `website/public/images/hero.jpg`; until it exists the same box is a deep green panel with the reversed CF and the faint lattice (see `website/README.md`).

Left-aligned throughout; prices right-aligned so they line up.

## Principles

1. Spend boldness in one place: the board and its category colours. Everything else stays quiet, with deep green carrying the actions.
2. Tapping Book on a board row starts the booking flow with that service already chosen (skip step 1). The booking flow keeps numbered steps because it is a real sequence.
3. Remove: the italic single-word headline accent, all-caps tracked eyebrow labels, arrows appended to buttons and links, middle-dot meta strings, the cream-and-serif look, decorative gradients, identical card grids. The owner's terracotta stays a marker with dark text, never a page wash.
4. Motion only in response to the visitor: a short crossfade of board text on language switch; the booking step change. No scroll-triggered reveals. Respect prefers-reduced-motion.
5. Plain, specific copy: "Book a time", "Open today until 6 pm", "Unit 2140, Henderson Place". Actions keep the same name through the flow.
6. Quality floor: responsive to 360px, visible keyboard focus, accessible contrast, all four languages (en, zh-CN, zh-HK, ko) laid out and checked.

## Contrast (WCAG 2.x, palette of 2026-10-04)

Every text-on-background pair in use. Normal text needs 4.5:1, large text and non-text indicators 3:1. The axe audit (`npm run audit:ux`, 134 runs) reports 0 violations with this palette.

| Text | Background | Ratio | Where |
|---|---|---|---|
| Ink `#1C2622` | Tile `#EEF2EF` | 13.8:1 | Body text on the page |
| Ink `#1C2622` | Board `#FBFCFB` | 15.1:1 | Price board, forms, admin surfaces |
| Slate `#4B5A53` | Tile `#EEF2EF` | 6.4:1 | Secondary text |
| Slate `#4B5A53` | Board `#FBFCFB` | 7.1:1 | Descriptions, durations |
| Mute `#56655E` | Tile `#EEF2EF` | 5.4:1 | Admin tertiary text |
| Mute `#56655E` | Board `#FBFCFB` | 6.0:1 | Admin tertiary text |
| White | Primary `#3B5147` | 8.6:1 | Buttons, active toggle and step, footer, stat cards |
| White | Primary hover `#2E4038` | 11.0:1 | Button hover |
| On primary soft `#D6E0DA` | Primary `#3B5147` | 6.3:1 | Footer tagline, stat card captions |
| Primary `#3B5147` | Board `#FBFCFB` | 8.3:1 | Outline buttons, link hover |
| Primary `#3B5147` | Primary wash `#E1EAE4` | 7.0:1 | Confirmed, booked chips |
| Slate `#4B5A53` | Primary wash `#E1EAE4` | 5.9:1 | Selected rows |
| Ink `#1C2622` | Terra `#DD7551` | 5.0:1 | Haircuts band, admin count badges |
| Terra deep `#8C3A1C` | Terra wash `#FBE6DD` | 6.4:1 | Waiting, message, sample-text chips |
| Ink `#1C2622` | Lilac `#C892DE` | 6.4:1 | Perms band |
| Lilac deep `#61327A` | Lilac wash `#F4EAF8` | 8.0:1 | Sent, scheduled, rescheduled chips |
| Alert `#A3122A` | Board `#FBFCFB` | 7.6:1 | Field errors |
| Alert `#A3122A` | Alert wash `#FBEBEE` | 6.8:1 | Failed, no-show chips |
| White | Alert `#A3122A` | 7.8:1 | Urgent message tag, destructive button |
| White | Mute `#56655E` | 6.1:1 | Disabled primary button |
| Ink `#1C2622` | Colour `#A9BFB2` | 8.0:1 | Colour band |
| Ink `#1C2622` | Styling `#F2BFA9` | 9.5:1 | Styling band |
| Ink `#1C2622` | Treatments `#E4CFEE` | 10.7:1 | Treatments band |
| White | Extensions `#3B5147` | 8.6:1 | Extensions band |
| Slate `#4B5A53` | Category tints | 5.0:1 to 5.6:1 | Schedule blocks, selected service (lowest: Haircuts tint `#F3CDC0`, 4.96:1) |
| Focus ring `#3B5147` | Tile `#EEF2EF` | 7.6:1 | Keyboard focus (non-text, 3:1 needed) |
| Logo red `#9B2226` | Tile `#EEF2EF` | 7.0:1 | Logo in the header, admin bar |
| Logo red `#9B2226` | Board `#FBFCFB` | 7.7:1 | Logo on the admin login, icons, seal on the confirmation and cards |
| Ink `#1C2622` | Tile `#EEF2EF` | 13.8:1 | "Hair Salon" in the logo |
| Board `#FBFCFB` | Primary `#3B5147` | 8.3:1 | Reversed logo in the footer |
| Light terracotta `#F2BFA9` | Primary `#3B5147` | 5.2:1 | The square in the reversed logo (non-text, 3:1 needed) |
| Edge `#74857C` | Board `#FBFCFB` | 3.8:1 | Field borders (non-text, 3:1 needed) |

No text pair in use is under 4.5:1. Not used: white on terracotta (3.1:1), white on lilac (2.4:1), logo red on deep green (1.1:1) and terracotta on deep green (2.8:1, so the reversed logo's square is light terracotta). Mute on the category tints is 4.2:1 to 4.7:1, so schedule blocks use ink and slate only.


## Cultural details

Added 2026-10-05 at the owner's request: "add some Chinese influences, don't make it too Chinese, keep it clean". The salon is in Henderson Place, a Chinese-themed mall, and its clients speak Mandarin, Cantonese, Korean and English, so the details are quiet, structural ones from Chinese gardens and craft that read as good design to everyone. There are four, and only four.

1. **Seal (印章).** A small square chop in the logo red with "CF" cut into it, the way a 白文 (intaglio) seal prints: the letters are knocked out, so the paper or page shows through. The edge wobbles very slightly and has two small nicks, like carved stone; there is no texture, so it stays crisp from 24px to 64px. One component, `website/src/components/art/Seal.tsx`. Since 2026-10-05 it is not the logo (the salon's own logo is, see Logo); it is used only as a stamp: the signature at the bottom right of the booking confirmation, and the stamp at the bottom right of each handwritten card mock-up in the admin Cards tab. Its ink is the logo red, as red seal ink is traditionally, so the brand red is one colour.
2. **Moon-gate frames (月洞门).** Stylist photo slots on the home team section and the team page are round, inside a thin deep green ring set a little away from the photo, like a garden moon gate. The dashed "Photo slot" placeholder stays until the owner's photos arrive (`PhotoSlot frame="moon"`).
3. **Window lattice (窗格).** A plain straight-line lattice from Chinese window screens: a square grid with a smaller square in each cell, tied at the midpoints (`Lattice.tsx`). It appears in one place: the deep green footer, in white at 5% opacity, as a faint texture.
4. **Breathing room (留白).** Generous space around the hero's text column and the photo's paper mat. (Until 2026-10-05 the seal and the week's hours sat low in the hero's left column, far below the Book button; the owner found it disconnected, so the hero is now one tight group and the week's hours are in the footer.)

Rules:

- The logo red is the seal's colour. No red and gold, no dragons, lanterns, clouds or other clip-art, no brush-calligraphy fonts, no gradients.
- No Chinese characters as decoration on English pages. Chinese appears only where it is the visitor's language.
- The lattice is decorative only, always `aria-hidden`, and never under text at more than 5% white on green; white text on the footer stays above 7:1. Besides the footer it appears only in the hero placeholder (4.5% white, no text over it), which disappears once the owner's photo is in place.
- The seal is a graphic, not text: `role="img"` with the label "CF Hair Salon". Its red is a brand colour, exempt from the text contrast rules (it is 7.7:1 on board anyway); nothing reads only from it.
- One seal per view as a stamp. Do not rotate it more than a few degrees, add ink texture, or use it as a bullet or divider.

Tried and removed: a lattice band as the divider above "Getting here". At any size it read as a decorative border and pushed the page toward a theme, so the plain hairline stays.

**TODO (owner):** the salon's Chinese name is not confirmed. Once the owner gives it, the seal can carry those characters (two or four, read top to bottom, right to left) in place of "CF". Until then the seal holds no Chinese characters. The geometry is in `SEAL_LETTERS` in `Seal.tsx`.
