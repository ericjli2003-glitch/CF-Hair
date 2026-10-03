// Captures full-page screenshots of the public site and admin.
// Usage: start the app (npm run build && npm start), then
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... node scripts/screenshots.mjs
// Uses the Chromium in PLAYWRIGHT_BROWSERS_PATH (or CHROMIUM_PATH if set).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(process.env.OUT_DIR ?? "../docs/screenshots/website");
const PASSWORD = process.env.ADMIN_PASSWORD ?? "cfhair-demo";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function settle(page) {
  // Trigger scroll reveals and wait for fonts and line-drawing animations.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    await document.fonts.ready;
  });
  await page.waitForTimeout(1400);
}

async function shot(page, name, full = true) {
  await settle(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("saved", name);
}

async function ctx(viewport, lang = "en", mobile = false) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: "en-CA" });
  await c.addCookies([{ name: "lang", value: lang, url: BASE }]);
  // Smooth scrolling makes Playwright's scroll-then-click flaky.
  await c.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "html{scroll-behavior:auto!important}";
      document.head.appendChild(s);
    });
  });
  return c;
}

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const ipad = { width: 1180, height: 820 };

// Public pages, desktop
{
  const c = await ctx(desktop);
  const p = await c.newPage();
  for (const [path, name] of [["/", "01-home-desktop"], ["/services", "03-services-desktop"], ["/team", "04-team-desktop"], ["/contact", "05-contact-desktop"]]) {
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    await p.waitForTimeout(2800);
    await shot(p, name);
  }
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${OUT}/00-home-hero-desktop.png` });
  console.log("saved 00-home-hero-desktop");

  // Booking flow
  await p.goto(BASE + "/book", { waitUntil: "networkidle" });
  await shot(p, "10-book-1-service");
  await p.getByRole("button", { name: /Women's Haircut/ }).click();
  await shot(p, "11-book-2-stylist");
  await p.getByRole("button", { name: /No preference/ }).click();
  await p.locator("section button.tabular-nums").first().waitFor();
  await p.waitForTimeout(1200);
  await p.locator("section button.tabular-nums").nth(2).click();
  await shot(p, "12-book-3-time");
  await p.getByRole("button", { name: /^Continue/ }).click();
  await p.fill("#b-name", "Jessica Tam");
  await p.fill("#b-phone", "6045550168");
  await p.fill("#b-email", "jessica.tam@example.com");
  await p.fill("#b-notes", "First visit. Shoulder length, would like soft layers.");
  await shot(p, "13-book-4-details");
  await p.getByRole("button", { name: /Confirm booking/ }).click();
  await p.waitForURL(/\/book\/confirmed\//);
  await shot(p, "14-book-5-confirmed");
  await c.close();
}

// Mobile
{
  const c = await ctx(mobile, "en", true);
  const p = await c.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);
  await shot(p, "02-home-mobile");
  await p.goto(BASE + "/services", { waitUntil: "networkidle" });
  await shot(p, "03b-services-mobile");
  await p.goto(BASE + "/book?service=mens-cut", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /No preference/ }).click();
  await p.locator("section button.tabular-nums").first().waitFor();
  await p.waitForTimeout(1200);
  await p.locator("section button.tabular-nums").nth(1).click();
  await shot(p, "15-book-time-mobile");
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Menu" }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/02b-mobile-menu.png` });
  await c.close();
}

// Chinese and Korean
for (const lang of ["zh", "ko"]) {
  const c = await ctx(desktop, lang);
  const p = await c.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(2800);
  await shot(p, `06-home-${lang}`);
  await c.close();
}
{
  const c = await ctx(mobile, "zh", true);
  const p = await c.newPage();
  await p.goto(BASE + "/services", { waitUntil: "networkidle" });
  await shot(p, "06b-services-zh-mobile");
  await c.close();
}

// Admin (iPad landscape)
{
  const c = await ctx(ipad);
  const p = await c.newPage();
  await p.goto(BASE + "/admin/login", { waitUntil: "networkidle" });
  await shot(p, "20-admin-login", false);
  await p.fill("#pw", PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(BASE + "/admin");
  await shot(p, "21-admin-schedule-day");
  await p.locator("button:has(span.truncate)").first().click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/22-admin-booking-drawer.png` });
  await p.goto(BASE + "/admin?view=week", { waitUntil: "networkidle" });
  await shot(p, "23-admin-schedule-week");
  await p.goto(BASE + "/admin/bookings", { waitUntil: "networkidle" });
  await shot(p, "24-admin-bookings");
  await p.goto(BASE + "/admin/new", { waitUntil: "networkidle" });
  await p.fill("#n-phone", "604 555 0100");
  await p.waitForTimeout(800);
  await shot(p, "25-admin-new-booking");
  await p.goto(BASE + "/admin/messages", { waitUntil: "networkidle" });
  await shot(p, "26-admin-messages");
  await p.goto(BASE + "/admin/customers", { waitUntil: "networkidle" });
  await shot(p, "27-admin-clients");
  await c.close();
}
{
  const c = await ctx({ width: 820, height: 1180 });
  const p = await c.newPage();
  await p.goto(BASE + "/admin/login", { waitUntil: "networkidle" });
  await p.fill("#pw", PASSWORD);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(BASE + "/admin");
  await shot(p, "28-admin-schedule-ipad-portrait");
  await c.close();
}

await browser.close();
