import { describe, expect, it } from "vitest";
import { confirmationText, reminderText } from "../src/lib/notify";
import { isGsm7, countSegments } from "../src/lib/sms/segments";

const booking = { serviceName: "Women's Haircut", staffName: "Stylist B", start: "2026-10-09T14:30:00-07:00" };
// 10:00 the day before, Vancouver time.
const dayBefore = new Date("2026-10-08T10:00:00-07:00");
const twoDaysBefore = new Date("2026-10-07T20:00:00-07:00");

describe("confirmation and reminder texts", () => {
  it("greets the client by first name and stays friendly", () => {
    const t = confirmationText(booking, { name: "Jessica Tam" });
    expect(t.startsWith("Hi Jessica!")).toBe(true);
    expect(t).toContain("You're all set at CF Hair Salon");
    expect(t).toContain("Women's Haircut with Stylist B");
    expect(t).not.toContain("Tam");
    expect(t).toContain("on Fri, Oct 9 at 2:30 p.m. See you then!");
    expect(t).not.toContain("..");
  });

  it("reads naturally without a name", () => {
    expect(confirmationText(booking).startsWith("Hi! You're all set")).toBe(true);
  });

  it("says tomorrow only when the appointment is tomorrow", () => {
    expect(reminderText(booking, { name: "Jessica", now: dayBefore })).toContain("is tomorrow (Fri, Oct 9) at 2:30 p.m. We");
    expect(reminderText(booking, { name: "Jessica", now: twoDaysBefore })).not.toContain("tomorrow");
  });

  it("keeps English texts in plain characters and at most two segments", () => {
    for (const t of [confirmationText(booking, { name: "Alexandra" }), reminderText(booking, { name: "Alexandra", now: dayBefore })]) {
      expect(isGsm7(t)).toBe(true);
      expect(countSegments(t).segments).toBeLessThanOrEqual(2);
    }
  });

  it("follows the client's language", () => {
    expect(confirmationText(booking, { name: "Na", lang: "zh-CN" })).toContain("已为您预约好");
    expect(reminderText(booking, { name: "Ka Yan", lang: "zh-HK", now: dayBefore })).toContain("溫馨提示");
    expect(reminderText(booking, { name: "Ka Yan", lang: "zh-HK", now: dayBefore })).toContain("明天");
    expect(confirmationText(booking, { name: "Minji", lang: "ko-KR" })).toContain("Minji님");
    expect(confirmationText(booking, { lang: "fr-FR" })).toContain("You're all set");
  });
});
