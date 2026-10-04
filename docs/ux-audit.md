# CF Hair Salon website: UX and accessibility audit

Date: 2026-10-04. Scope: the public pages (home, services, team, contact), the booking flow and confirmation page, and the owner admin (schedule, bookings, new booking, messages, calls, clients, promotions, cards, login).

Rulebook: the ui-ux-pro-max skill (priority categories 1 to 9, rule ids from `references/quick-reference.md`, pre-delivery checklist from `references/pro-rules.md`). Visual direction: `docs/design-plan.md` (approved) and the frontend-design skill. Where they disagree on looks, the plan wins; on accessibility, usability and performance the skill's rules apply. The skill's `--design-system` output for "hair salon" was not used.

## How it was checked

- `scripts/audit-ux.mjs` (run with `npm run audit:ux` against a throwaway copy of the database): axe-core 4.13 (WCAG 2.0/2.1/2.2 A and AA plus best practice), horizontal overflow, interactive targets under 44 px, the `html lang` value, layout shift on load and on language switch, and whether every admin tab and badge is inside the visible nav. It covers the public pages and booking states in en, zh, hk and ko at 360, 390, 768, 1024 and 1440 px (axe at 390 and 1440), the details step with errors, the slot-taken 409 (mocked), the confirmation page, and every admin page at 820 (iPad portrait), 1024 and 1440.
- Targeted skill searches, one intent each: `touch target size`, `focus states visible`, `error placement form`, `loading button disabled submit`, `live badge count screen reader`, `badge chip label wraps`, `focus not obscured`, `reduced motion animation`, `layout shift reserve space`, `deep linking url state`, `back button history`, `error summary validation`, `color contrast text` (all `--domain ux`), `icon button accessible label` (`--domain icons`), and `font loading layout shift`, `html lang metadata`, `image optimization next/image`, `client navigation search params` (`--stack nextjs`). `overflow menu navigation` and its retry `overflow menu actions` returned no matching rule, so the admin nav fix uses the static index rules `overflow-menu` and `chip-collection-reflow` from quick-reference.md.
- Manual review of the code and of before and after screenshots (`docs/screenshots/website/7x-*-before.png` and `7x-*-after.png`).

## Results in numbers

| Check | Before | After |
|---|---|---|
| axe violations (133 page views before, 134 after) | 9 rules, 2060 nodes: color-contrast 1525, dlitem 268, target-size 155, definition-list 36, region 31, link-name 30, landmark-unique 8, landmark-one-main 4, aria-allowed-role 3 | 0 |
| Public targets under 44 px (all languages and widths, inline text links excluded) | 2104 instances, 1132 of them under 24 px | 0 |
| Admin targets under 44 px | 1722 instances, 660 under 24 px | 753, none under 24 px (dense data rows, see L1) |
| Admin tabs or badges outside the visible nav at 820 px | Cards tab and its badge scrolled out of view (see `7x-admin-cards-ipad-portrait-before.png`) | none at 820, 1024 or 1440 |
| Horizontal overflow, 4 languages x 5 widths | none | none |
| Layout shift on load / on language switch | 0 / 0.0003 | 0 / 0.0003 |
| `html lang` | en-CA, zh-Hans, zh-Hant-HK, ko on load | same, and it updates on an in-page language switch |
| Overlays: focus stays inside over 25 Tab and 25 Shift+Tab presses, background inert, Escape closes, focus back on trigger (booking drawer, call drawer, phone menu) | none of these held (no focus containment, no inert) | all three pass, no `inert` left behind after closing |

## Findings

Ranked by severity. Status: Fixed, Open (not fixed, with the reason), or Kept (a deliberate choice).

