/* Demo calls for the admin Calls tab: about 25 calls over the last 14 days in
   English, Mandarin, Cantonese and Korean, with a mix of outcomes. Calls that
   booked, moved or cancelled an appointment get a matching phone booking, and
   callback calls link to the seeded Messages. "Henderson Place" is never
   translated. Used by seed.ts and by seed-extras.ts (seed-if-empty on deploy). */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { blocksFor, computeSlots, type BusyBlock, type StaffLite } from "../src/lib/availability";
import { dictionaries } from "../src/lib/i18n/dictionary";
import type { LanguageCode } from "../src/lib/languages";
import { salon, SALON_TZ } from "../src/lib/salon";
import { addDays, dateKeyOf, hhmmToMin, zonedParts, zonedTime } from "../src/lib/time";

const DICT = { "en-US": "en", "zh-CN": "zh", "zh-HK": "hk", "ko-KR": "ko" } as const;
const svcName = (lang: LanguageCode, id: string) =>
  dictionaries[DICT[lang]].serviceNames[id] ?? salon.services.find((s) => s.id === id)?.name ?? id;
const svcEn = (id: string) => salon.services.find((s) => s.id === id)?.name ?? id;

const ZH_WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const KO_WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const EN_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Tuesday, October 6 at 2:30 pm", "10月6日（星期二）下午2:30", "10월 6일 화요일 오후 2시 30분". */
function spokenWhen(d: Date, lang: LanguageCode): string {
  const p = zonedParts(d, SALON_TZ);
  const wd = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const h12 = p.hour % 12 || 12;
  const mm = String(p.minute).padStart(2, "0");
  if (lang === "en-US") return `${EN_WEEK[wd]}, ${EN_MONTH[p.month - 1]} ${p.day} at ${h12}:${mm} ${p.hour < 12 ? "am" : "pm"}`;
  if (lang === "ko-KR") return `${p.month}월 ${p.day}일 ${KO_WEEK[wd]}요일 ${p.hour < 12 ? "오전" : "오후"} ${h12}시${p.minute ? ` ${p.minute}분` : ""}`;
  return `${p.month}月${p.day}日（星期${ZH_WEEK[wd]}）${p.hour < 12 ? "上午" : "下午"}${h12}:${mm}`;
}

type Line = [role: "caller" | "agent", text: string, lang?: LanguageCode];
interface Ctx {
  svc: string; // service name in the call's language
  svcEn: string;
  when: string; // appointment time in the call's language
  whenEn: string;
  first: string;
  stylist: string;
}

interface CallSpec {
  at: { d: number; t: string } | { h: number };
  who: { name: string } | { phone: string | null; name?: string };
  lang: LanguageCode;
  source: "saved" | "detected" | "keypad" | "asked" | "default";
  outcome: "booked" | "rescheduled" | "cancelled" | "message" | "transferred" | "info" | "abandoned" | "spam";
  dur: number;
  sms?: "yes" | "no" | "not-asked";
  transfer?: "answered" | "no-answer" | "busy" | "failed";
  book?: { service: string; inDays: number; hour?: number; cancelled?: boolean };
  message?: boolean; // links the most recent seeded message from this number
  summary: (c: Ctx) => string;
  lines: (c: Ctx) => Line[];
}

const HELLO = "CF Hair Salon at Henderson Place, this is the salon's assistant. How can I help you today?";
const HELLO_AFTER = "CF Hair Salon at Henderson Place. The salon is closed right now, but I can book, move or cancel appointments. How can I help?";

