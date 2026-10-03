import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { lookupUpcoming } from "@/lib/bookings";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  return json(await lookupUpcoming(req.nextUrl.searchParams.get("phone")));
});
