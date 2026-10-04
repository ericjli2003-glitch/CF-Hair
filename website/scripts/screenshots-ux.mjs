// Screenshots for the UX and accessibility pass (the 7x- set), taken before and
// after the fixes with the same script.
// Usage: start the app against a throwaway copy of the database, then
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... SUFFIX=after node scripts/screenshots-ux.mjs
// Uses the Chromium in PLAYWRIGHT_BROWSERS_PATH (or CHROMIUM_PATH if set).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(process.env.OUT_DIR ?? "../docs/screenshots/website");
const PASSWORD = process.env.ADMIN_PASSWORD ?? "cfhair-demo";
const SUFFIX = process.env.SUFFIX ?? "after";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
mkdirSync(OUT, { recursive: true });
const want = (name) => !ONLY || ONLY.test(name);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function site(width, height, lang = "en") {
  const mobile = width < 768;
  const c = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: "en-CA",
    timezoneId: "America/Vancouver",
  });
  await c.addCookies([{ name: "lang", value: lang, url: BASE }]);
  return { c, p: await c.newPage() };
}

async function admin(width, height) {
  const c = await browser.newContext({ viewport: { width, height }, locale: "en-CA", timezoneId: "America/Vancouver" });
  const p = await c.newPage();
  await p.goto(BASE + "/admin/login", { waitUntil: "networkidle" });
  await p.fill("input[type=password]", PASSWORD);
  await p.getByRole("button", { name: /sign in/i }).click();
  await p.waitForURL((u) => !u.pathname.includes("login"));
  return { c, p };
}

async function shot(p, name, opts = {}) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${OUT}/7x-${name}-${SUFFIX}.png`, ...opts });
  console.log("saved", `7x-${name}-${SUFFIX}`);
}

const CONTINUE = /^(continue|繼續|继续|다음)$/i;
async function toTimeStep(p) {
  await p.goto(`${BASE}/book?service=mens-cut&staff=stylist-a`, { waitUntil: "networkidle" });
  await p.locator("section button.nums").first().waitFor({ timeout: 15000 });
}

if (want("home-hk-390")) {
  const { c, p } = await site(390, 844, "hk");
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(p, "home-hk-390");
  await c.close();
}

if (want("book-time")) {
  for (const [w, h, name] of [
    [1440, 1000, "book-time-1440"],
    [390, 844, "book-time-390"],
  ]) {
    const { c, p } = await site(w, h);
    await toTimeStep(p);
    await p.locator("section button.nums").nth(2).click();
    // Keyboard focus on the next time, to show the focus ring.
    await p.keyboard.press("Tab");
    await shot(p, name);
    await c.close();
  }
}

if (want("book-details-error")) {
  for (const [w, h, name, lang] of [
    [390, 844, "book-details-error-390", "en"],
    [1440, 1000, "book-details-error-ko-1440", "ko"],
  ]) {
    const { c, p } = await site(w, h, lang);
    await toTimeStep(p);
    await p.locator("section button.nums").first().click();
    await p.getByRole("button", { name: CONTINUE }).click();
    await p.fill("#b-phone", "604 555");
    await p.locator("form button[type=submit]").click();
    await p.waitForTimeout(300);
    await p.evaluate(() => document.activeElement?.scrollIntoView({ block: "center" }));
    await shot(p, name);
    await c.close();
  }
}

if (want("book-slot-taken")) {
  const { c, p } = await site(1440, 1000);
  await toTimeStep(p);
  await p.locator("section button.nums").first().click();
  await p.getByRole("button", { name: CONTINUE }).click();
  await p.route("**/api/bookings", (r) => r.fulfill({ status: 409, contentType: "application/json", body: '{"error":"SLOT_TAKEN"}' }));
  await p.fill("#b-name", "Mina Park");
  await p.fill("#b-phone", "604 555 0142");
  await p.locator("form button[type=submit]").click();
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, "book-slot-taken-1440");
  await c.close();
}

if (want("admin-schedule")) {
  const { c, p } = await admin(1440, 1000);
  await p.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await shot(p, "admin-schedule-1440");
  await c.close();
}

if (want("admin-calls")) {
  const { c, p } = await admin(1440, 1000);
  await p.goto(BASE + "/admin/calls", { waitUntil: "networkidle" });
  await shot(p, "admin-calls-1440");
  const first = p.locator("a[href*='call=']").first();
  if (await first.count()) {
    await first.click();
    await p.waitForTimeout(800);
    await shot(p, "admin-call-drawer-1440");
  }
  await c.close();
}

if (want("admin-cards")) {
  const { c, p } = await admin(1440, 1100);
  await p.goto(BASE + "/admin/cards", { waitUntil: "networkidle" });
  await shot(p, "admin-cards-1440");
  const batch = p.locator("a[href^='/admin/cards/']").first();
  if (await batch.count()) {
    await batch.click();
    await p.waitForURL(/\/admin\/cards\/./);
    await p.waitForLoadState("networkidle");
    await shot(p, "admin-cards-batch-1440");
  }
  await c.close();
}

if (want("admin-ipad")) {
  const { c, p } = await admin(820, 1180);
  for (const [path, name] of [
    ["/admin", "admin-schedule-ipad-portrait"],
    ["/admin/cards", "admin-cards-ipad-portrait"],
  ]) {
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    await shot(p, name);
  }
  await c.close();
}

if (want("admin-new-error")) {
  const { c, p } = await admin(1440, 1000);
  await p.goto(BASE + "/admin/new", { waitUntil: "networkidle" });
  await p.fill("#n-phone", "604 555");
  await p.getByRole("button", { name: /create booking/i }).click();
  await p.waitForTimeout(300);
  await shot(p, "admin-new-booking-error-1440");
  await c.close();
}

await browser.close();
