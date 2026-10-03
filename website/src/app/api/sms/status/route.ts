import { handle, json } from "@/lib/api";
import { handleStatus } from "@/lib/sms/inbound";
import { readForm, verifyTwilioWebhook } from "@/lib/sms/twilio";

export const dynamic = "force-dynamic";

/** Twilio StatusCallback for campaign texts: updates each recipient's status (sent, delivered, failed). */
export const POST = handle(async (req: Request) => {
  const params = await readForm(req);
  if (!verifyTwilioWebhook(req, params).ok) return new Response("Invalid signature", { status: 403 });
  return json(await handleStatus(params));
});
