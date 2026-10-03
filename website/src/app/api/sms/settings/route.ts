import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { toE164 } from "@/lib/phone";
import { getSmsSettings, saveSmsSettings } from "@/lib/sms/settings";
import { senderFor, smsMode, txnMode } from "@/lib/sms/twilio";

export const dynamic = "force-dynamic";

/** (admin) Frequency cap, owner test phone, and the sending mode of each sender. */
export const GET = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  return json({ ...(await getSmsSettings()), promoMode: smsMode(), txnMode: txnMode(), promoSender: !!senderFor("promo"), txnSender: !!senderFor("transactional") });
});

/** (admin) body {capMax?, capDays?, ownerPhone?} */
export const PUT = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  const int = (v: unknown, lo: number, hi: number, code: string) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new HttpError(400, code);
    return n;
  };
  let ownerPhone: string | null | undefined;
  if (body.ownerPhone !== undefined) {
    ownerPhone = body.ownerPhone === null || body.ownerPhone === "" ? null : toE164(body.ownerPhone);
    if (ownerPhone === null && body.ownerPhone) throw new HttpError(400, "INVALID_PHONE");
  }
  return json(
    await saveSmsSettings({
      capMax: int(body.capMax, 1, 30, "INVALID_CAP_MAX"),
      capDays: int(body.capDays, 1, 365, "INVALID_CAP_DAYS"),
      ownerPhone,
    }),
  );
});
