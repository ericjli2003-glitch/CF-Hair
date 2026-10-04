// Website language to customer language: the mapping, the rule that the site
// language only fills in a new or default preference, the zh-HK consent wording,
// and the Traditional Chinese (hk) dictionary.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "@/lib/bookings";
import { prisma } from "@/lib/db";
import { dictionaries, HTML_LANG, LANG_LABELS, LANGS } from "@/lib/i18n/dictionary";
import { bookingToIcs } from "@/lib/ics";
import {
  languageForSiteLang,
  preferredLanguageAfterWebBooking,
  SITE_LANG_TO_LANGUAGE,
} from "@/lib/languages";
import { webOptInWording } from "@/lib/sms/web-consent";

const now = new Date("2030-01-01T00:00:00Z");
const START = "2030-01-07T11:00:00-08:00"; // Monday

describe("site language to customer language", () => {
  it("maps every site language", () => {
    expect(SITE_LANG_TO_LANGUAGE).toEqual({ en: "en-US", zh: "zh-CN", hk: "zh-HK", ko: "ko-KR" });
    expect(Object.keys(SITE_LANG_TO_LANGUAGE).sort()).toEqual([...LANGS].sort());
    expect(languageForSiteLang("hk")).toBe("zh-HK");
    expect(languageForSiteLang("zh-HK")).toBeNull();
    expect(languageForSiteLang(undefined)).toBeNull();
  });

  it("fills in a missing or default preference and never replaces an explicit one", () => {
    expect(preferredLanguageAfterWebBooking(undefined, "zh-HK")).toBe("zh-HK");
    expect(preferredLanguageAfterWebBooking("en-US", "zh-HK")).toBe("zh-HK");
    expect(preferredLanguageAfterWebBooking("not-a-code", "ko-KR")).toBe("ko-KR");
    expect(preferredLanguageAfterWebBooking("zh-CN", "zh-HK")).toBe("zh-CN");
    expect(preferredLanguageAfterWebBooking("ko-KR", "en-US")).toBe("ko-KR");
    expect(preferredLanguageAfterWebBooking("zh-HK", null)).toBe("zh-HK");
    expect(preferredLanguageAfterWebBooking(undefined, null)).toBe("en-US");
  });
});

describe("Traditional Chinese (hk) dictionary", () => {
  const keyPaths = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o).flatMap(([k, v]) => keyPaths(v, `${prefix}${k}.`))
      : [prefix];

  it("has every key the English dictionary has, plus the per-id translations", () => {
    const { en, hk } = dictionaries;
    const skip = /^(serviceNames|serviceDescriptions|categories|roles|bios)\./;
    expect(keyPaths(hk).filter((k) => !skip.test(k)).sort()).toEqual(keyPaths(en).filter((k) => !skip.test(k)).sort());
    expect(Object.keys(hk.serviceNames).sort()).toEqual(Object.keys(dictionaries.zh.serviceNames).sort());
    expect(Object.keys(hk.serviceDescriptions).sort()).toEqual(Object.keys(dictionaries.zh.serviceDescriptions).sort());
    expect(Object.keys(hk.bios).sort()).toEqual(Object.keys(dictionaries.zh.bios).sort());
    expect(hk.book.steps).toHaveLength(en.book.steps.length);
    expect(hk.languages.Cantonese).toBe("廣東話");
  });

  it("uses distinct toggle labels and Hong Kong HTML lang", () => {
    expect(LANG_LABELS).toEqual({ en: "EN", zh: "简体", hk: "繁體", ko: "한국어" });
    expect(HTML_LANG.hk).toBe("zh-Hant-HK");
  });

  it("never uses the long dash in any language", () => {
    expect(JSON.stringify(dictionaries)).not.toMatch(/\u2014/);
  });

  it("writes the mall as \"Henderson Place\" in every language, untranslated", () => {
    const all = JSON.stringify(dictionaries);
    expect(all).not.toMatch(/恒信|恆信|商场|商場|广场|廣場|헨더슨|플레이스|Henderson Place Mall/);
    for (const l of LANGS) expect(dictionaries[l].way.mall).toBe("Henderson Place");
  });
});

async function resetData() {
  await prisma.campaignMessage.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.consentEvent.deleteMany();
  await prisma.smsConsent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.slotLock.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.callerProfile.deleteMany();
  await prisma.customer.deleteMany();
}

