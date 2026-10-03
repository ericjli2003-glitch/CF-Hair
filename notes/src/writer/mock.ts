/**
 * Deterministic template writer used when ANTHROPIC_API_KEY is not set.
 * Output is clearly labelled "mock" in the run manifest, CSV and proof sheet.
 * It exists so the demo and tests run offline; it is not what gets mailed.
 */
import { emptyUsage, type Draft, type DraftRequest, type NoteWriter } from "./types.js";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** "Highlights (Full Foil)" -> "highlights", "Korean Down Perm" -> "Korean down perm". */
export function serviceNoun(name: string | null | undefined): string {
  if (!name) return "visit";
  return name
    .replace(/\s*\(.*?\)\s*/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w === "Korean" ? w : w.toLowerCase()))
    .join(" ");
}

const ZH_SERVICE: Record<string, string> = {
  "mens-cut": "剪发",
  "womens-cut": "剪发",
  "kids-cut": "剪发",
  "senior-cut": "剪发",
  "wash-blowdry": "洗吹造型",
  updo: "盘发造型",
  braiding: "编发",
  "root-colour": "发根补染",
  "full-colour": "染发",
  highlights: "挑染",
  balayage: "手刷挑染",
  "mens-perm": "男士烫发",
  "down-perm": "韩式压贴烫",
  "digital-perm": "数码烫",
  straightening: "离子烫",
  keratin: "角蛋白护理",
  "scalp-treatment": "头皮护理",
};

type Fill = { name: string; stylist: string; service: string; offer: string; friend: string; zhService: string };
type Tpl = (f: Fill) => string;

const EN: Record<string, Tpl[]> = {
  "first-visit-thanks": [
    (f) => `Dear ${f.name},\nthank you for choosing us for your first visit. It was a real pleasure doing your ${f.service}, and I hope it is feeling great at home. If you have a moment, a Google review means a lot to a small neighbourhood salon like ours. I hope to see you again soon.`,
    (f) => `Hi ${f.name},\nthank you for trusting us with your ${f.service}. I loved meeting you and hope you are enjoying the result. Whenever you are ready for the next one, we would be so glad to see you back at CF Hair.`,
  ],
  birthday: [
    (f) => `Hi ${f.name},\nhappy birthday from all of us at CF Hair! I hope your day is full of good food and good people. Your next visit comes with a little birthday treat from us: just mention ${f.offer || "your birthday"} when you come in.`,
    (f) => `Dear ${f.name},\nwishing you the happiest birthday and a wonderful year ahead. Thank you for being part of our salon family. ${f.offer ? `Mention ${f.offer} at your next visit for a small treat from the team.` : "We hope to celebrate with you soon."}`,
  ],
  "win-back": [
    (f) => `Hi ${f.name},\nI was thinking about your ${f.service} the other day and hope it has been treating you well. Whenever you feel like a refresh, your chair is here. ${f.offer ? `As a small welcome back, ${f.offer} takes 15% off your next visit.` : "It would be lovely to see you."}`,
    (f) => `Dear ${f.name},\nI hope life has been treating you well since your last ${f.service}. Whenever you are ready for a refresh, we would love to see you back in the salon. ${f.offer ? `${f.offer} is a little welcome-back gift from us.` : ""}`.trim(),
  ],
  "loyal-regulars": [
    (f) => `Dear ${f.name},\nI just wanted to say thank you. Having you in my chair is one of the best parts of my week, and I really appreciate you trusting me with your ${f.service}. If you ever have a moment, a Google review helps a small salon like ours more than you know.`,
  ],
  "referral-thanks": [
    (f) => `Hi ${f.name},\nthank you so much for sending ${f.friend} our way. Word of mouth from clients like you is how a small neighbourhood salon grows, and it means a lot to all of us. See you at your next visit.`,
  ],
  "lunar-new-year": [
    (f) => `Dear ${f.name},\nwishing you and your family a happy Lunar New Year! May the Year of the Goat bring you good health, peace and plenty of good fortune. Thank you for being part of the CF Hair family.`,
  ],
  holiday: [
    (f) => `Dear ${f.name},\nwarm wishes for the holidays from all of us at CF Hair. Thank you for spending part of your year with us. We hope the season brings you rest, good food and time with the people you love.`,
  ],
};

const ZH: Record<string, Tpl[]> = {
  "first-visit-thanks": [(f) => `亲爱的${f.name}：\n谢谢你第一次来CF Hair。很高兴为你做${f.zhService}，希望你在家也一样喜欢。如果方便，留一条谷歌评价对我们小店帮助很大。期待再见到你。`],
  birthday: [(f) => `亲爱的${f.name}：\n祝你生日快乐！愿你新的一岁平安顺心，天天开心。${f.offer ? `下次来店时报上${f.offer}，有一份小小的生日礼物等着你。` : ""}`],
  "win-back": [(f) => `亲爱的${f.name}：\n好久不见，很想念你。希望上次的${f.zhService}一直好打理。什么时候想整理一下，随时欢迎回来。${f.offer ? `凭${f.offer}下次可享八五折。` : ""}`],
  "loyal-regulars": [(f) => `亲爱的${f.name}：\n谢谢你一直以来的信任和支持。每次为你做${f.zhService}都很开心。如果方便，留一条谷歌评价对我们小店帮助很大。`],
  "referral-thanks": [(f) => `亲爱的${f.name}：\n非常感谢你介绍${f.friend}来我们店。像你这样的朋友口口相传，是我们小店最大的支持。下次见！`],
  "lunar-new-year": [(f) => `亲爱的${f.name}：\n祝你和家人新春快乐，羊年吉祥！身体健康，万事如意。谢谢你一直以来的支持。`],
  holiday: [(f) => `亲爱的${f.name}：\n节日快乐！谢谢你这一年的陪伴和支持，祝你假期愉快，新年顺心。`],
};

export class MockWriter implements NoteWriter {
  readonly name = "mock";
  readonly mock = true;
  readonly usage = emptyUsage();

  async draftMany(reqs: DraftRequest[]): Promise<Map<string, Draft>> {
    const out = new Map<string, Draft>();
    for (const r of reqs) {
      const id = r.meta.campaignId;
      const en = EN[id] ?? EN["loyal-regulars"];
      const zh = ZH[id] ?? ZH["loyal-regulars"];
      const h = hash(r.id);
      const f: Fill = {
        name: r.ctx.client_first_name,
        stylist: r.ctx.stylist_first_name ?? "",
        service: serviceNoun(r.ctx.last_service),
        offer: r.ctx.offer?.code ?? "",
        friend: r.ctx.occasion_details.referred_friend_first_name ?? "your friend",
        zhService: (r.meta.serviceId && ZH_SERVICE[r.meta.serviceId]) || "造型",
      };
      out.set(r.id, {
        message: en[h % en.length](f),
        messageZh: r.ctx.write_chinese_version ? zh[h % zh.length](f) : "",
      });
    }
    return out;
  }
}