| # | Severity | Area | Issue | Rule id | Fix | Status |
|---|---|---|---|---|---|---|
| C1 | Critical | Admin nav | On iPad portrait (820 px) the eight tabs scrolled sideways with the scrollbar hidden, so Cards and its "waiting" badge were off screen with no sign they existed. | overflow-menu, chip-collection-reflow, nav-state-active | Tabs wrap onto their own row below 1280 px, so every tab and badge is always visible; the active tab is underlined and has `aria-current="page"`. Header height is published as `--admin-nav-h` for the sticky cards toolbar and `scroll-padding-top`. | Fixed |
| C2 | Critical | Admin, all pages | Muted text `#8a7f75` on cream (about 3.6:1), tracked uppercase 11 px labels, and white at 75% on terracotta failed contrast: 1525 axe nodes. | color-contrast, color-accessible-pairs | Retheme to the public tokens: secondary text `#4a5450` (6.6:1 on tile), tertiary `#5d6662` (4.9:1 on tile, 5.9:1 on white), sentence-case labels at 12 px or more. | Fixed |
| C3 | Critical | Admin schedule | The booking drawer was a plain div: no dialog role, no Escape, focus stayed behind it, close was a text glyph. | escape-routes, modal-escape, keyboard-nav, focus-management | `role="dialog"`, `aria-modal`, labelled by the client's name; Escape closes; focus moves to Close and returns to the booking block; page scroll is held. | Fixed |
| C4 | Critical | Admin nav | The logo link had no accessible name below 1280 px (axe link-name on 30 page views). | aria-labels | "Owner" is always visible, with ", schedule" for screen readers. | Fixed |
| C5 | Critical | Public, all pages | Targets under 24 px: footer links (23 px), Owner login (20 px), booking summary Change buttons (30 x 22 in Chinese), home and services phone links (23 to 25 px). | touch-target-size, web-target-size | All at least 44 px tall (inline-flex with min-height), Change buttons 44 x 44. | Fixed |
| C6 | Critical | Admin row actions | Booking status buttons 28 px, filter pills 36 px, previous and next 36 px, card actions 36 px, message actions 40 px. | touch-target-size, touch-spacing | 44 px minimum on every admin button, filter and action, with 8 px gaps. | Fixed |
| H1 | High | Public | Price-board Book buttons drawn at 40 px (the whole row was already the hit area), language toggle 36 to 40 px, step bar 43 px, service category chips 40 px. | touch-target-size | All 44 px. The row-wide hit area on the board is kept. | Fixed |
| H2 | High | Booking, time step | The whole slot grid was one `aria-live` region, so screen readers read every time aloud after each date tap, and nothing said "loading" or how many times were found. | contextual-live-badge-updates, aria-live-errors | One `role="status"` line: "Finding open times", then "12 open times on Monday, October 5", or the no-times or closed message. New strings in en, zh, hk, ko. | Fixed |
| H3 | High | Booking summary | dt and dd were wrapped in extra divs, an invalid definition list (axe definition-list and dlitem, 304 nodes). | voiceover-sr | Each row holds only dt and dd; the Change button sits in its own dd. | Fixed |
| H4 | High | Booking flow | The flow used `replaceState`, so the browser's Back button left the booking entirely; "Any stylist" was not in the address, so a reload went back to the stylist step. | back-behavior, back-stack-integrity, deep-linking | Each step pushes its own address (`/book?service=`, `&staff=<id or any>`, `&step=details`); Back and Forward restore the step. The details address falls back to the time step when no time is chosen. Unit tests added. | Fixed |
| H5 | High | Booking flow | Going back to the time step (Back button or browser Back) threw away the chosen day and time and jumped to the first open day. | state-preservation | Returning keeps the chosen day, refreshes its times and keeps the chosen time if it is still open. | Fixed |
| H6 | High | Booking, Book buttons | Tapping Book on the board or header gave no feedback until the server-rendered booking page arrived. | loading-states, tap-feedback-speed | `app/(site)/book/loading.tsx`: title, step bar and board shapes appear at once, with a "Loading" status for screen readers. | Fixed |
| H7 | High | Admin new booking | One error line at the bottom of the form for any problem, not announced, far from the field. | error-placement, error-clarity, focus-management | Errors under the phone, name and time fields, linked with `aria-describedby`, fields marked invalid, focus goes to the first problem; the 409 "just taken" message sits at the time grid. | Fixed |
| H8 | High | Admin actions | No loading state on Approve, Skip, Undo, Save text, Mark done or Log out; status buttons showed "...". | loading-buttons, submit-feedback | The pressed button says what is happening ("Approving...", "Saving...", "Logging out..."), is disabled and has `aria-busy`. Errors use `role="alert"` and say how to recover. | Fixed |
| H9 | High | Admin look | Cream and terracotta palette, tracked uppercase eyebrows, pill buttons and the hair-strand art on the login page did not match the approved public direction. | consistency, color-semantic, style-match | Tile background, white surfaces, black primary buttons, Barlow, sentence-case labels, 6 px radii like the public site. Rod colours only for category (booking blocks in the schedule are tinted by service category). Status tints kept and always paired with text. Layout and features unchanged. | Fixed |
| H10 | High | Admin schedule | Short booking blocks showed status by colour only (pink for no-show, beige for completed); a block's name was only the client's name. | color-not-only, aria-labels | Status written on every non-confirmed block; dashed border for no-show and cancelled; each block is named "client, service, time to time, stylist, status". Stylist toggles have `aria-pressed`. | Fixed |
| H11 | High | Admin | Fields used `outline-none` with a 10% terracotta ring, so keyboard focus was nearly invisible. | focus-states, focus-appearance | One focus rule for public and admin: 2 px black outline with offset, plus a white gap on black fills. | Fixed |
| H12 | High | Admin calls | The call drawer put `role="dialog"` on an aside (axe aria-allowed-role), close was a 40 px text glyph. | aria-labels, touch-target-size | Dialog on a div, 44 px close button with an SVG icon and "Close call details". | Fixed |
| H13 | High | Admin login | No main landmark, the wrong-password message was not announced and did not say what to do, no way to check the typed password, a network failure left the button stuck. | aria-live-errors, error-recovery, password-toggle | `main` landmark, `role="alert"` message linked to the field ("Check it and try again"), Show and Hide button, network error message. | Fixed |
| H14 | High | Public mobile menu | Opening the full-screen menu left focus on the page behind it; closing did not return focus. | focus-management, focus-not-obscured | Focus moves to Close on open and back to Menu on close; the menu is a labelled modal dialog; Escape closes. | Fixed |
| M1 | Medium | Public | The phone Book bar sat outside any landmark (axe region); the price board had a second region with the same name as its section (axe landmark-unique). | voiceover-sr | Book bar is a labelled nav; the board's scroll area is a group labelled by the board title. | Fixed |
| M2 | Medium | Public forms | Placeholder text at 70% slate (about 3.9:1). | color-contrast | Full slate. | Fixed |
| M3 | Medium | Booking details | Invalid fields were marked only by the message under them; errors only appeared on submit and stayed after the field was fixed. | inline-validation, color-not-only, required-indicators | Red border on `aria-invalid` fields, `required` on name and phone (optional fields already say so), each field rechecked when the visitor leaves it. | Fixed |
| M4 | Medium | Booking step bar | On phones the active step label was cut off ("Your ..."). | truncation-strategy | The active step takes the free width; other steps show their number and have full accessible names ("Step 2 of 4: Stylist"). | Fixed |
| M5 | Medium | Booking, 409 | The "someone just booked that time" banner stayed up after a new time was picked. | error-recovery | It clears when a new time is chosen. | Fixed |
| M6 | Medium | Booking, date strip | With a mouse, the 35-day strip hid its scrollbar, so there was no sign it scrolled. | swipe-clarity | A thin scrollbar shows for fine pointers; touch keeps the clean strip. | Fixed |
| M7 | Medium | Contact form | A bad phone number was reported above the Send button, not at the field. | error-placement | Error under the phone field, linked and focused. | Fixed |
| M8 | Medium | Admin filters | Bookings, calls, client tags and card filters scrolled sideways with hidden scrollbars; the card filter was not in the address. | chip-collection-reflow, deep-linking, state-preservation | All wrap; current filter has `aria-current` or `aria-pressed`; cards use `?status=` so reload, Back and shared links keep it. Bookings and calls filters were already in the URL. | Fixed |
| M9 | Medium | Admin text | Labels and meta text at 9.6 to 11.5 px. | readable-font-size, font-scale | 12 px minimum, labels 14 px. | Fixed |
| M10 | Medium | Admin messages | Done messages were dimmed to 60% opacity (text fell below 4.5:1); urgency shown as a raw lowercase value. | color-contrast, color-not-only | Done messages get a tile background and a "Done" tag; urgency reads Urgent, Normal or Low. | Fixed |
| M11 | Medium | Admin empty states | "Nothing here yet", "No messages" and an empty calendar gave no next step. | empty-states | Each says what would appear and offers the action (for example "Add a booking"). | Fixed |
| M12 | Medium | Admin clients | The search box had a placeholder but no label. | input-labels | A label for screen readers, `type="search"`, `role="search"` form; tag filters have `aria-pressed`. | Fixed |
| M13 | Medium | Admin booking actions | "Cancel" sat next to "Completed" with the same weight; labels did not say what would happen. | destructive-emphasis, primary-action | "Mark completed" is the primary, "Cancel booking" is set apart (and still confirms); each button carries the client's name for screen readers. | Fixed |
| M14 | Medium | Admin icons | `‹`, `›` and `✕` typed as text for previous, next, back and close. | no-emoji-icons, icon-style-consistent | One small SVG set (chevron, close), hidden from screen readers, with named controls ("Previous day", "Close booking details"). | Fixed |
| M15 | Medium | All | Double-tap zoom delay on links and buttons. | tap-delay | `touch-action: manipulation` on interactive elements. | Fixed |
| M16 | Medium | Admin and public overlays | Tab could move out of an open drawer or menu to the page behind, and the page behind stayed clickable and readable. | focus-management, escape-routes, focus-not-obscured | Shared `useModal` hook (`src/lib/use-modal.ts`) on the admin booking drawer, the call drawer and the phone menu: everything outside the overlay gets `inert`, Tab and Shift+Tab wrap inside, Escape closes, focus returns to the trigger. The overlays render in place inside the page (the call drawer is driven by the URL), so `inert` was chosen over moving them into a native `<dialog>`. The card editor is an inline edit inside its card, not an overlay, so it needs none. Checked in the browser by the audit script and by unit tests. | Fixed |
| L1 | Low | Admin dense rows | Client table name, phone and consent links are 32 px; bookings phone links 40 px; 15-minute calendar blocks are drawn to scale (41 px). | touch-density, web-target-size | Kept for data density. All meet the WCAG 2.5.8 AA minimum of 24 px with spacing; every row action button is 44 px. | Kept |
| L2 | Low | Admin data lines | Middle-dot meta strings ("Online · Phone") remain in admin rows. | whitespace-balance | The plan removes them from the public site; in the admin they separate dense facts. | Kept |
| L3 | Low | Admin cards | The card proof sheet keeps cream card stock, navy ink and the Caveat hand. | consistency | It depicts the physical card the client receives, so it is content, not interface chrome. | Kept |
| L4 | Low | Admin status | Status chips keep emerald, amber, rose, sky and violet tints instead of rod colours. | color-not-decorative-only, color-semantic | Rod colours mean a service category on the public site; reusing them for status would blur that. Every tint is paired with its word and passes 4.5:1. | Kept |
| L5 | Low | All | No dark theme. | dark-mode-pairing | The approved direction is light only (`color-scheme: light`). | Kept |

