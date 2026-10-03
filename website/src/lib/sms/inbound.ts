// Inbound texts (Twilio webhook) and delivery status callbacks.
//
// Routing by sender:
// - promo sender:         STOP withdraws promotional consent only. START re-subscribes.
// - transactional sender: STOP marks the client "transactional SMS opted out" (the carrier
//                         blocks those texts anyway); reminders then fall back to email.
//                         START clears it. Promotional consent is not changed.
// HELP on either replies with the salon's name and phone. Anything else goes to the
// admin Messages inbox.
import { prisma } from "../db";
import { DEFAULT_LANGUAGE, isLanguageCode, type LanguageCode } from "../languages";
import { toE164 } from "../phone";
import { formatPhoneDisplay, fullAddress, salon, SALON_TZ } from "../salon";
import { clearTxnOptOut, markTxnOptedOut } from "../notify";
import { toZonedISO } from "../time";
import { recordConsent } from "./consent";
import { classifyKeyword, normaliseKeyword, twilioRepliesTo, type KeywordAction } from "./keywords";
import { OPT_OUT_FOOTER } from "./compose";
import type { SmsChannel } from "./twilio";

export interface InboundInput {
  from: string;
  body: string;
  channel: SmsChannel;
  messageSid?: string | null;
  /** Twilio's OptOutType when Advanced Opt-Out recognised the keyword (STOP, START, HELP). */
  optOutType?: string | null;
  /** Whether Twilio Advanced Opt-Out is replying to its own keywords on this sender. */
  advancedOptOut: boolean;
  now?: Date;
}

export interface InboundResult {
  action: KeywordAction | "message";
  channel: SmsChannel;
  phone: string;
  reply: string | null;
  inboxMessageId?: string;
}

function guessLanguage(body: string, preferred: string | null | undefined): LanguageCode {
  if (/[가-힯]/.test(body)) return "ko-KR";
  if (/[訂幫覆]/.test(body)) return "zh-HK";
  if (/[一-鿿]/.test(body)) return "zh-CN";
  return isLanguageCode(preferred) ? preferred : DEFAULT_LANGUAGE;
}

const phoneText = formatPhoneDisplay(salon.phone);

export const REPLIES = {
  promoStop: {
    "en-US": `${salon.name}: you're unsubscribed from promotional texts. Appointment texts are not affected. Reply START to resubscribe.`,
    "zh-CN": `${salon.name}：您已退订推广短信，预约短信不受影响。回复START可重新订阅。`,
    "zh-HK": `${salon.name}：你已取消推廣短訊，預約短訊不受影響。回覆START可重新訂閱。`,
    "ko-KR": `${salon.name}: 홍보 문자 수신이 거부되었습니다. 예약 문자는 계속 발송됩니다. 다시 받으시려면 START로 회신하세요.`,
  },
  txnStop: {
    "en-US": `${salon.name}: you won't get appointment texts from this number. We'll email reminders if we have your email. Reply START to turn texts back on.`,
    "zh-CN": `${salon.name}：您将不再从此号码收到预约短信。如有您的电子邮件，我们会以邮件提醒。回复START可恢复。`,
    "zh-HK": `${salon.name}：你將不會再從此號碼收到預約短訊。如有你的電郵，我們會以電郵提醒。回覆START可恢復。`,
    "ko-KR": `${salon.name}: 이 번호로 예약 문자가 더 이상 발송되지 않습니다. 이메일이 있으면 이메일로 알려 드립니다. 다시 받으시려면 START로 회신하세요.`,
  },
  promoStart: {
    "en-US": `${salon.name}: you're subscribed to occasional specials. ${OPT_OUT_FOOTER["en-US"]}`,
    "zh-CN": `${salon.name}：您已订阅优惠短信。${OPT_OUT_FOOTER["zh-CN"]}`,
    "zh-HK": `${salon.name}：你已訂閱優惠短訊。${OPT_OUT_FOOTER["zh-HK"]}`,
    "ko-KR": `${salon.name}: 할인 소식 문자 수신에 동의하셨습니다. ${OPT_OUT_FOOTER["ko-KR"]}`,
  },
  txnStart: {
    "en-US": `${salon.name}: appointment texts are back on for this number.`,
    "zh-CN": `${salon.name}：此号码已恢复接收预约短信。`,
    "zh-HK": `${salon.name}：此號碼已恢復接收預約短訊。`,
    "ko-KR": `${salon.name}: 이 번호로 예약 문자 수신이 다시 시작되었습니다.`,
  },
  help: {
    "en-US": `${salon.name}, ${fullAddress()}. Call ${phoneText}. Reply STOP to opt out.`,
    "zh-CN": `${salon.name}，${fullAddress()}。电话 ${phoneText}。回复STOP退订。`,
    "zh-HK": `${salon.name}，${fullAddress()}。電話 ${phoneText}。回覆STOP退訂。`,
    "ko-KR": `${salon.name}, ${fullAddress()}. 전화 ${phoneText}. 수신거부: STOP 회신`,
  },
} satisfies Record<string, Record<LanguageCode, string>>;

