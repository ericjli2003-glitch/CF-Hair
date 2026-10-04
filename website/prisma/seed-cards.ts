/* Demo handwritten cards for the admin Cards tab: one pending "We miss you" batch
   of 8 cards for lapsed clients (two in template "sample" text, three with a
   Chinese or Korean line written by hand at the salon), and one batch of
   first-visit thank-you cards already mailed (four sent, one failed). Consistent
   with the clients in seed.ts. Used by seed.ts and seed-extras.ts. */
import type { PrismaClient } from "@prisma/client";
import type { MailingAddress } from "../src/lib/customers";
import { parseAddress } from "../src/lib/customers";

const DAY = 86400000;

interface CardSpec {
  name: string;
  alt?: "zh-CN" | "zh-HK" | "ko-KR";
  mock?: boolean;
  address?: MailingAddress; // used when the client has none on file
  message: (c: { first: string; service: string }) => string;
  messageAlt?: (c: { first: string; service: string }) => string;
}

const BC = (line1: string, city: string, postalCode: string, line2?: string): MailingAddress => ({ line1, ...(line2 ? { line2 } : {}), city, province: "BC", postalCode, country: "CA" });

const MOCK_TEXT = ({ first, service }: { first: string; service: string }) =>
  `Dear ${first},\nIt has been a little while since your ${service.replace(/\s*\(.*\)/, "").toLowerCase()}, and we hope you are doing well. Whenever you are ready for a refresh, we would love to see you again at Henderson Place.\nWarmly,\nCF Hair Salon`;

const WIN_BACK: CardSpec[] = [
  {
    name: "Hana Choi", alt: "ko-KR", address: BC("3080 Lincoln Ave", "Coquitlam", "V3B 0L9", "Unit 1207"),
    message: ({ first, service }) => `Dear ${first},\nWe were thinking of you and that lovely ${service.toLowerCase()}. It has been too long! Come and see us at Henderson Place whenever you like, your chair is waiting.\nWarmly,\nCF Hair Salon`,
    messageAlt: ({ first }) => `${first}님, 오랜만이에요. 보고 싶었어요. 편하실 때 Henderson Place로 놀러 오세요.`,
  },
  {
    name: "Raymond Fung", alt: "zh-HK", address: BC("1190 Pipeline Rd", "Coquitlam", "V3B 4S1", "#504"),
    message: ({ first }) => `Dear ${first},\nWe have missed your visits and our chats about the Canucks. Whenever you are ready for a tidy-up, just call and we will find you a quiet morning time.\nWith best wishes,\nCF Hair Salon`,
    messageAlt: ({ first }) => `${first}先生：好耐冇見，好掛住你。得閒隨時嚟Henderson Place坐吓。`,
  },
  {
    name: "Ka Yan Leung", alt: "zh-HK",
    message: ({ first, service }) => `Dear ${first},\nThank you for being with us for so long. We hope your ${service.toLowerCase()} has been easy to look after. When you would like a refresh, we will save you a good time.\nWarmly,\nCF Hair Salon`,
    messageAlt: ({ first }) => `親愛的${first}：多謝你一直支持。想整理頭髮，隨時歡迎回來Henderson Place。`,
  },
  {
    name: "Grace Huang", alt: "zh-CN",
    message: ({ first }) => `Dear ${first},\nWe hope the wedding planning is going well! Whenever you would like a trim before the big day, we would be happy to see you again.\nWarmly,\nCF Hair Salon`,
    messageAlt: ({ first }) => `${first}您好：好久不见，很想念您。欢迎随时回到Henderson Place。`,
  },
  {
    name: "Seo-yeon Lee",
    message: ({ first, service }) => `Dear ${first},\nThank you again for trusting us with your ${service.toLowerCase()}. We hope it is still making you smile. Come back any time for a gloss or a trim, we would love to see you.\nWarmly,\nCF Hair Salon`,
  },
  {
    name: "Shirin Moradi",
    message: ({ first }) => `Dear ${first},\nIt has been a few months and we miss seeing you! If you are ready for something new, or just a fresh cut, we would be glad to make time for you.\nWarmly,\nCF Hair Salon`,
  },
  { name: "Linh Nguyen", mock: true, message: MOCK_TEXT },
  { name: "Priya Sharma", mock: true, message: MOCK_TEXT },
];

