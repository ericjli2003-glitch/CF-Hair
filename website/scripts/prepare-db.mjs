// Points prisma/schema.prisma at the right provider for DATABASE_URL:
// "file:..." uses sqlite (local dev), "postgres://" or "postgresql://" uses postgresql.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../prisma/schema.prisma");

let url = process.env.DATABASE_URL;
if (!url) {
  const envFile = resolve(here, "../.env");
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (m) url = m[1];
  }
}
url = url || "file:./dev.db";
const provider = /^postgres(ql)?:\/\//.test(url) ? "postgresql" : "sqlite";
const schema = readFileSync(schemaPath, "utf8");
const updated = schema.replace(
  /(datasource db \{\s*provider\s*=\s*)"[a-z]+"/,
  `$1"${provider}"`,
);
if (updated !== schema) {
  writeFileSync(schemaPath, updated);
  console.log(`[prepare-db] datasource provider set to ${provider}`);
}
