// Copies ../shared/salon.json (the monorepo source of truth) into src/data so the
// website builds standalone (for example on Vercel with Root Directory = website).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../shared/salon.json");
const dest = resolve(here, "../src/data/salon.json");

if (existsSync(src)) {
  const next = readFileSync(src, "utf8");
  const prev = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  if (next !== prev) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, next);
    console.log("[sync-salon] updated src/data/salon.json from shared/salon.json");
  }
} else if (!existsSync(dest)) {
  console.error("[sync-salon] no salon.json found");
  process.exit(1);
}
