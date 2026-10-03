// Creates a throwaway SQLite database (prisma/test.db) with the current schema.
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export default function setup() {
  const root = resolve(__dirname, "..");
  const db = resolve(root, "prisma/test.db");
  const clean = () => {
    for (const f of [db, `${db}-journal`]) if (existsSync(f)) rmSync(f);
  };
  clean();
  execSync("npx prisma db push --skip-generate", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
  return clean;
}
