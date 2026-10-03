import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api";
import { getAvailability } from "@/lib/bookings";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const result = await getAvailability({
    serviceId: p.get("serviceId"),
    date: p.get("date"),
    staffId: p.get("staffId") ?? undefined,
  });
  return json(result);
});
