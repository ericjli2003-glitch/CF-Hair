// Build entry point on Vercel (npm runs "vercel-build" instead of "build" there).
// Points Prisma at Postgres, applies the schema, seeds demo data only when the
// database is empty (so redeploys never wipe real bookings), then builds Next.js.
import { execSync } from "node:child_process";

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
  console.error("[vercel-build] DATABASE_URL must be a Postgres URL on Vercel (SQLite files do not persist).");
  process.exit(1);
}

run("node scripts/sync-salon.mjs");
run("node scripts/prepare-db.mjs");
run("npx prisma generate");
run("npx prisma db push --skip-generate");

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const services = await prisma.service.count();
await prisma.$disconnect();

if (services === 0 || process.env.SEED_ON_DEPLOY === "1") {
  console.log("[vercel-build] seeding demo data");
  run("npx tsx prisma/seed.ts", { SEED_ALLOW_REMOTE: "1" });
} else {
  console.log(`[vercel-build] database already has ${services} services, skipping seed`);
}

run("npx next build");
