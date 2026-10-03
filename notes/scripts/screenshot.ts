/**
 * Screenshot proof sheets with Playwright (Chromium preinstalled under /opt/pw-browsers,
 * or set CHROMIUM_PATH). Usage: npm run screenshot -- <proof.html> [<proof.html>...] [--out dir]
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { REPO_ROOT } from "../src/config.js";

function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).sort().reverse()) {
    for (const rel of ["chrome-linux/headless_shell", "chrome-linux/chrome"]) {
      const p = path.join(root, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(REPO_ROOT, "docs", "screenshots", "notes");
  const files = args.filter((a, i) => a !== "--out" && (outIdx < 0 || i !== outIdx + 1));
  if (!files.length) throw new Error("Pass one or more proof.html files");
  mkdirSync(outDir, { recursive: true });
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ["--no-sandbox", "--disable-gpu"],
    ...(proxy ? { proxy: { server: proxy } } : {}),
  });
  try {
    for (const f of files) {
      const name = path.basename(path.dirname(path.resolve(f)));
      for (const [label, viewport] of [
        ["desktop", { width: 1280, height: 1000 }],
        ["mobile", { width: 390, height: 844 }],
      ] as const) {
        const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
        await page.goto(`file://${path.resolve(f)}`, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(600);
        const top = path.join(outDir, `${name}-${label}.png`);
        await page.screenshot({ path: top, timeout: 60_000 });
        console.log(top);
        if (label === "desktop") {
          const card = page.locator("article.row").first();
          const one = path.join(outDir, `${name}-card.png`);
          await card.screenshot({ path: one, timeout: 60_000 });
          console.log(one);
          // Also capture a Korean card when the run has one.
          const ko = page.locator("article.row", { has: page.locator(".hand.alt.ko") }).first();
          if (await ko.count()) {
            const koFile = path.join(outDir, `${name}-korean-card.png`);
            await ko.scrollIntoViewIfNeeded();
            await ko.screenshot({ path: koFile, timeout: 60_000 });
            console.log(koFile);
          }
          const fontsOk = await page.evaluate(() => document.fonts.check("21px Caveat"));
          if (!fontsOk) console.warn("warning: Caveat web font did not load (offline?); screenshot uses a fallback font");
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
