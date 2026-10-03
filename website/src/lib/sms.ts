// Optional SMS via Twilio's REST API. No-op unless TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (or TWILIO_MESSAGING_SERVICE_SID) are set.
export function smsEnabled(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)
  );
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!smsEnabled()) return false;
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const params = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set("From", process.env.TWILIO_FROM_NUMBER!);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    if (!res.ok) console.warn("[sms] Twilio responded", res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.warn("[sms] send failed", e);
    return false;
  }
}
