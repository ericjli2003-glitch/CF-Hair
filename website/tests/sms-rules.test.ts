// Pure rules for promotional SMS: keywords, quiet hours, frequency cap, consent
// (including implied expiry), segment counting and the compliance footer.
import { describe, expect, it } from "vitest";
import { assertCompliant, composePromo, OPT_OUT_FOOTER, pickLanguage, previewAll } from "@/lib/sms/compose";
import { classifyKeyword, normaliseKeyword, twilioRepliesTo } from "@/lib/sms/keywords";
import {
  consentDecision,
  effectiveConsent,
  impliedExpiry,
  inSendWindow,
  nextAllowedSendTime,
  underFrequencyCap,
} from "@/lib/sms/rules";
import { countSegments } from "@/lib/sms/segments";
import { computeTwilioSignature, validTwilioSignature } from "@/lib/sms/twilio";
import { toZonedISO, zonedTime } from "@/lib/time";

const TZ = "America/Vancouver";
const local = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTime(date, h * 60 + m, TZ);
};
const iso = (d: Date) => toZonedISO(d, TZ);

describe("inbound keywords", () => {
  it("recognises the English opt-out keywords, any case, with punctuation", () => {
    for (const k of ["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "End", "QUIT", "stopall", "Arret", "ARRÊT", "arrêt!"]) {
      expect(classifyKeyword(k), k).toBe("stop");
    }
  });

  it("recognises Chinese and Korean opt-out keywords", () => {
    for (const k of ["退订", "退訂", "取消", "取消订阅", "수신거부", "수신 거부", "退订。"]) expect(classifyKeyword(k), k).toBe("stop");
  });

  it("only treats the whole message as a keyword", () => {
    expect(classifyKeyword("stop by at 3?")).toBeNull();
    expect(classifyKeyword("Please cancel my appointment")).toBeNull();
    expect(classifyKeyword("請問星期日有冇位")).toBeNull();
    expect(classifyKeyword("")).toBeNull();
  });

  it("START and UNSTOP re-subscribe; YES only when currently opted out (Twilio treats YES as opt-in)", () => {
    expect(classifyKeyword("START")).toBe("start");
    expect(classifyKeyword("unstop")).toBe("start");
    expect(classifyKeyword("订阅")).toBe("start");
    expect(classifyKeyword("YES")).toBeNull();
    expect(classifyKeyword("yes", { currentlyWithdrawn: true })).toBe("start");
  });

  it("HELP and INFO ask for help, in all languages", () => {
    for (const k of ["HELP", "help", "Info", "帮助", "幫助", "도움말"]) expect(classifyKeyword(k), k).toBe("help");
  });

  it("knows which keywords Twilio Advanced Opt-Out already answers", () => {
    expect(twilioRepliesTo("stop")).toBe(true);
    expect(twilioRepliesTo("HELP")).toBe(true);
    expect(twilioRepliesTo("退订")).toBe(false);
    expect(normaliseKeyword("  arrêt ")).toBe("ARRET");
  });
});

describe("quiet hours (09:00 to 20:00 America/Vancouver)", () => {
  it("leaves times inside the window alone", () => {
    const t = local("2026-10-07", "14:30");
    expect(nextAllowedSendTime(t, TZ).getTime()).toBe(t.getTime());
    expect(inSendWindow(local("2026-10-07", "09:00"), TZ)).toBe(true);
    expect(inSendWindow(local("2026-10-07", "19:59"), TZ)).toBe(true);
  });

  it("moves early morning to 09:00 the same day", () => {
    expect(iso(nextAllowedSendTime(local("2026-10-07", "06:15"), TZ))).toBe("2026-10-07T09:00:00-07:00");
    expect(iso(nextAllowedSendTime(local("2026-10-07", "08:59"), TZ))).toBe("2026-10-07T09:00:00-07:00");
  });

  it("moves 20:00 and later to 09:00 the next day", () => {
    expect(inSendWindow(local("2026-10-07", "20:00"), TZ)).toBe(false);
    expect(iso(nextAllowedSendTime(local("2026-10-07", "20:00"), TZ))).toBe("2026-10-08T09:00:00-07:00");
    expect(iso(nextAllowedSendTime(local("2026-10-07", "23:45"), TZ))).toBe("2026-10-08T09:00:00-07:00");
  });

  it("handles the month end and the switch to standard time", () => {
    expect(iso(nextAllowedSendTime(local("2026-10-31", "21:00"), TZ))).toBe("2026-11-01T09:00:00-08:00");
    expect(iso(nextAllowedSendTime(local("2026-11-01", "01:30"), TZ))).toBe("2026-11-01T09:00:00-08:00");
  });
});

describe("frequency cap", () => {
  const now = new Date("2026-10-07T18:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

  it("allows up to the cap within the rolling window (default 4 per 30 days)", () => {
    expect(underFrequencyCap([], now)).toBe(true);
    expect(underFrequencyCap([daysAgo(1), daysAgo(5), daysAgo(10)], now)).toBe(true);
    expect(underFrequencyCap([daysAgo(1), daysAgo(5), daysAgo(10), daysAgo(29)], now)).toBe(false);
  });

  it("ignores texts older than the window", () => {
    expect(underFrequencyCap([daysAgo(31), daysAgo(40), daysAgo(45), daysAgo(1)], now)).toBe(true);
  });

  it("is configurable", () => {
    expect(underFrequencyCap([daysAgo(2)], now, { max: 1, days: 7 })).toBe(false);
    expect(underFrequencyCap([daysAgo(8)], now, { max: 1, days: 7 })).toBe(true);
  });
});

describe("consent filtering and implied expiry", () => {
  const now = new Date("2026-10-07T18:00:00Z");

  it("express consent always qualifies, implied only when included", () => {
    const express = effectiveConsent({ status: "express" }, null, now);
    expect(consentDecision(express, false)).toEqual({ ok: true, basis: "express" });
    const implied = effectiveConsent(null, new Date("2025-03-01T20:00:00Z"), now);
    expect(implied.status).toBe("implied");
    expect(consentDecision(implied, false)).toEqual({ ok: false, reason: "implied_excluded" });
    expect(consentDecision(implied, true)).toEqual({ ok: true, basis: "implied" });
  });

  it("computes implied expiry as two years after the paid visit", () => {
    const visit = new Date("2025-03-01T20:00:00Z");
    expect(impliedExpiry(visit).toISOString()).toBe("2027-03-01T20:00:00.000Z");
    expect(effectiveConsent(null, visit, now).expiresAt?.toISOString()).toBe("2027-03-01T20:00:00.000Z");
  });

  it("drops implied consent once two years have passed", () => {
    const visit = new Date("2024-10-07T17:00:00Z"); // two years and one hour before now
    const eff = effectiveConsent({ status: "implied", impliedExpiresAt: impliedExpiry(visit) }, visit, now);
    expect(eff.status).toBe("none");
    expect(consentDecision(eff, true, true)).toEqual({ ok: false, reason: "implied_expired" });
    // One day short of two years: still implied.
    expect(effectiveConsent(null, new Date("2024-10-08T18:00:00Z"), now).status).toBe("implied");
  });

  it("a withdrawal is never overridden by a later visit", () => {
    const eff = effectiveConsent({ status: "withdrawn" }, new Date("2026-10-01T18:00:00Z"), now);
    expect(eff.status).toBe("withdrawn");
    expect(consentDecision(eff, true)).toEqual({ ok: false, reason: "withdrawn" });
  });

  it("no visit and no opt-in means no consent", () => {
    expect(consentDecision(effectiveConsent(null, null, now), true)).toEqual({ ok: false, reason: "no_consent" });
  });
});

describe("segment counting", () => {
  it("GSM-7: 160 in one segment, then 153 per segment", () => {
    expect(countSegments("a".repeat(160))).toMatchObject({ encoding: "GSM-7", segments: 1, units: 160 });
    expect(countSegments("a".repeat(161))).toMatchObject({ encoding: "GSM-7", segments: 2, perSegment: 153 });
    expect(countSegments("a".repeat(306)).segments).toBe(2);
    expect(countSegments("a".repeat(307)).segments).toBe(3);
  });

  it("GSM extension characters cost two", () => {
    expect(countSegments("€".repeat(80))).toMatchObject({ encoding: "GSM-7", units: 160, segments: 1 });
    expect(countSegments("[" + "a".repeat(159)).segments).toBe(2);
  });

  it("Chinese and Korean switch to UCS-2: 70 per segment, then 67", () => {
    expect(countSegments("好".repeat(70))).toMatchObject({ encoding: "UCS-2", segments: 1 });
    expect(countSegments("好".repeat(71))).toMatchObject({ encoding: "UCS-2", segments: 2, perSegment: 67 });
    expect(countSegments("가".repeat(134)).segments).toBe(2);
    expect(countSegments("가".repeat(135)).segments).toBe(3);
  });

  it("one curly quote or emoji turns an English text into UCS-2", () => {
    const plain = "Book now and save 15% this week";
    expect(countSegments(plain).encoding).toBe("GSM-7");
    expect(countSegments(plain.replace("save", "save’")).encoding).toBe("UCS-2");
    expect(countSegments("Hi 💇").units).toBe(5); // emoji is two UTF-16 units
  });
});

describe("promotional footer and sender ID", () => {
  it("adds the salon name and a localised STOP line, counted in the segments", () => {
    const text = composePromo("Autumn colour week: 15% off full colour until Oct 31. Book online or call us.", "en-US");
    expect(text).toBe("CF Hair Salon: Autumn colour week: 15% off full colour until Oct 31. Book online or call us. Reply STOP to opt out.");
    expect(countSegments(text)).toMatchObject({ encoding: "GSM-7", segments: 1 });
    expect(() => assertCompliant(text, "en-US")).not.toThrow();
  });

  it("does not repeat the name when the body starts with it", () => {
    expect(composePromo("CF Hair Salon has new hours!", "en-US")).toBe("CF Hair Salon has new hours! Reply STOP to opt out.");
  });

  it("localises the footer and counts Chinese against 70 characters", () => {
    const zh = composePromo("秋季染发周：全头染发85折，至10月31日。", "zh-CN");
    expect(zh.startsWith("CF Hair Salon：")).toBe(true);
    expect(zh.endsWith(OPT_OUT_FOOTER["zh-CN"])).toBe(true);
    expect(countSegments(zh).encoding).toBe("UCS-2");
    expect(composePromo("가을 할인", "ko-KR")).toContain("수신거부");
    expect(composePromo("秋季優惠", "zh-HK")).toContain("STOP");
  });

  it("refuses a message without the sender ID or footer", () => {
    expect(() => assertCompliant("15% off this week", "en-US")).toThrow();
    expect(() => assertCompliant("CF Hair Salon: 15% off", "en-US")).toThrow();
  });

  it("follows preferredLanguage and falls back to English", () => {
    const bodies = { "en-US": "Hi", "zh-CN": "你好" };
    expect(pickLanguage(bodies, "zh-CN")).toBe("zh-CN");
    expect(pickLanguage(bodies, "zh-HK")).toBe("en-US");
    expect(pickLanguage(bodies, "ko-KR")).toBe("en-US");
    const p = previewAll(bodies);
    expect(p.find((x) => x.language === "zh-HK")?.custom).toBe(false);
    expect(p.find((x) => x.language === "zh-HK")?.text).toContain("Reply STOP");
  });
});

describe("Twilio signature", () => {
  it("matches Twilio's documented example", () => {
    const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
    expect(computeTwilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });

  it("matches the official SDK for an inbound SMS and rejects tampering", () => {
    const url = "https://cfhair.example/api/sms/inbound";
    const params = { From: "+16045550111", To: "+16045550999", Body: "STOP", MessageSid: "SM123", AccountSid: "AC1" };
    expect(computeTwilioSignature("test-token", url, params)).toBe("0OFTzOrgyHbMh6hyk9NRVG6rBQw=");
    expect(validTwilioSignature("test-token", "0OFTzOrgyHbMh6hyk9NRVG6rBQw=", url, params)).toBe(true);
    expect(validTwilioSignature("test-token", "0OFTzOrgyHbMh6hyk9NRVG6rBQw=", url, { ...params, Body: "START" })).toBe(false);
    expect(validTwilioSignature("test-token", null, url, params)).toBe(false);
  });
});
