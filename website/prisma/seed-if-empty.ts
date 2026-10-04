/* CLI for seed-extras.ts, run by scripts/vercel-build.mjs on every deploy that
   does not run the full seed: npx tsx prisma/seed-if-empty.ts */
import { PrismaClient } from "@prisma/client";
import { seedExtrasIfEmpty } from "./seed-extras";

const prisma = new PrismaClient();
seedExtrasIfEmpty(prisma)
  .then((r) => console.log(`[seed-if-empty] calls: ${JSON.stringify(r.calls)}, cards: ${JSON.stringify(r.cards)}`))
  .catch((e) => {
    console.error("[seed-if-empty] failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
