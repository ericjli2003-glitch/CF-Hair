// Screenshots of the redesigned public site (the 5x- set), plus one admin page.
// Usage: start the app (npm run build && npm start), then
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... node scripts/screenshots-redesign.mjs
// Uses the Chromium in PLAYWRIGHT_BROWSERS_PATH (or CHROMIUM_PATH if set).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(process.env.OUT_DIR ?? "../docs/screenshots/website");
const PASSWORD = process.env.ADMIN_PASSWORD ?? "cfhair-demo";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };
const small = { width: 360, height: 740 };

async function ctx(viewport, lang = "en", mobile = false) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: "en-CA" });
  await c.addCookies([{ name: "lang", value: lang, url: BASE }]);
  return c;
}

async function shot(page, name, full = true) {
  // The phone "Book a time" bar is fixed to the screen; in a full-page capture it
  // would float mid-page, so it only appears in the screen-sized captures.
  await page.evaluate((full) => {
    document.querySelectorAll("[data-bookbar]").forEach((el) => (el.style.visibility = full ? "hidden" : ""));
    if (full) window.scrollTo(0, 0);
    return document.fonts.ready;
  }, full);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("saved", name);
}

const want = (name) => !ONLY || ONLY.test(name);

// Home in four languages, desktop
for (const lang of ["en", "zh", "hk", "ko"]) {
  if (!want(`home-${lang}-1440`)) continue;
  const c = await ctx(desktop, lang);
  const p = await c.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(p, `5x-home-${lang}-1440`);
  if (lang === "en") await shot(p, "5x-home-en-1440-fold", false);
  await c.close();
}

// Home on phones
for (const [lang, vp, name] of [
  ["en", phone, "5x-home-en-mobile-390"],
  ["hk", phone, "5x-home-hk-mobile-390"],
  ["en", small, "5x-home-en-360"],
]) {
  if (!want(name)) continue;
  const c = await ctx(vp, lang, true);
  const p = await c.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(p, `${name}-fold`, false);
  await shot(p, name);
  await c.close();
}

// Services, team and visit, desktop
if (want("pages")) {
  const c = await ctx(desktop);
  const p = await c.newPage();
  for (const [path, name] of [["/services", "5x-services-en-1440"], ["/team", "5x-team-en-1440"], ["/contact", "5x-contact-en-1440"]]) {
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    await shot(p, name);
  }
  await c.close();
}

const pickTime = async (p, n) => {
  const times = p.locator("main section button.nums[aria-pressed]");
  await times.first().waitFor();
  await times.nth(n).click();
};

// Booking flow, English, desktop
if (want("book")) {
  const c = await ctx(desktop);
  const p = await c.newPage();
  await p.goto(BASE + "/book", { waitUntil: "networkidle" });
  await shot(p, "5x-book-1-service-en");

  // A Book link on the price board skips step 1, and Back returns to it.
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.getByRole("link", { name: /^Book Women's haircut$/ }).click();
  await p.waitForURL(/\/book\?service=womens-cut$/);
  await p.getByRole("heading", { name: /Choose a stylist/ }).waitFor();
  await shot(p, "5x-book-2-stylist-en");
  await p.getByRole("button", { name: "Back", exact: true }).click();
  await p.getByRole("heading", { name: /Choose a service/ }).waitFor();
  if (!p.url().endsWith("/book")) throw new Error(`Back should reset the URL, got ${p.url()}`);
  await p.getByRole("button", { name: /Women's haircut/ }).click();

  await p.getByRole("button", { name: /Any stylist/ }).click();
  await pickTime(p, 2);
  await shot(p, "5x-book-3-time-en");
  await p.getByRole("button", { name: /^Continue$/ }).click();
  await p.fill("#b-name", "Jessica Tam");
  await p.fill("#b-phone", "6045550168");
  await p.fill("#b-email", "jessica.tam@example.com");
  await p.fill("#b-notes", "First visit. Shoulder length, would like soft layers.");
  await shot(p, "5x-book-4-details-en");
  await p.getByRole("button", { name: /^Book this time$/ }).click();
  await p.waitForURL(/\/book\/confirmed\//);
  await shot(p, "5x-book-5-confirmed-en");
  await c.close();
}

// Details step with the text opt-in, Korean
if (want("book-ko")) {
  const c = await ctx(desktop, "ko");
  const p = await c.newPage();
  await p.goto(BASE + "/book?service=down-perm", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /상관없음/ }).click();
  await pickTime(p, 4);
  await p.getByRole("button", { name: /^다음$/ }).click();
  await p.fill("#b-name", "김지은");
  await p.fill("#b-phone", "7785550142");
  await p.check("#b-sms");
  await shot(p, "5x-book-4-details-ko-optin");
  await c.close();
}

// Booking time step on a phone
if (want("book-mobile")) {
  const c = await ctx(phone, "en", true);
  const p = await c.newPage();
  await p.goto(BASE + "/book?service=mens-cut&staff=stylist-b", { waitUntil: "networkidle" });
  await pickTime(p, 1);
  await shot(p, "5x-book-3-time-en-mobile-390");
  await c.close();
}

// One admin page, to confirm it still looks right with the new type
if (want("admin")) {
  const c = await ctx({ width: 1280, height: 860 });
  const p = await c.newPage();
  await p.goto(BASE + "/admin/login", { waitUntil: "networkidle" });
  await p.fill("input[type=password]", PASSWORD);
  await p.getByRole("button", { name: /log in|sign in/i }).click();
  await p.waitForURL((u) => !u.pathname.includes("login"));
  await p.waitForLoadState("networkidle");
  await shot(p, "5x-admin-schedule", false);
  await c.close();
}

await browser.close();