## Checks that passed without changes

- Viewport meta allows zoom; `viewport-fit=cover` with safe-area padding on the phone Book bar (viewport-meta, safe-area-awareness).
- Barlow loads through `next/font` with `display: swap` and size-adjusted fallbacks; Chinese and Korean use system fonts, so no CJK webfont shift (font-loading). Layout shift measured at 0 on load.
- Language switch: the board crossfade is short and the measured shift is 0.0003; the `html lang` attribute follows the chosen language, including after an in-page switch.
- Reduced motion: the global rule stops the board crossfade, the step change and skeleton pulses; the step scroll uses `auto` instead of `smooth` (reduced-motion). Verified with Playwright's reduced-motion emulation.
- No horizontal scroll in any of the four languages at 360, 390, 768, 1024 or 1440 (horizontal-scroll); Korean uses `word-break: keep-all`.
- Rod colour bands are fills behind black text (9:1 or more) and markers beside the written category name, never text colour (color-contrast, color-not-only).
- Skip link, one h1 per page, sequential headings, visible labels on the booking and contact forms, `autocomplete` and semantic input types, phone hint text (skip-links, heading-hierarchy, input-labels, autofill-support, input-type-keyboard, input-helper-text).
- Booking error texts already said how to fix the problem in all four languages ("Enter a mobile number we can text, like (604) 555-0123"), and focus already moved to the first invalid field (error-clarity, focus-management).
- SMS opt-in is unchecked, optional, a 44 px label target, with its fine print linked by `aria-describedby`.
- No testimonials, ratings or invented figures anywhere; "Henderson Place" is untranslated in all four languages; no em dashes in the website source (now guarded by a test).

