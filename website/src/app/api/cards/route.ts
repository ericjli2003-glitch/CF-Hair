import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { listCards } from "@/lib/cards";

export const dynamic = "force-dynamic";

/** (admin, agent) ?batchId=&status= e.g. the notes pipeline fetches status=approved to mail them. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const q = req.nextUrl.searchParams;
  return json({ cards: await listCards({ batchId: q.get("batchId"), status: q.get("status") }) });
});
