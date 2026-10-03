import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { idempotencyKey, selectAudience } from "../src/audience.js";
import { mapCustomer } from "../src/data/api.js";
import { loadCampaign } from "../src/campaigns.js";
import { loadClientsCsv } from "../src/data/csv.js";
import { nextBirthday } from "../src/dates.js";
import { History } from "../src/history.js";
import type { Campaign, Client } from "../src/types.js";

const TODAY = "2026-10-09";
const SAMPLE = loadClientsCsv(path.join(__dirname, "..", "sample", "clients.csv"));

function client(over: Partial<Client>): Client {
  return {
    id: over.id ?? "x1",
    firstName: "Test",
    lastName: "Client",
    visitCount: 1,
    preferredLanguage: "en-US",
    tags: [],
    address: { line1: "100 Pinetree Way", city: "Coquitlam", province: "BC", postalCode: "V3B 7L2", country: "CA" },
    ...over,
  };
}

function campaign(audience: Campaign["audience"], over: Partial<Campaign> = {}): Campaign {
  return {
    id: "test",
    name: "Test",
    description: "",
    occasion: "test",
    audience,
    design: "cf-thank-you",
    guidelines: "",
    maxChars: 380,
    maxCharsAlt: 130,
    signature: { template: "{stylistFirstName}", fallback: "Team" },
    dedupe: "once",
    secondLanguage: false,
    ...over,
  };
}

const ids = (sel: ReturnType<typeof selectAudience>) => sel.matches.map((m) => m.client.id).sort();
const opts = { today: TODAY, cooldownDays: 30 };

describe("audience rules on the sample CSV", () => {
  it("first visit in the last 7 days (new clients only)", () => {
    const sel = selectAudience(loadCampaign("first-visit-thanks"), SAMPLE, opts);
    expect(ids(sel)).toEqual(["c003", "c004", "c005", "c006"]);
  });

  it("birthday in the next 14 days", () => {
    const sel = selectAudience(loadCampaign("birthday"), SAMPLE, opts);
    // Harjit 10-11, Grace 10-14, Emily 10-20, Kenji 10-22. Sophie (10-25) is outside the window.
    expect(ids(sel)).toEqual(["c007", "c008", "c009", "c010"]);
  });

  it("win-back: last visit 60 to 120 days ago, excluding unmailable and already-booked clients", () => {
    const sel = selectAudience(loadCampaign("win-back"), SAMPLE, opts);
    expect(ids(sel)).toEqual(["c012", "c013", "c014", "c015", "c017", "c018", "c026", "c027"]);
    // Ethan (59 days) and Hana (121 days) sit just outside the window.
    expect(ids(sel)).not.toContain("c022");
    expect(ids(sel)).not.toContain("c023");
    const reasons = Object.fromEntries(sel.excluded.map((e) => [e.client.id, e.reason]));
    expect(reasons.c019).toMatch(/no mailing address/);
    expect(reasons.c020).toMatch(/opted out/);
    // Marco is lapsed but rebooked by phone for 2026-10-15.
    expect(reasons.c016).toBe("already booked for 2026-10-15");
  });

  it("all clients with 3+ visits", () => {
    const c = campaign({ rule: "minVisits", count: 3 });
    const sel = selectAudience(c, SAMPLE, opts);
    expect(sel.matches.every((m) => m.client.visitCount >= 3)).toBe(true);
    const expected = SAMPLE.filter((x) => x.visitCount >= 3 && x.address && !x.tags.includes("do-not-mail")).map((x) => x.id).sort();
    expect(ids(sel)).toEqual(expected);
  });

  it("referral thanks finds the referrer of a recent first visit", () => {
    const sel = selectAudience(loadCampaign("referral-thanks"), SAMPLE, opts);
    expect(ids(sel)).toEqual(["c001", "c002"]);
    const liam = sel.matches.find((m) => m.client.id === "c002")!;
    expect(liam.occasion.referred?.firstName).toBe("Diego");
    expect(liam.idempotencyKey).toBe("referral-thanks:c002:ref-c004");
  });
});

