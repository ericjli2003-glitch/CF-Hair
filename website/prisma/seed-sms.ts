/* Demo data for promotional SMS: a realistic mix of consent states with an
   append-only event log, one past campaign with results, one scheduled campaign,
   one draft, and a couple of transactional notices. Called from seed.ts. */
import type { Customer, PrismaClient } from "@prisma/client";
import { blocksFor } from "../src/lib/availability";
import { composePromo } from "../src/lib/sms/compose";
import { impliedExpiry, nextAllowedSendTime } from "../src/lib/sms/rules";
import { countSegments } from "../src/lib/sms/segments";
import { webOptInWording } from "../src/lib/sms/web-consent";
import { salon, SALON_TZ } from "../src/lib/salon";
import { addDays, dateKeyOf, zonedTime } from "../src/lib/time";
import type { LanguageCode } from "../src/lib/languages";

const DAY = 86400000;

const PHONE_QUESTION: Record<string, string> = {
  "en-US": "Would you like the occasional text about specials? You can reply STOP any time.",
  "zh-CN": "您愿意偶尔收到我们优惠活动的短信吗？您随时可以回复STOP退订。",
  "zh-HK": "你想唔想間中收到我哋優惠嘅短訊？你隨時可以回覆STOP取消。",
  "ko-KR": "가끔 특별 할인 소식을 문자로 받아보시겠어요? 언제든지 STOP으로 회신하시면 수신이 중단됩니다.",
};
const phoneWording = (lang: string) => `[Phone assistant, ${salon.name}, ${lang}] "${PHONE_QUESTION[lang] ?? PHONE_QUESTION["en-US"]}" Caller said yes.`;
const FRONT_DESK = {
  "en-US": "Can CF Hair Salon text you occasional specials and offers? You can reply STOP any time to opt out.",
  "zh-HK": "CF Hair Salon可唔可以間中短訊通知你優惠？你隨時可以回覆STOP取消。",
};

type Plan =
  | { kind: "express"; source: "web" | "admin" | "phone" | "keyword"; daysAgo: number; lang?: LanguageCode }
  | { kind: "withdrawn"; optedInDaysAgo: number; daysAgo: number; text: string; lang?: LanguageCode };

// By customer name (see CUSTOMERS in seed.ts).
const PLANS: Record<string, Plan> = {
  "Wei Zhang": { kind: "express", source: "phone", daysAgo: 64, lang: "zh-CN" },
  "Mei Lin Chen": { kind: "express", source: "web", daysAgo: 88, lang: "zh-CN" },
  "Kevin Wong": { kind: "express", source: "admin", daysAgo: 51, lang: "zh-HK" },
  "Jasmine Liu": { kind: "express", source: "web", daysAgo: 95 },
  "Ka Yan Leung": { kind: "express", source: "admin", daysAgo: 70, lang: "zh-HK" },
  "Min-jun Kim": { kind: "express", source: "web", daysAgo: 45, lang: "ko-KR" },
  "Arash Rahimi": { kind: "express", source: "web", daysAgo: 33 },
  "Maria Santos": { kind: "express", source: "web", daysAgo: 58 },
  "Harjit Gill": { kind: "express", source: "keyword", daysAgo: 27 },
  "Emily Thompson": { kind: "express", source: "admin", daysAgo: 80 },
  "Grace Huang": { kind: "express", source: "phone", daysAgo: 40, lang: "zh-CN" },
  "Sophie Tremblay": { kind: "express", source: "web", daysAgo: 22 },
  "Olivia Kwan": { kind: "express", source: "web", daysAgo: 19 },
  "Paolo Reyes": { kind: "express", source: "web", daysAgo: 60 }, // opts out after the campaign (below)
  "Chloe Yeung": { kind: "withdrawn", optedInDaysAgo: 100, daysAgo: 41, text: "退訂", lang: "zh-HK" },
};

const WEB_LANG: Record<string, "en" | "zh" | "ko"> = { "en-US": "en", "zh-CN": "zh", "zh-HK": "zh", "ko-KR": "ko" };

