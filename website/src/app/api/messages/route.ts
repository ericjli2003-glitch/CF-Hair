import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent, requireAgent } from "@/lib/auth";
import { toE164 } from "@/lib/phone";

export const dynamic = "force-dynamic";
const URGENCY = ["low", "normal", "high"];

/** (agent) Callback request left with the AI phone agent. */
export const POST = handle(async (req: NextRequest) => {
  requireAgent(req);
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  const callerName = typeof body.callerName === "string" ? body.callerName.trim().slice(0, 120) : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  const urgency = typeof body.urgency === "string" ? body.urgency : "normal";
  if (!message) throw new HttpError(400, "INVALID_MESSAGE", "message is required");
  if (!URGENCY.includes(urgency)) throw new HttpError(400, "INVALID_URGENCY");
  const phone = toE164(body.phone) ?? (typeof body.phone === "string" ? body.phone.trim() : "");
  if (!phone) throw new HttpError(400, "INVALID_PHONE");
  const row = await prisma.message.create({
    data: { callerName: callerName || "Unknown caller", phone, message, urgency, source: "phone" },
  });
  return json({ message: row }, 201);
});

/** (admin) List messages, newest first. ?status=new|done */
export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const status = req.nextUrl.searchParams.get("status");
  const rows = await prisma.message.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return json(rows);
});