describe("rule edge cases", () => {
  it("lastVisitBetweenDays is inclusive at both ends", () => {
    const c = campaign({ rule: "lastVisitBetweenDays", min: 60, max: 120 });
    const clients = [
      client({ id: "d59", lastVisit: "2026-08-11" }),
      client({ id: "d60", lastVisit: "2026-08-10" }),
      client({ id: "d120", lastVisit: "2026-06-11" }),
      client({ id: "d121", lastVisit: "2026-06-10" }),
    ];
    expect(ids(selectAudience(c, clients, opts))).toEqual(["d120", "d60"]);
  });

  it("birthday window wraps across New Year", () => {
    const c = campaign({ rule: "birthdayWithinDays", days: 14 });
    const clients = [client({ id: "jan3", birthday: "01-03" }), client({ id: "jan20", birthday: "01-20" })];
    expect(ids(selectAudience(c, clients, { ...opts, today: "2026-12-25" }))).toEqual(["jan3"]);
  });

  it("Feb 29 birthdays are celebrated on Feb 28 in non-leap years", () => {
    expect(nextBirthday("1992-02-29", "2027-02-20")).toBe("2027-02-28");
    expect(nextBirthday("02-29", "2028-02-20")).toBe("2028-02-29");
  });

  it("all / any / not combinators", () => {
    const c = campaign({
      all: [{ any: [{ rule: "hasTag", tag: "vip" }, { rule: "minVisits", count: 10 }] }, { not: { rule: "preferredLanguage", language: "zh" } }],
    });
    const clients = [
      client({ id: "vip", tags: ["VIP"] }),
      client({ id: "many", visitCount: 12 }),
      client({ id: "zh", visitCount: 12, preferredLanguage: "zh-HK" }),
      client({ id: "none" }),
    ];
    expect(ids(selectAudience(c, clients, opts))).toEqual(["many", "vip"]);
  });

  it("rejects invalid Canadian postal codes", () => {
    const c = campaign({ rule: "everyone" });
    const bad = client({ id: "bad", address: { line1: "1 Main St", city: "Coquitlam", province: "BC", postalCode: "V3B 1D1", country: "CA" } });
    const sel = selectAudience(c, [bad], opts);
    expect(sel.matches).toHaveLength(0);
    expect(sel.excluded[0].reason).toMatch(/postal code/);
  });

  it("skips clients already mailed for this occasion and honours the cooldown", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "notes-aud-"));
    const history = new History(path.join(dir, "h.json"));
    const c = campaign({ rule: "everyone" }, { dedupe: "year" });
    const a = client({ id: "a" });
    const b = client({ id: "b" });
    const keyA = idempotencyKey(c, a, {}, TODAY);
    history.upsert({ idempotencyKey: keyA, campaignId: "test", clientId: "a", noteId: "n", runId: "r", provider: "plotter", status: "sent", sentOn: "2026-01-02" });
    history.upsert({ idempotencyKey: "other:b", campaignId: "other", clientId: "b", noteId: "n2", runId: "r", provider: "plotter", status: "sent", sentOn: "2026-10-01" });
    const sel = selectAudience(c, [a, b], { ...opts, history });
    expect(sel.matches).toHaveLength(0);
    expect(sel.excluded.map((e) => e.reason)).toEqual(["already sent this card", "received a card on 2026-10-01 (cooldown 30 days)"]);
    // Birthday-style campaigns can opt out of the cooldown.
    const sel2 = selectAudience({ ...c, ignoreCooldown: true }, [b], { ...opts, history });
    expect(sel2.matches).toHaveLength(1);
  });
});

