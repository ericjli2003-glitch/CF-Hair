// Screenshots of the promotional SMS features (3x- prefix) into ../docs/screenshots/website.
// Usage: npm run db:reset && npm run build && npm start, then
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... node scripts/screenshots-sms.mjs
// Uses the Chromium in PLAYWRIGHT_BROWSERS_PATH (or CHROMIUM_PATH if set).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(process.env.OUT_DIR ?? "../docs/screenshots/website");
const PASSWORD = process.env.ADMIN_PASSWORD ?? "cfhair-demo";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function shot(page, name, full = true) {
  await page.evaluate(async () => {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("saved", name);
}

async function ctx(viewport, lang = "en") {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "en-CA", timezoneId: "America/Vancouver" });
  await c.addCookies([{ name: "lang", value: lang, url: BASE }]);
  await c.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "html{scroll-behavior:auto!important}";
      document.head.appendChild(s);
    });
  });
  return c;
}

const admin = { width: 1280, height: 860 };

// Booking form opt-in checkbox, English (unchecked by default) and Chinese (ticked).
for (const [lang, name, tick] of [["en", "3x-book-sms-optin-en", false], ["zh", "3x-book-sms-optin-zh", true]]) {
  const c = await ctx({ width: 1440, height: 900 }, lang);
  const p = await c.newPage();
  await p.goto(BASE + "/book?service=womens-cut", { waitUntil: "networkidle" });
  await p.locator("section button").filter({ hasText: /No preference|不指定/ }).first().click();
  await p.locator("section button.tabular-nums").first().waitFor();
  await p.waitForTimeout(800);
  await p.locator("section button.tabular-nums").nth(2).click();
  await p.locator("button").filter({ hasText: /^(Continue|继续)/ }).first().click();
  await p.fill("#b-name", lang === "zh" ? "陈美玲" : "Jessica Tam");
  await p.fill("#b-phone", "6045550168");
  await p.fill("#b-email", "jessica.tam@example.com");
  if (tick) await p.check("#b-sms");
  await p.locator("#b-sms").scrollIntoViewIfNeeded();
  await shot(p, name);
  await c.close();
}

// Admin
const c = await ctx(admin);
const p = await c.newPage();
await p.goto(BASE + "/admin/login", { waitUntil: "networkidle" });
await p.fill("#pw", PASSWORD);
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL(BASE + "/admin");

await p.goto(BASE + "/admin/promotions", { waitUntil: "networkidle" });
await shot(p, "3x-promotions-list");

await p.getByRole("link", { name: /Autumn colour week/ }).first().click();
await p.waitForURL(/\/admin\/promotions\/[^/]+$/);
await p.waitForLoadState("networkidle");
await shot(p, "3x-promo-results");

await p.goto(BASE + "/admin/promotions/new", { waitUntil: "networkidle" });
await p.fill("#c-name", "Perm week");
await p.locator("textarea").first().fill("Perm week: 15% off digital and down perms, Mon to Thu until Oct 30. Book online or call us.");
await p.getByRole("tab", { name: "简体中文" }).click();
await p.locator("textarea").first().fill("烫发周：10月30日前周一至周四，数码烫和压毛烫85折。欢迎网上预约或来电。");
await p.getByRole("tab", { name: "한국어" }).click();
await p.locator("textarea").first().fill("펌 위크: 10월 30일까지 월요일부터 목요일 디지털펌, 다운펌 15% 할인. 온라인 예약 또는 전화 주세요.");
await p.getByRole("tab", { name: "English" }).click();
await p.locator("label").filter({ hasText: "Include implied consent" }).click();
await p.waitForTimeout(1200);
await p.getByRole("button", { name: "Preview Mandarin" }).click();
await p.waitForTimeout(600);
await shot(p, "3x-promo-composer");
await p.getByRole("button", { name: "Preview English" }).click();
await p.waitForTimeout(400);
await shot(p, "3x-promo-composer-en", false);

await p.goto(BASE + "/admin/customers", { waitUntil: "networkidle" });
await shot(p, "3x-clients-consent-column", false);
await p.getByRole("link", { name: "Paolo Reyes" }).first().click();
await p.waitForURL(/\/admin\/customers\/.+/);
await p.waitForLoadState("networkidle");
await shot(p, "3x-client-consent");
await p.getByRole("button", { name: "Record a yes" }).click();
await p.waitForTimeout(300);
await shot(p, "3x-client-consent-record", false);

await p.goto(BASE + "/admin/customers", { waitUntil: "networkidle" });
await p.getByRole("link", { name: "Raymond Fung" }).first().click();
await p.waitForURL(/\/admin\/customers\/.+/);
await p.waitForLoadState("networkidle");
await shot(p, "3x-client-consent-implied");

await c.close();
await browser.close();
