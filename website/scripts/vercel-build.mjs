// Build entry point on Vercel (npm runs "vercel-build" instead of "build" there).
// Points Prisma at Postgres, applies the schema, seeds demo data only when the
// database is empty (so redeploys never wipe real bookings), fills the Calls and
// Cards demo tables on their own when those are empty, then builds Next.js.
import { execSync } from "node:child_process";

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
  console.error("[vercel-build] DATABASE_URL must be a Postgres URL on Vercel (SQLite files do not persist).");
  process.exit(1);
}

run("node scripts/sync-salon.mjs");
run("node scripts/prepare-db.mjs");
run("npx prisma generate");
// Schema changes and seeding go over a direct (unpooled) connection when the
// provider supplies one, as Neon does through the Vercel integration.
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
run("npx prisma db push --skip-generate", { DATABASE_URL: direct });

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: direct } } });
const services = await prisma.service.count();
await prisma.$disconnect();

if (services === 0 || process.env.SEED_ON_DEPLOY === "1") {
  console.log("[vercel-build] seeding demo data");
  run("npx tsx prisma/seed.ts", { SEED_ALLOW_REMOTE: "1", DATABASE_URL: direct });
} else {
  console.log(`[vercel-build] database already has ${services} services, skipping seed`);
  // Newer demo areas (calls, handwritten cards) seed themselves when their tables
  // are empty and the demo clients exist; real data is never touched.
  run("npx tsx prisma/seed-if-empty.ts", { DATABASE_URL: direct });
}

run("npx next build");