beforeAll(async () => {
  await resetData();
  await prisma.staffService.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.service.deleteMany();
  await prisma.service.create({ data: { id: "mens-cut", name: "Men's Haircut", category: "Haircuts", durationMin: 30, priceCAD: 30, description: "" } });
  for (const [i, id] of ["stylist-a", "stylist-b", "stylist-c"].entries()) {
    await prisma.staff.create({
      data: { id, name: `Stylist ${i + 1}`, role: "Stylist", bio: "", sortOrder: i, services: { create: [{ serviceId: "mens-cut" }] } },
    });
  }
});
beforeEach(resetData);

let slot = 0;
const book = (phone: string, extra: Record<string, unknown> = {}) => {
  // A different 15-minute slot each time, so bookings never collide.
  const start = new Date(Date.parse(START) + (slot++ % 20) * 15 * 60000).toISOString();
  return createBooking(
    { serviceId: "mens-cut", start, customer: { name: "Wing Chan", phone }, source: "web", ...extra },
    { now, notify: false },
  );
};
const langOf = async (phone: string) => (await prisma.customer.findUniqueOrThrow({ where: { phone } })).preferredLanguage;

describe("website bookings set the customer's language", () => {
  it("a new customer booking on the 繁體 site gets zh-HK", async () => {
    await book("604-555-0301", { siteLang: "hk" });
    expect(await langOf("+16045550301")).toBe("zh-HK");
  });

  it("falls back to smsOptInLang from older clients of the form", async () => {
    await book("604-555-0302", { smsOptInLang: "ko" });
    expect(await langOf("+16045550302")).toBe("ko-KR");
  });

  it("an existing customer still on the default en-US is updated", async () => {
    await prisma.customer.create({ data: { name: "Wing Chan", phone: "+16045550303" } });
    await book("604-555-0303", { siteLang: "zh" });
    expect(await langOf("+16045550303")).toBe("zh-CN");
  });

  it("never overwrites an explicit preference set by the owner", async () => {
    await prisma.customer.create({ data: { name: "Wing Chan", phone: "+16045550304", preferredLanguage: "zh-CN" } });
    await book("604-555-0304", { siteLang: "hk" });
    expect(await langOf("+16045550304")).toBe("zh-CN");
  });

  it("never overwrites a language the phone agent remembered, and keeps the caller profile in sync", async () => {
    await prisma.callerProfile.create({ data: { phone: "+16045550305", preferredLanguage: "zh-HK" } });
    await book("604-555-0305", { siteLang: "en" });
    expect(await langOf("+16045550305")).toBe("zh-HK");

    await prisma.callerProfile.create({ data: { phone: "+16045550306" } });
    await book("604-555-0306", { siteLang: "hk" });
    expect(await langOf("+16045550306")).toBe("zh-HK");
    expect((await prisma.callerProfile.findUniqueOrThrow({ where: { phone: "+16045550306" } })).preferredLanguage).toBe("zh-HK");
  });

  it("an English booking leaves the default alone, and non-web sources ignore the site language", async () => {
    await book("604-555-0307", { siteLang: "en" });
    expect(await langOf("+16045550307")).toBe("en-US");
    await book("604-555-0308", { siteLang: "hk", source: "phone" });
    expect(await langOf("+16045550308")).toBe("en-US");
  });
});

describe("web consent in Traditional Chinese", () => {
  it("stores the exact zh-HK wording shown on the form", async () => {
    await book("604-555-0309", { siteLang: "hk", smsOptIn: true, smsOptInLang: "hk" });
    const shown = webOptInWording("hk");
    const consent = await prisma.smsConsent.findUniqueOrThrow({ where: { phone: "+16045550309" } });
    expect(consent).toMatchObject({ status: "express", source: "web", language: "zh-HK", wording: shown.full });
    expect(shown.label).toContain("短訊");
    expect(shown.fine).toContain("STOP");
    expect(shown.fine).toContain("(604) 475-7705");
    const ev = await prisma.consentEvent.findFirstOrThrow({ where: { phone: "+16045550309", type: "express" } });
    expect(ev.wording).toBe(shown.full);
    expect(ev.language).toBe("zh-HK");
  });
});

describe("calendar file", () => {
  it("is written in the site language", async () => {
    const b = await book("604-555-0310", { siteLang: "hk" });
    const ics = bookingToIcs(b, "hk");
    expect(ics).toContain("SUMMARY:CF Hair Salon：男士剪髮");
    expect(ics).toContain("請致電");
    expect(bookingToIcs(b)).toContain("SUMMARY:Men's haircut at CF Hair Salon");
    expect(ics).toContain("LOCATION:2140-1163 Pinetree Way (Henderson Place)\\, Coquitlam\\, BC V3B 8A9");
  });
});
