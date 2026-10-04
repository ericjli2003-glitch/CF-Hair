// UX and accessibility audit of the running site: axe-core (WCAG 2.2 A/AA plus
// best practice), horizontal overflow, small pointer targets and layout shift,
// across the public pages in four languages and five widths, the booking flow
// states, the confirmation page and the owner admin.
//
// Usage: start the app against a throwaway copy of the database (the flow makes a
// booking), then
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... OUT=audit.json node scripts/audit-ux.mjs
// Uses the Chromium in PLAYWRIGHT_BROWSERS_PATH (or CHROMIUM_PATH if set).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "cfhair-demo";
const OUT = process.env.OUT ?? "audit.json";
const LANGS = ["en", "zh", "hk", "ko"];
const WIDTHS = [360, 390, 768, 1024, 1440];
const AXE_WIDTHS = new Set([390, 1440]);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];

async function context(width, lang = "en") {
  const mobile = width < 768;
  const c = await browser.newContext({
    viewport: { width, height: mobile ? 800 : 900 },
    isMobile: mobile,
    hasTouch: mobile,
    locale: "en-CA",
    timezoneId: "America/Vancouver",
  });
  await c.addCookies([{ name: "lang", value: lang, url: BASE }]);
  return c;
}

/** Overflow, small targets and the html lang, measured in the page. */
async function measure(p) {
  return p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex='-1'])";
    const small = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.closest("[aria-hidden=true]") || el.closest(".hidden")) continue;
      // A checkbox inside a label counts as the label's size.
      const box = el.matches("input[type=checkbox],input[type=radio]") && el.closest("label") ? el.closest("label").getBoundingClientRect() : r;
      // Rows whose link stretches over the whole row with ::after inset-0.
      const after = getComputedStyle(el, "::after");
      const stretched = after.position === "absolute" && after.content !== "none";
      const inline = cs.display === "inline" && el.closest("p, li, dd") && el.tagName === "A";
      if ((box.width < 44 || box.height < 44) && !stretched) {
        small.push({
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 40),
          w: Math.round(box.width),
          h: Math.round(box.height),
          inline: !!inline,
          below24: box.width < 24 || box.height < 24,
        });
      }
    }
    return { overflow, small, htmlLang: document.documentElement.lang };
  });
}

async function axe(p) {
  await p.addScriptTag({ content: AXE });
  return p.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
    }));
  });
}

async function check(p, name, meta, withAxe) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  const m = await measure(p);
  const v = withAxe ? await axe(p) : null;
  results.push({ name, ...meta, ...m, axe: v });
  const flag = [m.overflow > 0 ? `OVERFLOW ${m.overflow}px` : "", m.small.filter((s) => !s.inline).length ? `small:${m.small.filter((s) => !s.inline).length}` : "", v ? `axe:${v.length}` : ""]
    .filter(Boolean)
    .join(" ");
  console.log(`${name} ${meta.lang ?? ""} ${meta.width} ${flag}`);
}

// Public pages
const PAGES = ["/", "/services", "/team", "/contact", "/book", "/book?service=mens-cut"];
for (const lang of LANGS) {
  for (const width of WIDTHS) {
    const c = await context(width, lang);
    const p = await c.newPage();
    for (const path of PAGES) {
      await p.goto(BASE + path, { waitUntil: "networkidle" });
      await check(p, path, { lang, width }, AXE_WIDTHS.has(width));
    }
    await c.close();
  }
}

