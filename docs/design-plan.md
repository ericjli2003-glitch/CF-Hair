# CF Hair Salon: public site redesign plan (approved)

Applies to the public pages: home, services, team, contact, booking flow and confirmation. The owner admin keeps its layout and only picks up the new type.

## Concept

The hero is the salon's price board: real services, durations and prices in the visitor's language, with a Book button on each row. It is useful on first load and does not depend on photos the owner has not supplied yet. The second distinctive element is wayfinding: how to reach Unit 2140 from Lincoln SkyTrain through Henderson Place, drawn as a simple route.

## Colour

Perm rods are colour-coded by size; service categories borrow that idea. Rod colours encode category only, never decoration.

| Token | Hex | Role |
|---|---|---|
| Tile | `#E8EDEA` | Page background, cool salon-tile grey-green |
| Board | `#FFFFFF` | Price board and form surfaces |
| Ink | `#000000` | Text and primary buttons (black, no accent colour) |
| Rod pink | `#F2A7B8` | Haircuts |
| Rod lilac | `#B7A6E0` | Perms |
| Rod blue | `#7FB2E0` | Colour |
| Rod yellow | pick from the same family | Styling |
| Rod grey-green | pick from the same family | Treatments |

Check contrast: rod colours appear as markers and fills behind black text, never as text colour on white.

## Type

- Barlow, one family in three widths (Barlow, Barlow Semi Condensed, Barlow Condensed), via next/font. Signage feel. Prices use tabular figures and right alignment.
- Chinese and Korean: system fonts first (PingFang SC/TC, Microsoft YaHei/JhengHei, Apple SD Gothic Neo, Malgun Gothic), Noto Sans SC/TC/KR as fallback. Avoid shipping large CJK webfonts.
- Clear type scale; body line length under 80 characters; sentence case everywhere.

## Layout

```
Desktop
+--------------------------------------------------------------+
| CF Hair           EN  简体  繁體  한국어            [Book a time] |
+------------------------------+-------------------------------+
| CF Hair Salon                |  Haircuts  (pink rod marker)   |
| Cuts, colour and perms in    |  Men's haircut   30 min  $30 [Book]
| Henderson Place, Unit 2140.  |  Women's haircut 45 min  $50 [Book]
|                              |  Perms     (lilac rod marker)  |
| Open today until 6 pm        |  Korean down perm 45 min $60 [Book]
| (604) 475-7705               |  Digital perm   3 hr   $220 [Book]
| [Book a time]                |  ...full menu scrolls within the board
+------------------------------+-------------------------------+
| Getting here: Lincoln Station -> Henderson Place -> Unit 2140  |
+--------------------------------------------------------------+
| Team: one row per stylist, what they do, languages they speak |
+--------------------------------------------------------------+

Mobile: name and hours first, then the board full width,
then a "Book a time" bar fixed to the bottom of the screen.
```

Left-aligned throughout; prices right-aligned so they line up.

## Principles

1. Spend boldness in one place: the board and its rod colours. Everything else stays quiet.
2. Tapping Book on a board row starts the booking flow with that service already chosen (skip step 1). The booking flow keeps numbered steps because it is a real sequence.
3. Remove: the italic single-word headline accent, all-caps tracked eyebrow labels, arrows appended to buttons and links, middle-dot meta strings, the cream/serif/terracotta palette, decorative gradients, identical card grids.
4. Motion only in response to the visitor: a short crossfade of board text on language switch; the booking step change. No scroll-triggered reveals. Respect prefers-reduced-motion.
5. Plain, specific copy: "Book a time", "Open today until 6 pm", "Unit 2140, Henderson Place". Actions keep the same name through the flow.
6. Quality floor: responsive to 360px, visible keyboard focus, accessible contrast, all four languages (en, zh-CN, zh-HK, ko) laid out and checked.
