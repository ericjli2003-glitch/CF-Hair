import { timingSafeEqual } from "node:crypto";
import { HttpError, handle, json } from "@/lib/api";
import { hasAgentKey, isAdminSession } from "@/lib/auth";
import { sendDueReminders } from "@/lib/notify";
import { processQueue } from "@/lib/sms/campaigns";
import { syncImpliedConsent } from "@/lib/sms/consent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * Processes the send queue: starts due campaigns, sends one throttled batch of
 * promos (inside 09:00 to 20:00 only), sends due appointment reminders, and
 * refreshes implied consent. GET is for Vercel Cron (Authorization: Bearer
 * $CRON_SECRET); POST for the admin or the agent key.
 */
async function run() {
  const implied = await syncImpliedConsent();
  const queue = await processQueue();
  const reminders = queue.inSendWindow ? await sendDueReminders() : { sent: 0, email: 0, skipped: 0 };
  return { queue, reminders, implied };
}

export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req) && !hasAgentKey(req)) throw new HttpError(401, "UNAUTHORIZED");
  return json(await run());
});

export const POST = handle(async (req: Request) => {
  if (!cronAuthorized(req) && !hasAgentKey(req) && !(await isAdminSession())) throw new HttpError(401, "UNAUTHORIZED");
  return json(await run());
});