export async function handleInbound(input: InboundInput): Promise<InboundResult> {
  const now = input.now ?? new Date();
  const phone = toE164(input.from) ?? input.from.trim();
  const body = (input.body ?? "").slice(0, 1600);
  const [customer, consent] = await Promise.all([
    prisma.customer.findUnique({ where: { phone }, include: { bookings: { where: { status: "confirmed", start: { gt: now } }, orderBy: { start: "asc" }, take: 1, include: { service: true } } } }),
    prisma.smsConsent.findUnique({ where: { phone } }),
  ]);
  const currentlyWithdrawn = input.channel === "promo" ? consent?.status === "withdrawn" : !!consent?.txnOptedOutAt;
  let action = classifyKeyword(body, { currentlyWithdrawn });
  // Twilio's own classification wins for its keywords, so the app stays in sync with its block list.
  const opt = (input.optOutType ?? "").toUpperCase();
  if (opt === "STOP") action = "stop";
  else if (opt === "START") action = "start";
  else if (opt === "HELP") action = "help";

  const lang = guessLanguage(body, customer?.preferredLanguage);
  // Twilio Advanced Opt-Out already answered its English keywords; do not reply twice.
  const twilioReplied = input.advancedOptOut && (!!opt || twilioRepliesTo(body));
  const detail = { channel: input.channel, messageSid: input.messageSid ?? null, keyword: normaliseKeyword(body) };
  const reply = (text: string) => (twilioReplied ? null : text);

  if (action === "stop") {
    if (input.channel === "promo") {
      await recordConsent({ phone, status: "withdrawn", source: "keyword", wording: body, language: lang, actor: "customer", detail, now });
    } else {
      await markTxnOptedOut(phone, { wording: body, source: "keyword", actor: "customer", detail });
    }
    // CANCEL or 取消 may have been meant for an appointment: flag it for the owner.
    let inboxMessageId: string | undefined;
    const next = customer?.bookings[0];
    if (next && /^(CANCEL|取消|END|QUIT)$/.test(normaliseKeyword(body))) {
      const when = toZonedISO(next.start, SALON_TZ).slice(0, 16).replace("T", " ");
      const m = await prisma.message.create({
        data: {
          callerName: customer!.name,
          phone,
          message: `Replied "${body.trim()}" to the ${input.channel === "promo" ? "promotions" : "appointment"} number. They have ${next.service.name} on ${when}; if they meant to cancel the appointment, please call them. ${input.channel === "promo" ? "Promotional texts are now stopped." : "Appointment texts to them are now blocked; reminders will go by email if we have one."}`,
          urgency: "high",
          source: "sms",
        },
      });
      inboxMessageId = m.id;
    }
    return { action, channel: input.channel, phone, reply: reply(input.channel === "promo" ? REPLIES.promoStop[lang] : REPLIES.txnStop[lang]), inboxMessageId };
  }

  if (action === "start") {
    if (input.channel === "promo") {
      await recordConsent({
        phone, status: "express", source: "keyword", actor: "customer", language: lang, now,
        wording: `Texted "${body.trim()}" to ${salon.name}'s promotions number to subscribe. Reply received ${toZonedISO(now, SALON_TZ)}.`,
        detail,
      });
      return { action, channel: input.channel, phone, reply: reply(REPLIES.promoStart[lang]) };
    }
    await clearTxnOptOut(phone, { wording: body, detail });
    return { action, channel: input.channel, phone, reply: reply(REPLIES.txnStart[lang]) };
  }

  if (action === "help") {
    await prisma.consentEvent.create({
      data: { phone, customerId: customer?.id ?? null, type: "help", source: "keyword", actor: "customer", wording: body, language: lang, detail: JSON.stringify(detail) },
    });
    return { action, channel: input.channel, phone, reply: reply(REPLIES.help[lang]) };
  }

  const m = await prisma.message.create({
    data: {
      callerName: customer?.name ?? "Unknown texter",
      phone,
      message: `Text reply${input.channel === "promo" ? " to a promotion" : ""}: ${body.trim() || "(empty)"}`,
      urgency: "normal",
      source: "sms",
    },
  });
  return { action: "message", channel: input.channel, phone, reply: null, inboxMessageId: m.id };
}

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, failed: 2 };

/** Twilio StatusCallback: queued/sent -> sent, delivered -> delivered, undelivered/failed -> failed. */
export async function handleStatus(params: Record<string, string>, now = new Date()) {
  const sid = params.MessageSid ?? params.SmsSid;
  const raw = (params.MessageStatus ?? params.SmsStatus ?? "").toLowerCase();
  if (!sid || !raw) return { updated: false };
  const m = await prisma.campaignMessage.findUnique({ where: { twilioSid: sid } });
  if (!m) return { updated: false };
  const status = raw === "delivered" ? "delivered" : raw === "failed" || raw === "undelivered" ? "failed" : "sent";
  if ((RANK[status] ?? 0) < (RANK[m.status] ?? 0)) return { updated: false, status: m.status };
  const error = status === "failed" ? `${params.ErrorCode ?? ""} ${raw}`.trim() : null;
  await prisma.campaignMessage.update({
    where: { id: m.id },
    data: {
      status,
      ...(status === "delivered" ? { deliveredAt: now } : {}),
      ...(status === "failed" ? { failedAt: now, error } : {}),
    },
  });
  // 21610: they replied STOP to the promo sender at the carrier: mirror the withdrawal.
  if (params.ErrorCode === "21610" && !m.isTest) {
    const row = await prisma.smsConsent.findUnique({ where: { phone: m.phone } });
    if (row?.status !== "withdrawn") {
      await recordConsent({ phone: m.phone, status: "withdrawn", source: "keyword", actor: "system", wording: "Carrier opt-out (Twilio error 21610)", detail: { messageSid: sid } });
    }
  }
  return { updated: true, status };
}
