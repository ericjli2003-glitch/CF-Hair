// Screenshots of the admin Calls and Cards tabs (the 6x- set).
// Usage: start the app on a freshly seeded database (npm run db:reset, npm run build, npm start), then
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... AGENT_API_KEY=... node scripts/screenshots-calls-cards.mjs
// Uses the Chromium in PLAYWRIGHT_BROWSERS_PATH (or CHROMIUM_PATH if set). It changes the
// monthly card limit for the cap warning and puts it back afterwards.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(process.env.OUT_DIR ?? "../docs/screenshots/website");
const PASSWORD = process.env.ADMIN_PASSWORD ?? "cfhair-demo";
const KEY = process.env.AGENT_API_KEY ?? "dev-agent-key";
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
mkdirSync(OUT, { recursive: true });
const want = (name) => !ONLY || ONLY.test(name);

const api = async (path, init = {}) => {
  const r = await fetch(BASE + path, { ...init, headers: { "x-api-key": KEY, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function admin(viewport) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "en-CA", timezoneId: "America/Vancouver" });
  const p = await c.newPage();
  await p.goto(BASE + "/admin/login", { waitUntil: "networkidle" });
  await p.fill("input[type=password]", PASSWORD);
  await p.getByRole("button", { name: /log in|sign in/i }).click();
  await p.waitForURL((u) => !u.pathname.includes("login"));
  return { c, p };
}

async function shot(p, name, opts = {}) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log("saved", name);
}

const { calls } = await api("/api/calls?limit=100");
const { batches, month } = await api("/api/cards/batches");
const pending = batches.find((b) => b.counts.pending > 0) ?? batches[0];
const desktop = { width: 1440, height: 1000 };

if (want("calls-list")) {
  const { c, p } = await admin(desktop);
  await p.goto(BASE + "/admin/calls", { waitUntil: "networkidle" });
  await shot(p, "6x-calls-list", { fullPage: true });
  await c.close();
}

if (want("call-detail")) {
  const call = calls.find((x) => x.language === "zh-HK" && x.outcome === "message") ?? calls.find((x) => x.language === "ko-KR");
  const { c, p } = await admin(desktop);
  await p.goto(`${BASE}/admin/calls?call=${call.id}`, { waitUntil: "networkidle" });
  await shot(p, "6x-call-detail-cantonese");
  const ko = calls.find((x) => x.language === "ko-KR" && x.outcome === "booked");
  if (ko) {
    await p.goto(`${BASE}/admin/calls?call=${ko.id}`, { waitUntil: "networkidle" });
    await shot(p, "6x-call-detail-korean");
  }
  await c.close();
}

if (want("cards-list")) {
  const { c, p } = await admin(desktop);
  await p.goto(BASE + "/admin/cards", { waitUntil: "networkidle" });
  await shot(p, "6x-cards-batches", { fullPage: true });
  await c.close();
}

if (want("cards-grid") && pending) {
  const { c, p } = await admin({ width: 1440, height: 1240 });
  await p.goto(`${BASE}/admin/cards/${pending.id}`, { waitUntil: "networkidle" });
  await shot(p, "6x-cards-batch-grid");
  const sent = batches.find((b) => b.counts.sent > 0);
  if (sent) {
    await p.goto(`${BASE}/admin/cards/${sent.id}`, { waitUntil: "networkidle" });
    await shot(p, "6x-cards-sent-failed", { fullPage: true });
  }
  await c.close();
}

if (want("card-edit") && pending) {
  const { c, p } = await admin({ width: 1440, height: 1240 });
  await p.goto(`${BASE}/admin/cards/${pending.id}`, { waitUntil: "networkidle" });
  const card = p.locator("ul > li").filter({ hasText: "Seo-yeon" }).first();
  await card.getByRole("button", { name: "Edit" }).click();
  const box = card.locator("textarea").first();
  const text = await box.inputValue();
  // A long dash typed by habit: the editor flags it live and the count updates.
  const dash = String.fromCharCode(0x2014);
  await box.fill(text.replace("\nWarmly,", ` Ask about our new gloss ${dash} it would suit you!\nWarmly,`));
  await p.evaluate((y) => window.scrollTo(0, y), await card.evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 170));
  await shot(p, "6x-card-editing");
  await c.close();
}

if (want("cap") && pending) {
  // Leave room for two more cards this month, then put the limit back.
  const original = (await api("/api/cards/settings")).monthlyCap;
  await api("/api/cards/settings", { method: "PUT", body: JSON.stringify({ monthlyCap: month.used + 2 }) });
  try {
    const { c, p } = await admin({ width: 1440, height: 900 });
    await p.goto(`${BASE}/admin/cards/${pending.id}`, { waitUntil: "networkidle" });
    await shot(p, "6x-cards-cap-warning");
    await c.close();
  } finally {
    await api("/api/cards/settings", { method: "PUT", body: JSON.stringify({ monthlyCap: original }) });
  }
}

if (want("nav")) {
  const { c, p } = await admin({ width: 1280, height: 600 });
  await p.goto(BASE + "/admin/cards", { waitUntil: "networkidle" });
  await shot(p, "6x-admin-nav", { clip: { x: 0, y: 0, width: 1280, height: 64 } });
  await c.close();
}

if (want("ipad")) {
  const { c, p } = await admin({ width: 820, height: 1180 });
  await p.goto(BASE + "/admin/calls", { waitUntil: "networkidle" });
  await shot(p, "6x-calls-ipad-portrait");
  await c.close();
}

if (want("client")) {
  const kevin = calls.find((x) => x.customer?.name === "Kevin Wong");
  if (kevin) {
    const { c, p } = await admin({ width: 1440, height: 1000 });
    await p.goto(`${BASE}/admin/customers/${kevin.customer.id}`, { waitUntil: "networkidle" });
    await shot(p, "6x-client-recent-calls", { fullPage: true });
    await c.close();
  }
}

await browser.close();
