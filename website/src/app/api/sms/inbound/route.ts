import { handle, json } from "@/lib/api";
import { handleInbound } from "@/lib/sms/inbound";
import { identifyChannel, readForm, senderFor, twiml, verifyTwilioWebhook, type SmsChannel } from "@/lib/sms/twilio";

export const dynamic = "force-dynamic";

/**
 * Twilio "A message comes in" webhook for both senders. Point the promo and the
 * transactional number (or Messaging Service) here. The sender is identified from
 * Twilio's To / MessagingServiceSid, or from ?sender=promo|transactional in the
 * configured URL. Requests must carry a valid X-Twilio-Signature; without Twilio
 * credentials (offline outbox) the agent key is accepted instead, for demos and tests.
 */
export const POST = handle(async (req: Request) => {
  const params = await readForm(req);
  const check = verifyTwilioWebhook(req, params);
  if (!check.ok) return new Response("Invalid signature", { status: 403 });

  const url = new URL(req.url);
  const hint = url.searchParams.get("sender") ?? (check.via === "test-bypass" ? params.Channel : null);
  let channel: SmsChannel | null = identifyChannel(params, hint);
  if (!channel) channel = senderFor("promo") || !senderFor("transactional") ? "promo" : "transactional";

  const advancedOptOut = check.via === "signature" && (process.env.TWILIO_ADVANCED_OPT_OUT ?? "true") !== "false";
  const result = await handleInbound({
    from: params.From ?? "",
    body: params.Body ?? "",
    channel,
    messageSid: params.MessageSid ?? params.SmsSid ?? null,
    optOutType: params.OptOutType ?? null,
    advancedOptOut,
  });
  // Tests and the admin simulator ask for JSON; Twilio gets TwiML.
  if ((req.headers.get("accept") ?? "").includes("application/json")) return json(result);
  return twiml(result.reply ?? undefined);
});
