import type { NextRequest } from "next/server";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { toE164 } from "@/lib/phone";
import { getConsent, recordConsent } from "@/lib/sms/consent";

export const dynamic = "force-dynamic";

/** (agent) Current promotional SMS consent for ?phone= */
export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const phone = toE164(req.nextUrl.searchParams.get("phone"));
  if (!phone) throw new HttpError(400, "INVALID_PHONE");
  return json(await getConsent(phone));
});

/**
 * (agent) Record consent: {phone, status: "express"|"withdrawn"|"declined", source:
 * "web"|"admin"|"phone"|"keyword", wording, language?, detail?}. `wording` is the exact
 * text shown or spoken (required for express). "declined" keeps the status and stops
 * the phone assistant from asking again. Every call appends a ConsentEvent.
 */
export const POST = handle(async (req: NextRequest) => {
  const who = await requireAdminOrAgent(req);
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  const detail = body.detail && typeof body.detail === "object" && !Array.isArray(body.detail) ? (body.detail as Record<string, unknown>) : undefined;
  const view = await recordConsent({
    phone: body.phone,
    status: body.status,
    source: body.source,
    wording: body.wording,
    language: body.language,
    actor: who === "admin" ? "owner" : body.source === "phone" ? "agent" : "owner",
    detail,
  });
  return json({ consent: view }, 201);
});
