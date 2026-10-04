import type { NextRequest } from "next/server";
import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent, requireAgent } from "@/lib/auth";
import { listCalls, upsertCall } from "@/lib/calls";

export const dynamic = "force-dynamic";

/** (agent) One record per call, upserted by callSid. 201 when new, 200 on update. */
export const POST = handle(async (req: NextRequest) => {
  requireAgent(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "INVALID_BODY");
  }
  const { call, created } = await upsertCall(body);
  return json({ call }, created ? 201 : 200);
});

/** (admin) ?from=YYYY-MM-DD&to=YYYY-MM-DD&outcome=&phone=&cursor=&limit= newest first. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const q = req.nextUrl.searchParams;
  const limit = q.get("limit") ? Number(q.get("limit")) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, "INVALID_LIMIT");
  return json(await listCalls({ from: q.get("from"), to: q.get("to"), outcome: q.get("outcome"), phone: q.get("phone"), cursor: q.get("cursor"), limit }));
});