const CALLS: CallSpec[] = [
  {
    at: { h: 2.05 }, who: { phone: "+17785550188", name: "Mrs. Tsang" }, lang: "zh-HK", source: "saved", outcome: "message", dur: 171, sms: "not-asked", message: true,
    summary: () => "Mrs. Tsang asked whether a digital perm suits fine, colour-treated hair. She would like a stylist to call her back before she books.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，我想問吓數碼電髮啱唔啱我。我啲頭髮好幼，之前又染過色。", "zh-HK"],
      ["agent", "明白。幼身又染過嘅頭髮，最好由髮型師親自睇吓髮質先決定。我請髮型師打返畀你，好唔好？", "zh-HK"],
      ["caller", "好呀，唔該。最好今日或者聽日打嚟。", "zh-HK"],
      ["agent", "冇問題，我已經幫你留低口訊，髮型師會盡快覆你。仲有冇其他嘢可以幫到你？", "zh-HK"],
      ["caller", "冇喇，唔該晒。", "zh-HK"],
    ],
  },
  {
    at: { h: 3.4 }, who: { name: "Wei Zhang" }, lang: "zh-CN", source: "saved", outcome: "booked", dur: 146, sms: "not-asked",
    book: { service: "mens-cut", inDays: 2, hour: 14 },
    summary: (c) => `Wei Zhang booked a ${c.svcEn} for ${c.whenEn}. He asked for the same style as last time.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，我想约个剪头发。", "zh-CN"],
      ["agent", `好的，张先生。您想约${c.svc}对吗？${c.when}有空位，可以吗？`, "zh-CN"],
      ["caller", "可以，就那个时间。跟上次一样的发型就行。", "zh-CN"],
      ["agent", `好的，已经帮您约好了：${c.svc}，${c.when}，在Henderson Place店里。我会备注跟上次一样的发型。`, "zh-CN"],
      ["caller", "好，谢谢。", "zh-CN"],
    ],
  },
  {
    at: { h: 5.1 }, who: { name: "Arash Rahimi" }, lang: "en-US", source: "saved", outcome: "message", dur: 94, sms: "not-asked", message: true,
    summary: () => "Arash is running about 20 minutes late for his next appointment and asked whether he should rebook. He wants a quick call back.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hi, it's Arash. I'm stuck on the Lougheed, probably twenty minutes late. Should I just rebook?", "en-US"],
      ["agent", "Thanks for letting us know. I can't tell from here whether your stylist can still fit you in, so I'll ask the salon to call you right away. Is this the best number?", "en-US"],
      ["caller", "Yes, this one. Thanks.", "en-US"],
      ["agent", "Done. I've marked it urgent, so someone will call you in the next few minutes.", "en-US"],
    ],
  },
  {
    at: { h: 6.6 }, who: { phone: null }, lang: "en-US", source: "default", outcome: "info", dur: 52,
    summary: () => "A caller with a withheld number asked about today's hours. Told them 10 am to 6 pm.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hi, are you open today, and until when?", "en-US"],
      ["agent", "Yes, we're open today from 10 am until 6 pm, inside Henderson Place on Pinetree Way. Would you like to book a time?", "en-US"],
      ["caller", "No, I'll just walk in later. Thanks.", "en-US"],
    ],
  },
  {
    at: { h: 9.3 }, who: { phone: "+18885550199" }, lang: "en-US", source: "default", outcome: "spam", dur: 19,
    summary: () => "Recorded sales call about a business listing. Ended the call.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "This is an important message about your business listing. Press one to verify your listing now.", "en-US"],
      ["agent", "This sounds like a recorded sales call, so I'll end it here. Goodbye.", "en-US"],
    ],
  },
  {
    at: { d: 1, t: "10:42" }, who: { name: "Kevin Wong" }, lang: "zh-HK", source: "saved", outcome: "booked", dur: 133, sms: "not-asked",
    book: { service: "mens-cut", inDays: 3, hour: 11 },
    summary: (c) => `Kevin Wong booked a ${c.svcEn} for ${c.whenEn} with ${c.stylist}.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "喂，你好，我想約個時間剪頭髮。", "zh-HK"],
      ["agent", `王生你好。${c.when}有位，同${c.stylist}，${c.svc}，得唔得？`, "zh-HK"],
      ["caller", "得，就咁約。", "zh-HK"],
      ["agent", `幫你約好咗：${c.when}，${c.svc}。我哋喺Henderson Place，記得早五分鐘到。`, "zh-HK"],
      ["caller", "好，唔該晒。", "zh-HK"],
    ],
  },
  {
    at: { d: 1, t: "21:48" }, who: { phone: null }, lang: "en-US", source: "default", outcome: "abandoned", dur: 9,
    summary: () => "The caller hung up during the greeting, after hours.",
    lines: () => [["agent", HELLO_AFTER, "en-US"]],
  },
  {
    at: { d: 2, t: "21:36" }, who: { name: "Min-jun Kim" }, lang: "ko-KR", source: "saved", outcome: "booked", dur: 158, sms: "not-asked",
    book: { service: "down-perm", inDays: 3, hour: 15 },
    summary: (c) => `Min-jun Kim booked a ${c.svcEn} for ${c.whenEn}. Called after hours.`,
    lines: (c) => [
      ["agent", HELLO_AFTER, "en-US"],
      ["caller", "안녕하세요, 다운펌 예약하고 싶어요.", "ko-KR"],
      ["agent", `네, 김민준 님. ${c.when}에 ${c.svc} 가능한데, 괜찮으세요?`, "ko-KR"],
      ["caller", "네, 좋아요. 그 시간으로 해 주세요.", "ko-KR"],
      ["agent", `예약됐습니다. ${c.when}, ${c.svc}이에요. Henderson Place 안에 있는 매장으로 오시면 됩니다.`, "ko-KR"],
      ["caller", "감사합니다.", "ko-KR"],
    ],
  },
  {
    at: { d: 2, t: "12:20" }, who: { name: "Mei Lin Chen" }, lang: "zh-CN", source: "saved", outcome: "transferred", dur: 88, transfer: "answered",
    summary: () => "Mei Lin Chen wanted to talk to her stylist about correcting a colour she had done elsewhere. Transferred to the salon, and the call was answered.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，我上个月在别的地方染了头发，颜色不太对，想问问能不能帮我改一下。", "zh-CN"],
      ["agent", "明白。改颜色需要发型师先看看情况，我现在帮您转接到店里，请稍等。", "zh-CN"],
      ["caller", "好的。", "zh-CN"],
      ["agent", "正在转接，请不要挂断。", "zh-CN"],
    ],
  },
  {
    at: { h: 26.1 }, who: { name: "Grace Huang" }, lang: "zh-CN", source: "saved", outcome: "message", dur: 162, sms: "not-asked", message: true,
    summary: () => "Grace Huang is planning updos for a bridal party of 4 on a Saturday in November and asked about group pricing. She would like a call back.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，我想问一下，十一月有个星期六，我们四个人要做新娘盘发，可以吗？", "zh-CN"],
      ["agent", "可以的。四位一起做盘发，需要先确认那天发型师的时间。您是想问团体价格吗？", "zh-CN"],
      ["caller", "对，有没有团体优惠？", "zh-CN"],
      ["agent", "团体价格要由店主确认。我帮您留个言，请她给您回电话，好吗？", "zh-CN"],
      ["caller", "好的，谢谢。", "zh-CN"],
    ],
  },
  {
    at: { h: 50.1 }, who: { phone: "+16045550177" }, lang: "en-US", source: "default", outcome: "message", dur: 71, sms: "not-asked", message: true,
    summary: () => "Asked whether the salon sells the keratin shampoo used in treatments. No call back needed unless it is in stock.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hi, do you sell the shampoo you use after a keratin treatment?", "en-US"],
      ["agent", "I'm not sure what's in stock right now. I can leave a note for the salon. Would you like a call back?", "en-US"],
      ["caller", "Only if you have it. Otherwise don't worry about it.", "en-US"],
      ["agent", "Got it. I'll pass that on.", "en-US"],
    ],
  },
  {
    at: { d: 3, t: "10:05" }, who: { name: "Margaret Wilson" }, lang: "en-US", source: "saved", outcome: "booked", dur: 204, sms: "no",
    book: { service: "senior-cut", inDays: 4, hour: 10 },
    summary: (c) => `Margaret Wilson booked a ${c.svcEn} for ${c.whenEn}. She said no to promotional texts.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hello dear, I'd like to come in for my usual trim, please. Mornings are best for me.", "en-US"],
      ["agent", `Of course, Margaret. I have ${c.whenEn} for a ${c.svcEn}. Would that work?`, "en-US"],
      ["caller", "That's lovely, yes.", "en-US"],
      ["agent", `You're booked for ${c.whenEn}. One more thing: would you like the occasional text about specials? You can reply STOP any time.`, "en-US"],
      ["caller", "No thank you, I don't really do texts.", "en-US"],
      ["agent", "No problem, I won't ask again. See you then!", "en-US"],
    ],
  },
  {
    at: { d: 3, t: "16:12" }, who: { name: "Seo-yeon Lee" }, lang: "en-US", source: "saved", outcome: "booked", dur: 176, sms: "yes",
    book: { service: "highlights", inDays: 6, hour: 11 },
    summary: (c) => `Seo-yeon Lee booked ${c.svcEn} for ${c.whenEn} with ${c.stylist}. She agreed to promotional texts.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hi! My friend Ji-woo recommended you. I'd like full highlights.", "en-US"],
      ["agent", `Lovely. Highlights take about two and a half hours. ${c.stylist} is free ${c.whenEn}. Shall I book that?`, "en-US"],
      ["caller", "Perfect.", "en-US"],
      ["agent", "You're booked. Would you like the occasional text about specials? You can reply STOP any time.", "en-US"],
      ["caller", "Sure, that's fine.", "en-US"],
    ],
  },
  {
    at: { d: 4, t: "11:30" }, who: { name: "Raymond Fung" }, lang: "zh-HK", source: "saved", outcome: "booked", dur: 189, sms: "yes",
    book: { service: "senior-cut", inDays: 2, hour: 13 },
    summary: (c) => `Raymond Fung booked a ${c.svcEn} for ${c.whenEn}. He agreed to promotional texts.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，我想剪頭髮，長者剪髮。", "zh-HK"],
      ["agent", `馮生你好。${c.when}有位，可以嗎？`, "zh-HK"],
      ["caller", "可以，下晝好。", "zh-HK"],
      ["agent", "幫你約好咗。另外，你想唔想間中收到我哋優惠嘅短訊？你隨時可以回覆STOP取消。", "zh-HK"],
      ["caller", "好呀，可以。", "zh-HK"],
      ["agent", "收到，多謝你。到時見！", "zh-HK"],
    ],
  },
  {
    at: { d: 4, t: "18:25" }, who: { phone: "+18885550199" }, lang: "en-US", source: "default", outcome: "spam", dur: 14,
    summary: () => "Same recorded business-listing call as earlier this week. Ended the call.",
    lines: () => [
      ["agent", HELLO_AFTER, "en-US"],
      ["caller", "Your business listing is about to expire. Press one now.", "en-US"],
      ["agent", "This is a recorded sales call, so I'm ending it. Goodbye.", "en-US"],
    ],
  },
  {
    at: { d: 5, t: "14:02" }, who: { name: "Ka Yan Leung" }, lang: "zh-HK", source: "saved", outcome: "rescheduled", dur: 141,
    book: { service: "root-colour", inDays: 5, hour: 12 },
    summary: (c) => `Ka Yan Leung moved her ${c.svcEn} to ${c.whenEn} because of a work trip.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，我要出差，想改期補染。", "zh-HK"],
      ["agent", `冇問題，梁小姐。${c.when}得唔得？`, "zh-HK"],
      ["caller", "得，唔該。", "zh-HK"],
      ["agent", `改好咗：${c.svc}，${c.when}。原本嗰個時間已經取消。`, "zh-HK"],
    ],
  },
  {
    at: { d: 5, t: "17:40" }, who: { name: "Tony Lam" }, lang: "zh-HK", source: "saved", outcome: "info", dur: 63,
    summary: () => "Tony Lam asked whether the salon is open on Sundays. Told him 12 to 6 pm.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，請問星期日開唔開？", "zh-HK"],
      ["agent", "星期日有開，由中午十二點到六點，喺Henderson Place入面。使唔使幫你約時間？", "zh-HK"],
      ["caller", "唔使住，我再打嚟。", "zh-HK"],
    ],
  },
  {
    at: { d: 6, t: "13:18" }, who: { name: "Ji-woo Park" }, lang: "ko-KR", source: "saved", outcome: "booked", dur: 167, sms: "no",
    book: { service: "womens-cut", inDays: 4, hour: 16 },
    summary: (c) => `Ji-woo Park booked a ${c.svcEn} for ${c.whenEn}. She said no to promotional texts.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "안녕하세요, 커트 예약하려고요.", "ko-KR"],
      ["agent", `네, 박지우 님. ${c.when} 괜찮으세요?`, "ko-KR"],
      ["caller", "네, 그때 갈게요.", "ko-KR"],
      ["agent", "예약됐습니다. 혹시 가끔 할인 소식을 문자로 받아보시겠어요? 언제든지 STOP으로 회신하시면 중단됩니다.", "ko-KR"],
      ["caller", "아니요, 괜찮아요.", "ko-KR"],
      ["agent", "알겠습니다. 다시 여쭤보지 않을게요. 감사합니다!", "ko-KR"],
    ],
  },
  {
    at: { d: 6, t: "15:44" }, who: { name: "Hana Choi" }, lang: "ko-KR", source: "detected", outcome: "info", dur: 98,
    summary: () => "Hana Choi asked how much a digital perm costs and how long it takes. Told her from $220 and about 3 hours.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "안녕하세요, 디지털 펌 가격이 얼마예요?", "ko-KR"],
      ["agent", "디지털 펌은 220달러부터이고, 3시간 정도 걸려요. 머리가 길면 추가 요금이 있어요.", "ko-KR"],
      ["caller", "아, 네. 생각해 보고 다시 전화할게요.", "ko-KR"],
      ["agent", "네, 언제든지 전화 주세요. Henderson Place 안에 있어요.", "ko-KR"],
    ],
  },
  {
    at: { d: 7, t: "10:16" }, who: { name: "Harjit Gill" }, lang: "en-US", source: "saved", outcome: "cancelled", dur: 58,
    book: { service: "mens-cut", inDays: 1, hour: 17, cancelled: true },
    summary: (c) => `Harjit Gill cancelled his ${c.svcEn} on ${c.whenEn}. He will call again to rebook.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hey, I need to cancel my haircut tomorrow, something came up.", "en-US"],
      ["agent", `No problem. I've cancelled your ${c.svcEn} on ${c.whenEn}. Want to pick another time?`, "en-US"],
      ["caller", "Not yet, I'll call back.", "en-US"],
    ],
  },
  {
    at: { d: 8, t: "11:52" }, who: { phone: "+16045550231" }, lang: "zh-CN", source: "detected", outcome: "info", dur: 121,
    summary: () => "A new caller asked, in Mandarin, about digital perm prices and parking. Told them from $220 and that Henderson Place has parking.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，请问你们做数码烫吗？多少钱？", "zh-CN"],
      ["agent", "做的。数码烫220加元起，大概需要三个小时，长发会加一点。", "zh-CN"],
      ["caller", "停车方便吗？", "zh-CN"],
      ["agent", "Henderson Place有停车场，我们就在商场里面。", "zh-CN"],
      ["caller", "好的，谢谢，我再考虑一下。", "zh-CN"],
    ],
  },
  {
    at: { d: 9, t: "13:07" }, who: { phone: "+17785550242" }, lang: "en-US", source: "default", outcome: "info", dur: 47,
    summary: () => "A caller asked for directions. Told them the salon is inside Henderson Place on Pinetree Way.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hi, where exactly are you? I'm near Coquitlam Centre.", "en-US"],
      ["agent", "We're inside Henderson Place at 1163 Pinetree Way, unit 2140. From Coquitlam Centre it's a short walk.", "en-US"],
      ["caller", "Great, thanks.", "en-US"],
    ],
  },
  {
    at: { d: 9, t: "16:31" }, who: { name: "Paolo Reyes" }, lang: "en-US", source: "saved", outcome: "abandoned", dur: 26,
    summary: () => "Paolo Reyes hung up while the assistant was checking times.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hey, can I get a cut this afternoon?", "en-US"],
      ["agent", "Let me check this afternoon for you...", "en-US"],
    ],
  },
  {
    at: { d: 10, t: "12:48" }, who: { name: "Daniel Ho" }, lang: "zh-HK", source: "keypad", outcome: "transferred", dur: 112, transfer: "no-answer",
    summary: () => "Daniel Ho asked to speak to someone about a perm for an event. The transfer was not answered; he said he would call back tomorrow.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["agent", "For Mandarin, press 2. For Cantonese, press 3. For Korean, press 4.", "en-US"],
      ["caller", "你好，我想搵髮型師傾吓電髮，下個月有個婚禮。", "zh-HK"],
      ["agent", "好，我幫你轉駁去店入面，請等等。", "zh-HK"],
      ["agent", "唔好意思，店入面暫時冇人聽電話。你想留口訊，定係遲啲再打嚟？", "zh-HK"],
      ["caller", "我聽日再打啦。", "zh-HK"],
    ],
  },
  {
    at: { d: 11, t: "17:55" }, who: { phone: null }, lang: "en-US", source: "default", outcome: "spam", dur: 23,
    summary: () => "Duct cleaning sales call from a withheld number. Ended the call.",
    lines: () => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hi, we're doing duct cleaning in your area this week, special price for businesses.", "en-US"],
      ["agent", "Thanks, but the salon isn't interested. Goodbye.", "en-US"],
    ],
  },
  {
    at: { d: 12, t: "11:14" }, who: { name: "Chloe Yeung" }, lang: "zh-HK", source: "saved", outcome: "booked", dur: 128, sms: "not-asked",
    book: { service: "womens-cut", inDays: 6, hour: 14 },
    summary: (c) => `Chloe Yeung booked a ${c.svcEn} for ${c.whenEn}. Not asked about texts because she opted out earlier.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "你好，我想約剪頭髮。", "zh-HK"],
      ["agent", `楊小姐你好。${c.when}，${c.svc}，可以嗎？`, "zh-HK"],
      ["caller", "可以。", "zh-HK"],
      ["agent", "約好咗，到時Henderson Place見。", "zh-HK"],
    ],
  },
  {
    at: { d: 13, t: "15:26" }, who: { name: "Emily Thompson" }, lang: "en-US", source: "saved", outcome: "booked", dur: 117, sms: "not-asked",
    book: { service: "root-colour", inDays: 5, hour: 10 },
    summary: (c) => `Emily Thompson booked a ${c.svcEn} for ${c.whenEn} with ${c.stylist}.`,
    lines: (c) => [
      ["agent", HELLO, "en-US"],
      ["caller", "Hi, my roots are showing again. Can I book a touch-up with my usual stylist?", "en-US"],
      ["agent", `Of course. ${c.stylist} has ${c.whenEn}. Does that suit you?`, "en-US"],
      ["caller", "Yes please.", "en-US"],
      ["agent", "You're all set. See you then, Emily.", "en-US"],
    ],
  },
];

const DAY = 86400000;

function callTime(spec: CallSpec, now: Date): Date {
  if ("h" in spec.at) return new Date(now.getTime() - spec.at.h * 3600000);
  const key = dateKeyOf(new Date(now.getTime() - spec.at.d * DAY), SALON_TZ);
  return zonedTime(key, hhmmToMin(spec.at.t), SALON_TZ);
}

/** Phones that only the demo seed uses; seedCalls needs these demo clients to exist. */
export const DEMO_CALL_CLIENTS = [...new Set(CALLS.flatMap((c) => ("name" in c.who && !("phone" in c.who) ? [c.who.name] : [])))];

export async function seedCalls(prisma: PrismaClient, now = new Date()): Promise<number> {
  const customers = await prisma.customer.findMany({ where: { name: { in: DEMO_CALL_CLIENTS } } });
  const byName = new Map(customers.map((c) => [c.name, c]));
  const staffRows = await prisma.staff.findMany({ include: { services: true }, orderBy: { sortOrder: "asc" } });
  const staff: StaffLite[] = staffRows.map((s) => ({ id: s.id, name: s.name, serviceIds: s.services.map((x) => x.serviceId) }));
  const services = new Map((await prisma.service.findMany()).map((s) => [s.id, s]));
  const existing = await prisma.booking.findMany({
    where: { status: { not: "cancelled" }, start: { gte: new Date(now.getTime() - 20 * DAY), lte: new Date(now.getTime() + 20 * DAY) } },
    select: { id: true, staffId: true, start: true, end: true },
  });
  const busy: BusyBlock[] = existing.map((b) => ({ ...b }));
  // The usual stylist from the client's last completed visit, if any.
  const lastStaff = async (customerId: string) =>
    (await prisma.booking.findFirst({ where: { customerId, status: "completed" }, orderBy: { start: "desc" } }))?.staffId;

  let created = 0;
  for (const [i, spec] of CALLS.entries()) {
    const startedAt = callTime(spec, now);
    if (startedAt > now) continue;
    const named = "name" in spec.who && !("phone" in spec.who) ? byName.get(spec.who.name) : undefined;
    if ("name" in spec.who && !("phone" in spec.who) && !named) continue; // demo client missing
    const phone = named ? named.phone : "phone" in spec.who ? spec.who.phone : null;
    const customer = named ?? (phone ? await prisma.customer.findUnique({ where: { phone } }) : null);

    const ctx: Ctx = { svc: "", svcEn: "", when: "", whenEn: "", first: customer ? customer.name.split(" ").slice(0, -1).join(" ") || customer.name : "", stylist: "" };
    let bookingId: string | null = null;
    if (spec.book && customer) {
      const svc = services.get(spec.book.service);
      const wanted = await lastStaff(customer.id);
      if (svc) {
        let picked: { start: Date; end: Date; staffId: string } | null = null;
        for (let k = 0; k < 8 && !picked; k++) {
          const date = addDays(dateKeyOf(startedAt, SALON_TZ), spec.book.inDays + k);
          const slots = computeSlots({
            date, serviceId: svc.id, durationMin: svc.durationMin, staff, bookings: busy, hours: salon.hours, tz: SALON_TZ,
            now: zonedTime(date, 0, SALON_TZ),
          });
          const hourOf = (d: Date) => zonedParts(d, SALON_TZ).hour;
          const pref = slots.filter((s) => s.staffId === wanted);
          const pool = pref.length ? pref : slots;
          picked = pool.find((s) => hourOf(s.start) === (spec.book!.hour ?? 11) && s.start.getUTCMinutes() % 30 === 0) ?? pool.find((s) => s.start.getUTCMinutes() === 0) ?? pool[0] ?? null;
        }
        if (picked) {
          const cancelled = !!spec.book.cancelled;
          const status = cancelled ? "cancelled" : picked.end <= now ? "completed" : "confirmed";
          const booking = await prisma.booking.create({
            data: {
              serviceId: svc.id, staffId: picked.staffId, customerId: customer.id, start: picked.start, end: picked.end,
              status, source: "phone", priceCAD: svc.priceCAD, createdAt: new Date(startedAt.getTime() + spec.dur * 1000),
            },
          });
          if (!cancelled) {
            busy.push({ id: booking.id, staffId: picked.staffId, start: picked.start, end: picked.end });
            await prisma.slotLock.createMany({ data: blocksFor(picked.start, picked.end).map((slotStart) => ({ staffId: picked!.staffId, slotStart, bookingId: booking.id })) });
          }
          bookingId = booking.id;
          ctx.svc = svcName(spec.lang, svc.id);
          ctx.svcEn = svcEn(svc.id);
          ctx.when = spokenWhen(picked.start, spec.lang);
          ctx.whenEn = spokenWhen(picked.start, "en-US");
          ctx.stylist = staff.find((s) => s.id === picked!.staffId)?.name ?? "";
        }
      }
      if (!bookingId) continue; // no free time found: skip rather than show a booking that does not exist
    }

    let messageId: string | null = null;
    if (spec.message && phone) {
      const m = await prisma.message.findFirst({ where: { phone }, orderBy: { createdAt: "desc" } });
      messageId = m?.id ?? null;
    }

    const lines = spec.lines(ctx);
    const step = spec.dur / Math.max(lines.length, 1);
    const transcript = lines.map(([role, text, lang], k) => ({
      role, text, lang: lang ?? spec.lang, at: new Date(startedAt.getTime() + Math.round(k * step) * 1000).toISOString(),
    }));
    const callSid = `CA${createHash("md5").update(`cf-demo-call-${i}`).digest("hex")}`;
    await prisma.call.upsert({
      where: { callSid },
      update: {},
      create: {
        callSid,
        fromPhone: phone,
        customerId: customer?.id ?? null,
        startedAt,
        endedAt: new Date(startedAt.getTime() + spec.dur * 1000),
        durationSec: spec.dur,
        language: spec.lang,
        languageSource: spec.source,
        outcome: spec.outcome,
        summary: spec.summary(ctx),
        bookingId,
        messageId,
        transferResult: spec.transfer ?? null,
        smsConsent: spec.sms ?? null,
        transcript: JSON.stringify(transcript),
        createdAt: new Date(startedAt.getTime() + spec.dur * 1000),
      },
    });
    created++;
  }
  // One older call whose transcript was already cleared (retention), to show how that looks.
  const oldSid = `CA${createHash("md5").update("cf-demo-call-old").digest("hex")}`;
  const kevin = byName.get("Kevin Wong");
  if (kevin) {
    const startedAt = zonedTime(dateKeyOf(new Date(now.getTime() - 120 * DAY), SALON_TZ), 11 * 60 + 9, SALON_TZ);
    await prisma.call.upsert({
      where: { callSid: oldSid },
      update: {},
      create: {
        callSid: oldSid, fromPhone: kevin.phone, customerId: kevin.id, startedAt, endedAt: new Date(startedAt.getTime() + 84000), durationSec: 84,
        language: "zh-HK", languageSource: "asked", outcome: "info",
        summary: "Kevin Wong asked whether the salon does Korean down perms. Told him yes, about 45 minutes.",
        transcript: null, transcriptClearedAt: new Date(startedAt.getTime() + 90 * DAY), createdAt: startedAt,
      },
    });
    created++;
  }
  return created;
}
