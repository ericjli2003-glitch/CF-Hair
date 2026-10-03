// Recreates the local database and seeds demo data.
// SQLite (file:...): deletes the local file, pushes the schema, seeds.
// Postgres: pushes the schema (non-destructive) and seeds; the seed refuses to run
// against a non-SQLite database unless SEED_ALLOW_REMOTE=1 is set.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let url = process.env.DATABASE_URL;
if (!url && existsSync(resolve(root, ".env"))) {
  const m = readFileSync(resolve(root, ".env"), "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (m) url = m[1];
}
url = url || "file:./dev.db";

const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
run("node scripts/sync-salon.mjs");
run("node scripts/prepare-db.mjs");

if (url.startsWith("file:")) {
  const file = resolve(root, "prisma", url.replace(/^file:/, "").split("?")[0]);
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) rmSync(f);
  console.log(`[reset-db] removed local SQLite database ${file}`);
}
run("npx prisma db push --skip-generate");
run("npx prisma generate");
run("npx tsx prisma/seed.ts");
