/* Seed-if-empty for the Calls and Cards demo data. scripts/vercel-build.mjs only
   runs the full (wiping) seed on an empty database, so a live demo that already
   has services and bookings would never get calls or cards. This fills each of
   the two areas on its own, only when its tables are empty and the demo clients
   from seed.ts exist, so real data is never touched and a redeploy is a no-op.
   Set SEED_DEMO_EXTRAS=0 to turn it off. */
import type { PrismaClient } from "@prisma/client";
import { DEMO_CARD_CLIENTS, seedCards } from "./seed-cards";
import { DEMO_CALL_CLIENTS, seedCalls } from "./seed-calls";

export type ExtraResult = { seeded: number } | { skipped: "has-data" | "no-demo-clients" | "disabled" };

export interface ExtrasResult {
  calls: ExtraResult;
  cards: ExtraResult;
}

async function hasDemoClients(prisma: PrismaClient, names: string[]): Promise<boolean> {
  // Most of the named demo clients must be there; a real salon database has none of them.
  // Demo clients use the fictional 555-01xx numbers.
  const n = await prisma.customer.count({ where: { name: { in: names }, phone: { contains: "55501" } } });
  return n >= Math.ceil(names.length * 0.8);
}

export async function seedExtrasIfEmpty(prisma: PrismaClient, now = new Date()): Promise<ExtrasResult> {
  if (process.env.SEED_DEMO_EXTRAS === "0") return { calls: { skipped: "disabled" }, cards: { skipped: "disabled" } };
  const [calls, cards, batches] = await Promise.all([prisma.call.count(), prisma.card.count(), prisma.cardBatch.count()]);

  let callsResult: ExtraResult;
  if (calls > 0) callsResult = { skipped: "has-data" };
  else if (!(await hasDemoClients(prisma, DEMO_CALL_CLIENTS))) callsResult = { skipped: "no-demo-clients" };
  else callsResult = { seeded: await seedCalls(prisma, now) };

  let cardsResult: ExtraResult;
  if (cards > 0 || batches > 0) cardsResult = { skipped: "has-data" };
  else if (!(await hasDemoClients(prisma, DEMO_CARD_CLIENTS))) cardsResult = { skipped: "no-demo-clients" };
  else cardsResult = { seeded: await seedCards(prisma, now) };

  return { calls: callsResult, cards: cardsResult };
}
