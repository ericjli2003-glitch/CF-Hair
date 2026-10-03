// Twilio plumbing shared by the promotional sender and the webhooks: credentials,
// sending with a status callback, and X-Twilio-Signature validation.
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Two senders, on purpose. With Twilio Advanced Opt-Out a STOP blocks the recipient
 * for the sender (number or Messaging Service) they replied to. Promotions therefore
 * go out from their own sender, so a client who opts out of promotions still gets
 * booking confirmations and reminders from the transactional sender.
 *
 *   transactional: TWILIO_TXN_MESSAGING_SERVICE_SID or TWILIO_TXN_FROM
 *                  (falls back to the older TWILIO_MESSAGING_SERVICE_SID / TWILIO_FROM_NUMBER)
 *   promotional:   TWILIO_PROMO_MESSAGING_SERVICE_SID or TWILIO_PROMO_FROM (no fallback)
 */
export type SmsChannel = "promo" | "transactional";

const env = (k: string) => (process.env[k] ?? "").trim();

export function twilioCredentials(): boolean {
  return !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN"));
}

export interface Sender {
  MessagingServiceSid?: string;
  From?: string;
}

/** The Twilio sender for a channel, or null when none is configured. */
export function senderFor(channel: SmsChannel): Sender | null {
  if (channel === "promo") {
    if (env("TWILIO_PROMO_MESSAGING_SERVICE_SID")) return { MessagingServiceSid: env("TWILIO_PROMO_MESSAGING_SERVICE_SID") };
    if (env("TWILIO_PROMO_FROM")) return { From: env("TWILIO_PROMO_FROM") };
    return null;
  }
  if (env("TWILIO_TXN_MESSAGING_SERVICE_SID")) return { MessagingServiceSid: env("TWILIO_TXN_MESSAGING_SERVICE_SID") };
  if (env("TWILIO_TXN_FROM")) return { From: env("TWILIO_TXN_FROM") };
  if (env("TWILIO_MESSAGING_SERVICE_SID")) return { MessagingServiceSid: env("TWILIO_MESSAGING_SERVICE_SID") };
  if (env("TWILIO_FROM_NUMBER")) return { From: env("TWILIO_FROM_NUMBER") };
  return null;
}

/** True when promos and transactional texts would leave from the same sender (a misconfiguration). */
export function sendersCollide(): boolean {
  const p = senderFor("promo");
  const t = senderFor("transactional");
  if (!p || !t) return false;
  return (!!p.MessagingServiceSid && p.MessagingServiceSid === t.MessagingServiceSid) || (!!p.From && p.From === t.From);
}

/**
 * How promotional campaigns are delivered:
 * - outbox: dry run, nothing leaves the building (no Twilio credentials, or SMS_DRY_RUN=1)
 * - live:   credentials and a separate promo sender are configured
 * - blocked: credentials exist but no promo sender (or it equals the transactional one); campaigns refuse to send
 */
export function smsMode(): "live" | "outbox" | "blocked" {
  if (env("SMS_DRY_RUN") === "1" || env("SMS_DRY_RUN") === "true" || !twilioCredentials()) return "outbox";
  if (!senderFor("promo") || sendersCollide()) return "blocked";
  return "live";
}

/** Transactional texts: live when credentials and a transactional sender exist, otherwise not sent (logged). */
export function txnMode(): "live" | "outbox" {
  if (env("SMS_DRY_RUN") === "1" || env("SMS_DRY_RUN") === "true") return "outbox";
  return twilioCredentials() && senderFor("transactional") ? "live" : "outbox";
}

/** Which of our senders an inbound text was addressed to (Twilio's To / MessagingServiceSid). */
export function identifyChannel(params: Record<string, string>, hint?: string | null): SmsChannel | null {
  const to = params.To ?? "";
  const svc = params.MessagingServiceSid ?? "";
  const promo = senderFor("promo");
  const txn = senderFor("transactional");
  if (promo && ((promo.MessagingServiceSid && svc === promo.MessagingServiceSid) || (promo.From && to === promo.From))) return "promo";
  if (txn && ((txn.MessagingServiceSid && svc === txn.MessagingServiceSid) || (txn.From && to === txn.From))) return "transactional";
  if (hint === "promo" || hint === "transactional") return hint;
  return null;
}

/** Public base URL used for Twilio callbacks and signature checks, e.g. https://cfhair.ca */
export function publicBaseUrl(): string | null {
  const v = env("PUBLIC_BASE_URL").replace(/\/+$/, "");
  return v || null;
}

export interface SendResult {
  ok: boolean;
  sid?: string;
  status?: string;
  error?: string;
}

/** Sends one text through Twilio's Messages API from the given channel's sender. */
export async function twilioSend(channel: SmsChannel, to: string, body: string, opts: { statusCallback?: string } = {}): Promise<SendResult> {
  const sender = senderFor(channel);
  if (!twilioCredentials() || !sender) return { ok: false, error: `No ${channel} sender configured` };
  if (channel === "promo" && sendersCollide()) return { ok: false, error: "Promo sender must differ from the transactional sender" };
  const sid = env("TWILIO_ACCOUNT_SID");
  const params = new URLSearchParams({ To: to, Body: body });
  if (sender.MessagingServiceSid) params.set("MessagingServiceSid", sender.MessagingServiceSid);
  else params.set("From", sender.From!);
  if (opts.statusCallback) params.set("StatusCallback", opts.statusCallback);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // 21610: the recipient replied STOP to this sender (Advanced Opt-Out block list).
      return { ok: false, error: `${data.code ?? res.status}: ${data.message ?? "Twilio error"}` };
    }
    return { ok: true, sid: String(data.sid), status: String(data.status ?? "queued") };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + concat(sorted(key + value)))).
 * `url` must be exactly the URL configured in Twilio (including query string).
 */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function validTwilioSignature(authToken: string, signature: string | null, url: string, params: Record<string, string>): boolean {
  if (!signature) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Checks a Twilio webhook. With Twilio configured the signature is mandatory.
 * Without Twilio (offline outbox mode) the request may instead carry the agent key,
 * which is how the admin "simulate reply" button and the curl tests drive the
 * webhook; that bypass does not exist once real credentials are set.
 */
export function verifyTwilioWebhook(req: Request, params: Record<string, string>): { ok: boolean; via: "signature" | "test-bypass" | "none" } {
  const token = env("TWILIO_AUTH_TOKEN");
  if (token) {
    const path = new URL(req.url);
    const base = publicBaseUrl();
    const url = base ? `${base}${path.pathname}${path.search}` : req.url;
    return { ok: validTwilioSignature(token, req.headers.get("x-twilio-signature"), url, params), via: "signature" };
  }
  const key = process.env.AGENT_API_KEY;
  const got = req.headers.get("x-api-key");
  if (key && got && got.length === key.length && timingSafeEqual(Buffer.from(got), Buffer.from(key))) {
    return { ok: true, via: "test-bypass" };
  }
  return { ok: false, via: "none" };
}

export async function readForm(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(j)) if (v !== undefined && v !== null) out[k] = String(v);
    return out;
  }
  const text = await req.text();
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

export function twiml(message?: string): Response {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = message ? `<Response><Message>${esc(message)}</Message></Response>` : "<Response></Response>";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "Content-Type": "text/xml" } });
}