export async function seedSms(prisma: PrismaClient, customers: Customer[], now: Date) {
  await prisma.campaignMessage.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.consentEvent.deleteMany();
  await prisma.smsConsent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.appSetting.deleteMany();

  const byName = new Map(customers.map((c) => [c.name, c]));
  const at = (daysAgo: number, hour = 11) => {
    const key = dateKeyOf(new Date(now.getTime() - daysAgo * DAY), SALON_TZ);
    return zonedTime(key, hour * 60 + 17, SALON_TZ);
  };

  // Older visits so implied consent has a spread: one expiring soon, one expired, one mid-way.
  const older: [string, number, string][] = [
    ["Raymond Fung", 700, "senior-cut"], // implied, expires in about a month
    ["Hana Choi", 790, "womens-cut"], // implied consent expired
    ["Lucas Martins", 420, "mens-cut"],
    ["Hassan Ahmadi", 300, "mens-cut"],
  ];
  for (const [name, daysAgo, serviceId] of older) {
    const c = byName.get(name);
    const svc = salon.services.find((s) => s.id === serviceId);
    const st = salon.staff.find((s) => s.serviceIds.includes(serviceId));
    if (!c || !svc || !st) continue;
    const start = at(daysAgo, 13);
    const end = new Date(start.getTime() + svc.durationMin * 60000);
    const b = await prisma.booking.create({
      data: { serviceId, staffId: st.id, customerId: c.id, start, end, status: "completed", source: "walk-in", priceCAD: svc.priceCAD, createdAt: start },
    });
    await prisma.slotLock.createMany({ data: blocksFor(start, end).map((slotStart) => ({ staffId: st.id, slotStart, bookingId: b.id })) });
  }

  const event = (phone: string, customerId: string, type: string, source: string, actor: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.consentEvent.create({
      data: {
        phone, customerId, type, source, actor, createdAt,
        wording: (extra.wording as string) ?? null,
        language: (extra.language as string) ?? null,
        detail: extra.detail ? JSON.stringify(extra.detail) : null,
      },
    });

  // Express and withdrawn.
  for (const [name, plan] of Object.entries(PLANS)) {
    const c = byName.get(name);
    if (!c) continue;
    const lang = plan.lang ?? (c.preferredLanguage as LanguageCode);
    const optedInAt = at(plan.kind === "express" ? plan.daysAgo : plan.optedInDaysAgo, 15);
    const source = plan.kind === "express" ? plan.source : "web";
    const wording =
      source === "web"
        ? webOptInWording(WEB_LANG[lang] ?? "en").full
        : source === "phone"
          ? phoneWording(lang)
          : source === "keyword"
            ? `Texted "JOIN" to ${salon.name}'s promotions number to subscribe (sign at the front desk).`
            : FRONT_DESK[lang as "en-US" | "zh-HK"] ?? FRONT_DESK["en-US"];
    const detail =
      source === "admin" ? { method: "front desk" } : source === "web" ? { form: "online booking", checkbox: "unchecked by default, ticked by the visitor" } : source === "phone" ? { callSid: `CA${c.id.slice(-10)}` } : {};
    await event(c.phone, c.id, "express", source, source === "admin" ? "owner" : source === "phone" ? "agent" : "customer", optedInAt, { wording, language: lang, detail });
    if (plan.kind === "express") {
      await prisma.smsConsent.create({ data: { phone: c.phone, customerId: c.id, status: "express", source, wording, language: lang, consentedAt: optedInAt } });
    } else {
      const w = at(plan.daysAgo, 19);
      await event(c.phone, c.id, "withdrawn", "keyword", "customer", w, { wording: plan.text, language: lang, detail: { channel: "promo", keyword: plan.text } });
      await prisma.smsConsent.create({
        data: { phone: c.phone, customerId: c.id, status: "withdrawn", source: "keyword", wording: plan.text, language: lang, consentedAt: optedInAt, withdrawnAt: w },
      });
    }
  }

  // Implied consent from paid visits (and one that has expired).
  const paid = await prisma.booking.groupBy({ by: ["customerId"], where: { status: "completed", priceCAD: { gt: 0 } }, _max: { start: true } });
  const paidBy = new Map(paid.map((p) => [p.customerId, p._max.start!]));
  for (const c of customers) {
    if (await prisma.smsConsent.findUnique({ where: { phone: c.phone } })) continue;
    const visit = paidBy.get(c.id);
    if (!visit) continue;
    const exp = impliedExpiry(visit);
    const basis = `Paid visit on ${dateKeyOf(visit, SALON_TZ)} (existing business relationship, CASL s. 10(10)). Valid for 2 years.`;
    await event(c.phone, c.id, "implied", "visit", "system", visit, { detail: { basisVisitAt: visit.toISOString(), expiresAt: exp.toISOString() } });
    if (exp > now) {
      await prisma.smsConsent.create({
        data: { phone: c.phone, customerId: c.id, status: "implied", source: "visit", consentedAt: visit, impliedBasis: basis, impliedVisitAt: visit, impliedExpiresAt: exp },
      });
    } else {
      await event(c.phone, c.id, "implied_expired", "system", "system", exp, { detail: { expiredAt: exp.toISOString() } });
      await prisma.smsConsent.create({ data: { phone: c.phone, customerId: c.id, status: "none", impliedBasis: basis, impliedVisitAt: visit, impliedExpiresAt: exp } });
    }
  }

  // Phone assistant asked Raymond Fung; he said no, so it will not ask again.
  const raymond = byName.get("Raymond Fung");
  if (raymond) {
    const d = at(16, 17);
    await prisma.smsConsent.update({ where: { phone: raymond.phone }, data: { phoneAskDeclinedAt: d } });
    await event(raymond.phone, raymond.id, "declined", "phone", "agent", d, { wording: `[Phone assistant, ${salon.name}, zh-HK] "${PHONE_QUESTION["zh-HK"]}" Caller said no.`, language: "zh-HK" });
  }

  // Ryan replied STOP to the appointment number: no appointment texts, reminders by email.
  const ryan = byName.get("Ryan MacDonald");
  if (ryan) {
    const d = at(20, 18);
    await prisma.smsConsent.update({ where: { phone: ryan.phone }, data: { txnOptedOutAt: d } }).catch(async () => {
      await prisma.smsConsent.create({ data: { phone: ryan.phone, customerId: ryan.id, status: "none", txnOptedOutAt: d } });
    });
    await event(ryan.phone, ryan.id, "txn_opted_out", "keyword", "customer", d, { wording: "STOP", detail: { channel: "transactional", keyword: "STOP" } });
    await prisma.notification.create({
      data: {
        kind: "reminder", channel: "email", to: ryan.email ?? "", subject: `Reminder: Men's Haircut at ${salon.name}`, status: "dry_run", reason: "txn_opted_out",
        body: `Hi Ryan MacDonald,\n\n${salon.name}: reminder of your Men's Haircut tomorrow. To change it, call us.`, createdAt: at(9, 10),
      },
    });
  }

  // ---------------------------------------------------------------- past campaign
  const sentAt = at(12, 10);
  const pastBodies = {
    "en-US": "Autumn colour week: 15% off full colour and balayage until Oct 31. Book online or call us.",
    "zh-CN": "秋季染发周：全头染发和挑染85折，至10月31日。欢迎网上预约或来电。",
    "zh-HK": "秋季染髮週：全頭染髮及挑染85折，至10月31日。歡迎網上預約或致電。",
    "ko-KR": "가을 염색 주간: 10월 31일까지 전체 염색과 발레아쥬 15% 할인. 온라인 예약 또는 전화 주세요.",
  } as const;
  const past = await prisma.campaign.create({
    data: {
      name: "Autumn colour week",
      bodies: JSON.stringify(pastBodies),
      audience: JSON.stringify({ type: "all" }),
      includeImplied: false,
      status: "sent",
      scheduledAt: sentAt,
      startedAt: sentAt,
      completedAt: new Date(sentAt.getTime() + 4 * 60000),
      createdAt: new Date(sentAt.getTime() - DAY),
    },
  });
  const consents = await prisma.smsConsent.findMany();
  const consentOf = new Map(consents.map((r) => [r.phone, r]));
  let i = 0;
  const recipients: Customer[] = [];
  for (const c of customers) {
    const row = consentOf.get(c.phone);
    const optedInBefore = row?.status === "express" && row.consentedAt && row.consentedAt < sentAt;
    const lang = (["zh-CN", "zh-HK", "ko-KR"].includes(c.preferredLanguage) ? c.preferredLanguage : "en-US") as keyof typeof pastBodies;
    const text = composePromo(pastBodies[lang], lang);
    const info = countSegments(text);
    let status = "skipped";
    let skipReason: string | null = row?.status === "withdrawn" ? "withdrawn" : row?.status === "implied" ? "implied_excluded" : "no_consent";
    if (row?.status === "express" && !optedInBefore) skipReason = "no_consent";
    if (optedInBefore) {
      status = i === 5 ? "failed" : "delivered";
      skipReason = null;
      i++;
      recipients.push(c);
    }
    const t = new Date(sentAt.getTime() + i * 1500);
    await prisma.campaignMessage.create({
      data: {
        campaignId: past.id, customerId: c.id, phone: c.phone, name: c.name, language: lang, body: text, segments: info.segments, encoding: info.encoding,
        consentType: optedInBefore ? "express" : (row?.status ?? "none"), status, skipReason,
        error: status === "failed" ? "30003: Unreachable destination handset" : null,
        twilioSid: status === "skipped" ? null : `SM${c.id.slice(-12)}${i}`.padEnd(34, "0"),
        sendAfter: sentAt, sentAt: status === "skipped" ? null : t, deliveredAt: status === "delivered" ? new Date(t.getTime() + 4000) : null,
        failedAt: status === "failed" ? new Date(t.getTime() + 9000) : null, createdAt: sentAt,
      },
    });
  }
  // Test send before going out.
  await prisma.campaignMessage.create({
    data: {
      campaignId: past.id, phone: "+16045550190", name: "Test (owner)", language: "en-US", body: composePromo(pastBodies["en-US"], "en-US"),
      segments: 1, encoding: "GSM-7", isTest: true, status: "delivered", sendAfter: new Date(sentAt.getTime() - 3600000),
      sentAt: new Date(sentAt.getTime() - 3600000), deliveredAt: new Date(sentAt.getTime() - 3590000), createdAt: new Date(sentAt.getTime() - 3600000),
    },
  });

  // Paolo replied STOP to the campaign.
  const paolo = byName.get("Paolo Reyes");
  if (paolo) {
    const d = new Date(sentAt.getTime() + 2 * 3600000);
    await event(paolo.phone, paolo.id, "withdrawn", "keyword", "customer", d, { wording: "STOP", language: "en-US", detail: { channel: "promo", keyword: "STOP", campaignId: past.id } });
    await prisma.smsConsent.update({ where: { phone: paolo.phone }, data: { status: "withdrawn", source: "keyword", wording: "STOP", withdrawnAt: d } });
  }
  // Bookings by recipients that the random seed happened to create after the text
  // were really made earlier; keep attribution realistic (a few, chosen below).
  const recipientIds = recipients.map((c) => c.id);
  const after = await prisma.booking.findMany({ where: { customerId: { in: recipientIds }, createdAt: { gt: sentAt } } });
  for (const [k, b] of after.entries()) {
    await prisma.booking.update({ where: { id: b.id }, data: { createdAt: new Date(Math.min(sentAt.getTime(), b.start.getTime()) - (1 + (k % 5)) * DAY) } });
  }
  // A few recipients booked after the text (simple 14 day attribution).
  let attributed = 0;
  for (const c of recipients) {
    if (attributed >= 3 || c.name === "Paolo Reyes") continue;
    const b = await prisma.booking.findFirst({ where: { customerId: c.id, status: { not: "cancelled" }, start: { gt: new Date(sentAt.getTime() + DAY) } }, orderBy: { start: "asc" } });
    if (!b) continue;
    await prisma.booking.update({ where: { id: b.id }, data: { createdAt: new Date(sentAt.getTime() + (attributed + 1) * 0.9 * DAY) } });
    attributed++;
  }
  // A reply that is not a keyword lands in the Messages inbox.
  const kevin = byName.get("Kevin Wong");
  if (kevin) {
    await prisma.message.create({
      data: { callerName: kevin.name, phone: kevin.phone, message: "Text reply to a promotion: 請問星期日下晝有冇位染髮？", urgency: "normal", source: "sms", createdAt: new Date(sentAt.getTime() + 5 * 3600000) },
    });
  }

  // ---------------------------------------------------------------- scheduled campaign
  let d = addDays(dateKeyOf(now, SALON_TZ), 1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 2) d = addDays(d, 1); // next Tuesday
  const scheduledAt = nextAllowedSendTime(zonedTime(d, 10 * 60, SALON_TZ), SALON_TZ);
  await prisma.campaign.create({
    data: {
      name: "We miss you: lapsed clients",
      bodies: JSON.stringify({
        "en-US": "It's been a while! Come back this month for $10 off any cut or colour. Book online or call us.",
        "zh-CN": "好久不见！本月回来剪发或染发立减10加元。欢迎网上预约或来电。",
        "zh-HK": "好耐冇見！本月返嚟剪髮或染髮減10加元。歡迎網上預約或致電。",
        "ko-KR": "오랜만이에요! 이번 달 커트나 염색 시 10달러 할인해 드려요. 온라인 예약 또는 전화 주세요.",
      }),
      audience: JSON.stringify({ type: "lapsed", minDays: 60, maxDays: 120 }),
      includeImplied: true,
      status: "scheduled",
      requestedAt: scheduledAt,
      scheduledAt,
      createdAt: new Date(now.getTime() - 2 * 3600000),
    },
  });

  // A draft the owner started.
  await prisma.campaign.create({
    data: {
      name: "Birthday month treat",
      bodies: JSON.stringify({ "en-US": "Happy birthday month! Enjoy a free deep conditioning treatment with any service this month. Book online or call us." }),
      audience: JSON.stringify({ type: "birthday" }),
      includeImplied: false,
      createdAt: new Date(now.getTime() - 26 * 3600000),
    },
  });

  await prisma.appSetting.create({ data: { key: "sms.ownerPhone", value: "+16045550190" } });
  const counts = await prisma.smsConsent.groupBy({ by: ["status"], _count: true });
  return { counts: Object.fromEntries(counts.map((c) => [c.status, c._count])), attributed };
}
