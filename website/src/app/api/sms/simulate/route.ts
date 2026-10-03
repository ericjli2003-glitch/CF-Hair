import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { handleInbound } from "@/lib/sms/inbound";
import { smsMode } from "@/lib/sms/twilio";

export const dynamic = "force-dynamic";

/**
 * (admin) Outbox mode only: simulate a client's reply, exactly as the inbound
 * webhook would process it. body {phone, body, channel?: "promo"|"transactional"}
 */
export const POST = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  if (smsMode() !== "outbox") throw new HttpError(409, "LIVE_MODE", "Replies come from Twilio when it is connected");
  const body = await readJson(req);
  if (!body || typeof body.phone !== "string" || typeof body.body !== "string") throw new HttpError(400, "INVALID_BODY");
  const channel = body.channel === "transactional" ? "transactional" : "promo";
  return json(await handleInbound({ from: body.phone, body: body.body, channel, advancedOptOut: false, messageSid: `SIM${Date.now()}` }));
});
