import type { NextRequest } from "next/server";
import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { listCustomers } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
import { SALON_TZ } from "@/lib/salon";
import { isDateKey, zonedTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const p = req.nextUrl.searchParams;
  let since: Date | null = null;
  const s = p.get("since");
  if (s) {
    since = isDateKey(s) ? zonedTime(s, 0, SALON_TZ) : new Date(s);
    if (isNaN(since.getTime())) throw new HttpError(400, "INVALID_SINCE");
  }
  const phoneParam = p.get("phone");
  const phone = phoneParam ? toE164(phoneParam) : null;
  if (phoneParam && !phone) throw new HttpError(400, "INVALID_PHONE");
  const rows = await listCustomers({ since, tag: p.get("tag"), phone, q: p.get("q") });
  return json(rows);
});