const THANKS: (CardSpec & { failed?: string })[] = [
  {
    name: "Maria Santos",
    message: ({ first }) => `Dear ${first},\nThank you for choosing CF Hair Salon. It was a pleasure meeting you, and we hope you love your new look. See you next time!\nWarmly,\nCF Hair Salon`,
  },
  {
    name: "Emily Thompson",
    message: ({ first }) => `Dear ${first},\nThank you for coming in! We loved working on your colour and hope it is turning heads. See you for your next touch-up.\nWarmly,\nCF Hair Salon`,
  },
  {
    name: "Jasmine Liu",
    message: ({ first }) => `Dear ${first},\nThank you for visiting, and thank Mei Lin for sending you our way! It was lovely to meet you.\nWarmly,\nCF Hair Salon`,
  },
  {
    name: "Mei Lin Chen", alt: "zh-CN",
    message: ({ first }) => `Dear ${first},\nThank you for always sending friends our way. It means a great deal to a small salon like ours.\nWarmly,\nCF Hair Salon`,
    messageAlt: ({ first }) => `${first}您好：谢谢您一直介绍朋友来，我们非常感激。`,
  },
  {
    name: "Margaret Wilson", failed: "Address could not be verified by the provider (postal code does not match the street).",
    message: ({ first }) => `Dear ${first},\nThank you for your visit. It is always a treat to see you, and we look forward to your next appointment.\nWith best wishes,\nCF Hair Salon`,
  },
];

export const DEMO_CARD_CLIENTS = [...WIN_BACK, ...THANKS].map((c) => c.name);

export async function seedCards(prisma: PrismaClient, now = new Date()): Promise<number> {
  const customers = await prisma.customer.findMany({ where: { name: { in: DEMO_CARD_CLIENTS } } });
  const byName = new Map(customers.map((c) => [c.name, c]));

  async function cardData(spec: CardSpec, campaignId: string, maxChars: number, cardDesign: string) {
    const c = byName.get(spec.name);
    if (!c) return null;
    const address = parseAddress(c.mailingAddress) ?? spec.address;
    if (!address) return null;
    const last = await prisma.booking.findFirst({
      where: { customerId: c.id, status: "completed" },
      orderBy: { start: "desc" },
      include: { service: true, staff: true },
    });
    const vars = { first: c.name.split(" ").slice(0, -1).join(" ") || c.name, service: last?.service.name ?? "last visit" };
    return {
      campaignId,
      clientRef: c.id,
      customerId: c.id,
      name: c.name,
      mailingAddress: JSON.stringify(address),
      stylistName: last?.staff.name ?? "Stylist A",
      lastServiceName: last?.service.name ?? null,
      cardDesign,
      message: spec.message(vars),
      messageAlt: spec.messageAlt?.(vars) ?? null,
      altLanguage: spec.alt ?? null,
      maxChars,
      mock: !!spec.mock,
    };
  }

  let created = 0;
  // Pending: generated yesterday by the notes pipeline, waiting for the owner.
  const generatedAt = new Date(now.getTime() - DAY);
  const pending = await prisma.cardBatch.create({
    data: { campaignId: "win-back", campaignName: "We miss you", occasion: "Win-back for clients who have not visited in a while", generatedAt, mock: false, createdAt: generatedAt },
  });
  for (const [i, spec] of WIN_BACK.entries()) {
    const data = await cardData(spec, "win-back", 380, "cf-thinking-of-you");
    if (!data) continue;
    await prisma.card.create({ data: { ...data, batchId: pending.id, createdAt: new Date(generatedAt.getTime() + i * 1000) } });
    created++;
  }

  // Sent: approved two days ago and mailed by Handwrytten the same afternoon.
  const gen2 = new Date(now.getTime() - 4 * DAY);
  const approvedAt = new Date(now.getTime() - 2 * DAY - 3 * 3600000);
  const sentAt = new Date(now.getTime() - 2 * DAY);
  const sent = await prisma.cardBatch.create({
    data: { campaignId: "first-visit-thanks", campaignName: "Thank you for visiting", occasion: "Thank-you note after a first visit or a referral", generatedAt: gen2, mock: false, createdAt: gen2 },
  });
  for (const [i, spec] of THANKS.entries()) {
    const data = await cardData(spec, "first-visit-thanks", 380, "cf-thank-you");
    if (!data) continue;
    const outcome = spec.failed
      ? { status: "failed", provider: "handwrytten", failedAt: sentAt, error: spec.failed }
      : { status: "sent", provider: "handwrytten", providerOrderId: `HW-${48213 + i}`, sentAt, costCAD: 7.74 };
    await prisma.card.create({ data: { ...data, ...outcome, batchId: sent.id, approvedAt, createdAt: new Date(gen2.getTime() + i * 1000) } });
    created++;
  }
  return created;
}