// Booking flow states: time step, details step, inline errors, slot taken (409).
let bookingId = null;
for (const lang of LANGS) {
  for (const width of [360, 390, 1440]) {
    const c = await context(width, lang);
    const p = await c.newPage();
    await p.goto(`${BASE}/book?service=mens-cut&staff=stylist-a`, { waitUntil: "networkidle" });
    await p.locator("button[aria-pressed]").filter({ hasText: /\d/ }).last().waitFor({ timeout: 15000 }).catch(() => {});
    await check(p, "book:time", { lang, width }, width !== 360);
    // First open time.
    const slot = p.locator("section button.nums, section [data-slot]").first();
    await slot.click();
    await p.getByRole("button", { name: /^(continue|繼續|继续|다음)$/i }).click();
    await p.waitForTimeout(300);
    await check(p, "book:details", { lang, width }, width !== 360);
    await p.locator("form button[type=submit]").click();
    await p.waitForTimeout(200);
    await check(p, "book:details-errors", { lang, width }, width !== 360);
    if (width === 1440) {
      await p.route("**/api/bookings", (r) => r.fulfill({ status: 409, contentType: "application/json", body: '{"error":"SLOT_TAKEN"}' }));
      await p.fill("#b-name", "Audit Test");
      await p.fill("#b-phone", "6045550199");
      await p.locator("form button[type=submit]").click();
      await p.waitForTimeout(800);
      await check(p, "book:slot-taken", { lang, width }, true);
      await p.unroute("**/api/bookings");
      if (!bookingId && lang === "en") {
        const slot2 = p.locator("section button.nums, section [data-slot]").first();
        await slot2.click();
        await p.getByRole("button", { name: /continue/i }).click();
        await p.fill("#b-name", "Audit Test");
        await p.fill("#b-phone", "6045550199");
        await p.locator("form button[type=submit]").click();
        await p.waitForURL(/confirmed/, { timeout: 15000 }).catch(() => {});
        const m = p.url().match(/confirmed\/([^/?#]+)/);
        bookingId = m?.[1] ?? null;
      }
    }
    await c.close();
  }
}
if (bookingId) {
  for (const lang of LANGS) {
    for (const width of [360, 1440]) {
      const c = await context(width, lang);
      const p = await c.newPage();
      await p.goto(`${BASE}/book/confirmed/${bookingId}`, { waitUntil: "networkidle" });
      await check(p, "book:confirmed", { lang, width }, true);
      await c.close();
    }
  }
}

// Layout shift: on load, and when switching language.
for (const width of [390, 1440]) {
  const c = await context(width, "en");
  await c.addInitScript(() => {
    window.__shift = 0;
    window.__shiftAll = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        window.__shiftAll += e.value;
        if (!e.hadRecentInput) window.__shift += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const p = await c.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  const load = await p.evaluate(() => window.__shift);
  await p.evaluate(() => (window.__shiftAll = 0));
  await p.locator("[role=group] button[lang=zh-Hant-HK]:visible").first().click();
  await p.waitForTimeout(1500);
  const sw = await p.evaluate(() => window.__shiftAll);
  results.push({ name: "cls", width, load, langSwitch: sw });
  console.log(`cls ${width} load=${load.toFixed(4)} langSwitch(all shifts)=${sw.toFixed(4)}`);
  await c.close();
}

// Owner admin
async function admin(width) {
  const c = await browser.newContext({ viewport: { width, height: width < 900 ? 1180 : 900 }, locale: "en-CA", timezoneId: "America/Vancouver" });
  const p = await c.newPage();
  await p.goto(BASE + "/admin/login", { waitUntil: "networkidle" });
  await check(p, "/admin/login", { width }, true);
  await p.fill("input[type=password]", PASSWORD);
  await p.getByRole("button", { name: /sign in/i }).click();
  await p.waitForURL((u) => !u.pathname.includes("login"));
  return { c, p };
}
{
  const { c, p } = await admin(1440);
  const calls = (await (await p.request.get(BASE + "/api/calls?limit=5")).json()).calls ?? [];
  const batches = (await (await p.request.get(BASE + "/api/cards/batches")).json()).batches ?? [];
  const customers = await (await p.request.get(BASE + "/api/customers")).json().catch(() => []);
  const campaigns = await (await p.request.get(BASE + "/api/campaigns")).json().catch(() => []);
  await c.close();
  const custId = (Array.isArray(customers) ? customers : customers.customers ?? [])[0]?.id;
  const campId = (Array.isArray(campaigns) ? campaigns : campaigns.campaigns ?? [])[0]?.id;
  const ADMIN = [
    "/admin",
    "/admin?view=week",
    "/admin/bookings",
    "/admin/bookings?filter=all",
    "/admin/new",
    "/admin/messages",
    "/admin/calls",
    calls[0] && `/admin/calls?call=${calls[0].id}`,
    "/admin/customers",
    custId && `/admin/customers/${custId}`,
    "/admin/promotions",
    "/admin/promotions/new",
    campId && `/admin/promotions/${campId}`,
    "/admin/cards",
    batches[0] && `/admin/cards/${batches[0].id}`,
  ].filter(Boolean);
  for (const width of [820, 1024, 1440]) {
    const { c, p } = await admin(width);
    for (const path of ADMIN) {
      await p.goto(BASE + path, { waitUntil: "networkidle" });
      await check(p, path, { width }, true);
    }
    // Is every nav tab, and its badge, fully inside the nav's visible box (not
    // scrolled or clipped away)?
    await p.goto(BASE + "/admin/cards", { waitUntil: "networkidle" });
    const nav = await p.evaluate(() => {
      const box = document.querySelector("header nav").getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll("header nav a")].map((a) => {
        const r = a.getBoundingClientRect();
        return { text: a.textContent.trim(), right: Math.round(r.right), visible: r.left >= box.left - 1 && r.right <= Math.min(box.right, vw) + 1 };
      });
    });
    results.push({ name: "admin-nav", width, nav });
    console.log(`admin-nav ${width} hidden: ${nav.filter((n) => !n.visible).map((n) => n.text).join(", ") || "none"}`);
    await c.close();
  }
}

// Overlays: focus moves in, Tab and Shift+Tab stay inside, the page behind is
// inert, Escape closes and focus returns to the trigger.
async function modalCheck(p, name, trigger) {
  await trigger.evaluate((el) => el.setAttribute("data-trigger", ""));
  await trigger.focus();
  await p.keyboard.press("Enter");
  await p.locator("[role=dialog]").waitFor({ timeout: 10000 });
  await p.waitForTimeout(300);
  const inside = () => p.evaluate(() => !!document.activeElement?.closest("[role=dialog]") || !!document.activeElement?.closest("[data-modal-root]"));
  const states = [await inside()];
  for (let i = 0; i < 25; i++) {
    await p.keyboard.press("Tab");
    states.push(await inside());
  }
  for (let i = 0; i < 25; i++) {
    await p.keyboard.press("Shift+Tab");
    states.push(await inside());
  }
  const backgroundInert = await p.evaluate(() => {
    const outside = [...document.querySelectorAll("a[href], button")].filter((el) => !el.closest("[role=dialog]") && !el.closest("[data-modal-root]"));
    return outside.length > 0 && outside.every((el) => el.closest("[inert]"));
  });
  await p.keyboard.press("Escape");
  await p.locator("[role=dialog]").waitFor({ state: "detached", timeout: 10000 });
  await p.waitForTimeout(300);
  const returned = await p.evaluate(() => document.activeElement?.hasAttribute("data-trigger") ?? false);
  const leftInert = await p.evaluate(() => document.querySelectorAll("[inert]").length);
  const r = { name: `modal:${name}`, focusStayedInside: states.every(Boolean), backgroundInert, escapeClosed: true, focusReturned: returned, inertLeftAfterClose: leftInert };
  results.push(r);
  console.log(JSON.stringify(r));
}
{
  const { c, p } = await admin(1440);
  await p.goto(BASE + "/admin?view=week", { waitUntil: "networkidle" });
  await modalCheck(p, "booking-drawer", p.locator("button[aria-haspopup=dialog]").first());
  await p.goto(BASE + "/admin/calls", { waitUntil: "networkidle" });
  await modalCheck(p, "call-drawer", p.locator("a[href*='call=']").first());
  await c.close();
  const m = await context(390, "en");
  const mp = await m.newPage();
  await mp.goto(BASE + "/", { waitUntil: "networkidle" });
  await modalCheck(mp, "phone-menu", mp.locator("button[aria-controls=site-menu]"));
  await m.close();
}

await browser.close();
writeFileSync(OUT, JSON.stringify(results, null, 1));

// Summary
const axeRuns = results.filter((r) => r.axe);
const byRule = {};
for (const r of axeRuns) {
  for (const v of r.axe) {
    const e = (byRule[v.id] ??= { impact: v.impact, pages: 0, nodes: 0 });
    e.pages++;
    e.nodes += v.nodes;
  }
}
console.log("\naxe runs:", axeRuns.length, "violations (rule: pages, nodes):");
for (const [id, s] of Object.entries(byRule).sort((a, b) => b[1].nodes - a[1].nodes)) console.log(`  ${id} [${s.impact}] ${s.pages} pages, ${s.nodes} nodes`);
console.log("overflow pages:", results.filter((r) => r.overflow > 0).map((r) => `${r.name} ${r.lang ?? ""} ${r.width}`).join("; ") || "none");