## Pre-delivery checklist (references/pro-rules.md)

- [x] Only searches relevant to the interface, one intent each (listed above).
- [x] quick-reference.md sections 1 to 3 reviewed as a final pass.
- [x] Tested at 360 and 390 px; landscape covered by the 768 and 1024 widths.
- [x] Reduced motion verified; larger text: layouts use rem and wrap, no fixed-height text boxes on the public pages.
- [ ] Dark mode: not applicable (light-only direction, L5).
- [x] Touch targets 44 px on public pages and admin controls; documented exceptions in L1; nothing under the phone home indicator.
- [x] No emoji or text glyphs as icons; one SVG style.
- [x] Pressed and hover states change colour or underline only, no layout shift.
- [x] Semantic tokens: the admin now uses the public tokens; raw hex left only in the card proof sheet (L3).
- [x] Disabled states are visibly different, non-interactive and carry `disabled` or `aria-busy`.
- [x] Screen reader order follows the visual order; controls have descriptive names, including per-row actions.
- [x] Colour is never the only indicator (statuses, invalid fields, calendar blocks).
- [x] Overlays keep focus inside, make the page behind inert, close on Escape and return focus.
- [x] Sticky admin header offsets focus (`scroll-padding-top`); the phone Book bar has a matching spacer.
- [x] No drag-only interactions.
- [x] Login allows password managers and paste, with Show and Hide.
- [x] No auto-rotating content.
- [x] Failed forms keep inline errors next to their fields and move focus to the first one.

## Verification

- `npm run build`, `npm run lint`, `npx tsc --noEmit`: pass.
- `npx vitest run`: 9 files, 136 tests pass. New: `tests/ux-a11y.test.ts` (14 tests: inert applied outside an overlay and undone exactly, Tab and Shift+Tab wrapping, one status line for slot updates in all four languages, named 44 px step buttons, valid summary list with 44 px Change buttons, contact form labels in all languages, admin nav wraps and spells out badges, login label and show/hide, new strings in all languages, no em dashes in the source) and 3 new cases in `tests/booking-params.test.ts` (step addresses, Any stylist, details fallback).
- Screenshots, before and after: `docs/screenshots/website/7x-*-before.png` and `7x-*-after.png` for home at 390 in hk, booking time step at 1440 and 390 (keyboard focus on a time), details step with errors at 390 (en) and 1440 (ko), slot taken at 1440, admin schedule, calls, call drawer, cards, cards batch and new booking with errors at 1440, and admin schedule and cards at iPad portrait.