describe("upcoming bookings", () => {
  const winBack = loadCampaign("win-back");
  const lapsed = (id: string, nextBookingAt?: string) => client({ id, lastVisit: "2026-07-01", visitCount: 3, nextBookingAt });

  it("excludes anyone with a future booking from come-back campaigns only", () => {
    const clients = [
      lapsed("booked-later", "2026-11-02T11:00:00-08:00"),
      lapsed("booked-today", "2026-10-09T17:30:00-07:00"),
      lapsed("past-booking", "2026-09-01T10:00:00-07:00"),
      lapsed("nothing", undefined),
    ];
    const sel = selectAudience(winBack, clients, opts);
    expect(ids(sel)).toEqual(["nothing", "past-booking"]);
    expect(sel.excluded.map((e) => e.reason).sort()).toEqual(["already booked for 2026-10-09", "already booked for 2026-11-02"]);
    // A thank-you style campaign without excludeIfBooked still includes them.
    const loyal = campaign({ rule: "minVisits", count: 3 });
    expect(ids(selectAudience(loyal, clients, opts))).toHaveLength(4);
  });

  it("hasUpcomingBooking can also be used inside a rule", () => {
    const c = campaign({ not: { rule: "hasUpcomingBooking" } });
    const clients = [lapsed("a", "2026-12-01T10:00:00-08:00"), lapsed("b")];
    expect(ids(selectAudience(c, clients, opts))).toEqual(["b"]);
  });
});

describe("live API customers", () => {
  const api = [
    {
      id: "cust_1", name: "Ka Yan Chan", phone: "+16045550127", email: "k@example.com",
      mailingAddress: { line1: "2938 Spuraway Avenue", city: "Coquitlam", province: "BC", postalCode: "v3c2e3", country: "CA" },
      firstVisit: "2024-02-03T18:00:00.000Z", lastVisit: "2026-08-03T19:30:00.000Z", visitCount: 6, favouriteStaffId: "stylist-c",
      birthday: "07-08", preferredLanguage: "zh-HK", lastServiceId: "root-colour", lastServiceName: "Root Touch-up Colour",
      nextBookingAt: null, referredBy: null, tags: ["regular"],
    },
    {
      id: "cust_2", name: "Seo-yeon Choi", phone: "+16045550126", email: null,
      mailingAddress: { line1: "1102-3100 Windsor Gate", line2: null, city: "Coquitlam", province: "BC", postalCode: "V3B 0P3", country: "CA" },
      firstVisit: "2026-10-05T17:00:00.000Z", lastVisit: "2026-10-05T17:00:00.000Z", visitCount: 1, favouriteStaffId: "stylist-a",
      preferredLanguage: "ko-KR", referredBy: "cust_1", nextBookingAt: "2026-11-20T18:00:00.000Z", tags: [],
    },
    // Older payload with none of the new fields.
    { id: "cust_3", name: "Old Record", mailingAddress: null, visitCount: 2, tags: [] },
  ];

  it("maps the new fields and tolerates their absence", () => {
    const [a, b, c] = api.map((x) => mapCustomer(x as never));
    expect(a).toMatchObject({
      firstName: "Ka", lastName: "Yan Chan", preferredLanguage: "zh-HK", lastServiceName: "Root Touch-up Colour",
      lastVisit: "2026-08-03", address: { postalCode: "V3C 2E3", city: "Coquitlam" }, birthday: "07-08",
    });
    expect(a.nextBookingAt).toBeUndefined();
    expect(b).toMatchObject({ preferredLanguage: "ko-KR", referredBy: "cust_1", nextBookingAt: "2026-11-20T18:00:00.000Z" });
    expect(b.address?.line2).toBeUndefined();
    expect(c).toMatchObject({ preferredLanguage: "en-US", address: undefined, referredBy: undefined, lastServiceName: undefined });
  });

  it("referral thanks uses referredBy from the API", () => {
    const clients = api.map((x) => mapCustomer(x as never));
    const sel = selectAudience(loadCampaign("referral-thanks"), clients, opts);
    expect(ids(sel)).toEqual(["cust_1"]);
    expect(sel.matches[0].occasion.referred?.firstName).toBe("Seo-yeon");
  });
});
