// Integration tests against a real SQLite database (see global-setup.ts).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "@/lib/api";
import { cancelBooking, createBooking, getAvailability, rescheduleBooking } from "@/lib/bookings";
import { prisma } from "@/lib/db";
import { GET as getCaller, PUT as putCaller } from "@/app/api/callers/[phone]/route";

const now = new Date("2030-01-01T00:00:00Z");
const START = "2030-01-07T11:00:00-08:00"; // Monday

async function resetData() {
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
  await prisma.service.createMany({
    data: [
      { id: "mens-cut", name: "Men's Haircut", category: "Haircuts", durationMin: 30, priceCAD: 30, description: "" },
      { id: "full-colour", name: "Full Colour", category: "Colour", durationMin: 120, priceCAD: 120, description: "" },
    ],
  });
  for (const [i, id] of ["stylist-a", "stylist-b", "stylist-c"].entries()) {
    await prisma.staff.create({
      data: {
        id,
        name: id,
        role: "Stylist",
        bio: "",
        sortOrder: i,
        services: { create: [{ serviceId: "mens-cut" }, ...(i === 0 ? [{ serviceId: "full-colour" }] : [])] },
      },
    });
  }
});
beforeEach(resetData);

const body = (n: number, extra: Record<string, unknown> = {}) => ({
  serviceId: "mens-cut",
  start: START,
  customer: { name: `Client ${n}`, phone: `604-555-01${String(n).padStart(2, "0")}` },
  source: "web",
  ...extra,
});

async function settle(promises: Promise<unknown>[]) {
  const results = await Promise.allSettled(promises);
  const ok = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  return { ok, failed };
}

describe("double-booking prevention", () => {
  it("only one of several concurrent requests for the same stylist and time succeeds", async () => {
    const { ok, failed } = await settle(
      Array.from({ length: 6 }, (_, i) => createBooking(body(i, { staffId: "stylist-b" }), { now, notify: false })),
    );
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(5);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(HttpError);
      expect((f.reason as HttpError).status).toBe(409);
      expect((f.reason as HttpError).code).toBe("SLOT_TAKEN");
    }
    expect(await prisma.booking.count()).toBe(1);
  });

  it("'No preference' requests spread across free stylists, then return 409 when all are taken", async () => {
    const { ok, failed } = await settle(Array.from({ length: 5 }, (_, i) => createBooking(body(i), { now, notify: false })));
    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(2);
    const rows = await prisma.booking.findMany();
    expect(new Set(rows.map((r) => r.staffId)).size).toBe(3);
  });

  it("blocks overlapping (not just identical) start times", async () => {
    await createBooking(body(1, { serviceId: "full-colour", staffId: "stylist-a" }), { now, notify: false });
    await expect(
      createBooking(body(2, { staffId: "stylist-a", start: "2030-01-07T12:30:00-08:00" }), { now, notify: false }),
    ).rejects.toMatchObject({ status: 409, code: "SLOT_TAKEN" });
    // Right after the colour ends is fine.
    await expect(
      createBooking(body(3, { staffId: "stylist-a", start: "2030-01-07T13:00:00-08:00" }), { now, notify: false }),
    ).resolves.toMatchObject({ staffId: "stylist-a" });
  });

  it("rejects past times, times outside hours and off-grid times", async () => {
    await expect(createBooking(body(1, { start: "2029-12-31T11:00:00-08:00" }), { now, notify: false })).rejects.toMatchObject({ code: "START_IN_PAST" });
    await expect(createBooking(body(1, { start: "2030-01-07T17:45:00-08:00" }), { now, notify: false })).rejects.toMatchObject({ code: "OUTSIDE_HOURS" });
    await expect(createBooking(body(1, { start: "2030-01-07T11:10:00-08:00" }), { now, notify: false })).rejects.toMatchObject({ code: "INVALID_START" });
  });

  it("availability reflects bookings, and cancelling frees the slot", async () => {
    const b = await createBooking(body(1, { staffId: "stylist-c" }), { now, notify: false });
    const before = await getAvailability({ serviceId: "mens-cut", date: "2030-01-07", staffId: "stylist-c", now });
    expect(before.slots.map((s) => s.start)).not.toContain(START);
    await cancelBooking(b.id);
    const after = await getAvailability({ serviceId: "mens-cut", date: "2030-01-07", staffId: "stylist-c", now });
    expect(after.slots.map((s) => s.start)).toContain(START);
    // and the slot can be booked again
    await expect(createBooking(body(2, { staffId: "stylist-c" }), { now, notify: false })).resolves.toBeTruthy();
  });

  it("reschedule refuses a taken time and moves to a free one", async () => {
    const a = await createBooking(body(1, { staffId: "stylist-b" }), { now, notify: false });
    await createBooking(body(2, { staffId: "stylist-b", start: "2030-01-07T14:00:00-08:00" }), { now, notify: false });
    await expect(
      rescheduleBooking(a.id, { start: "2030-01-07T14:00:00-08:00", staffId: "stylist-b" }, { now }),
    ).rejects.toMatchObject({ status: 409 });
    const moved = await rescheduleBooking(a.id, { start: "2030-01-07T15:00:00-08:00", staffId: "stylist-b" }, { now });
    expect(moved.start).toBe("2030-01-07T15:00:00-08:00");
    expect(await prisma.slotLock.count({ where: { bookingId: a.id } })).toBe(2);
  });

  it("upserts customers by phone (E.164)", async () => {
    await createBooking(body(7, { staffId: "stylist-a" }), { now, notify: false });
    await createBooking(
      { ...body(7, { staffId: "stylist-a", start: "2030-01-08T11:00:00-08:00" }), customer: { name: "Client Seven", phone: "+1 (604) 555-0107" } },
      { now, notify: false },
    );
    const customers = await prisma.customer.findMany();
    expect(customers).toHaveLength(1);
    expect(customers[0].phone).toBe("+16045550107");
    expect(customers[0].name).toBe("Client Seven");
  });
});

describe("caller profiles API", () => {
  const key = { "x-api-key": "test-agent-key", "content-type": "application/json" };
  const ctx = (phone: string) => ({ params: Promise.resolve({ phone }) });
  const call = async (method: "GET" | "PUT", phone: string, payload?: unknown, headers: Record<string, string> = key) => {
    const req = new Request(`http://test/api/callers/${phone}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
    const res = method === "GET" ? await getCaller(req, ctx(phone) as never) : await putCaller(req, ctx(phone) as never);
    return { status: res.status, body: await res.json() };
  };

  it("returns a default profile for unknown numbers", async () => {
    const r = await call("GET", "%2B16045550190");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phone: "+16045550190", preferredLanguage: "en-US", callCount: 0 });
  });

  it("PUT then GET round-trips, normalising the phone", async () => {
    const put = await call("PUT", "%2B16045550191", { preferredLanguage: "zh-HK", name: "Mrs. Lau", incrementCallCount: true });
    expect(put.status).toBe(200);
    await call("PUT", "604-555-0191", { incrementCallCount: true });
    const get = await call("GET", encodeURIComponent("(604) 555-0191"));
    expect(get.body).toMatchObject({ phone: "+16045550191", name: "Mrs. Lau", preferredLanguage: "zh-HK", callCount: 2 });
    expect(get.body.lastCallAt).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("rejects invalid language codes and missing keys", async () => {
    const bad = await call("PUT", "%2B16045550192", { preferredLanguage: "fr-FR" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("INVALID_LANGUAGE");
    const noKey = await call("GET", "%2B16045550192", undefined, {});
    expect(noKey.status).toBe(401);
  });

  it("keeps customer and caller language in sync both ways", async () => {
    await createBooking(body(93, { staffId: "stylist-a" }), { now, notify: false });
    await call("PUT", "%2B16045550193", { preferredLanguage: "ko-KR" });
    const c = await prisma.customer.findUniqueOrThrow({ where: { phone: "+16045550193" } });
    expect(c.preferredLanguage).toBe("ko-KR");
    const profile = await prisma.callerProfile.findUniqueOrThrow({ where: { phone: "+16045550193" } });
    expect(profile.customerId).toBe(c.id);

    // A caller profile created before the first booking passes its language to the new customer.
    await call("PUT", "%2B16045550194", { preferredLanguage: "zh-CN" });
    await createBooking(body(94, { staffId: "stylist-a", start: "2030-01-07T15:00:00-08:00" }), { now, notify: false });
    const c2 = await prisma.customer.findUniqueOrThrow({ where: { phone: "+16045550194" } });
    expect(c2.preferredLanguage).toBe("zh-CN");
  });
});

describe("customers API fields for the notes pipeline", () => {
  it("returns last service, next booking, referral, language and mailing address", async () => {
    const { listCustomers, customersToCsv } = await import("@/lib/customers");
    const { setBookingStatus } = await import("@/lib/bookings");
    const later = new Date("2030-01-07T20:00:00Z"); // Monday noon in Vancouver
    const past = await createBooking(body(50, { staffId: "stylist-a", start: "2030-01-07T10:00:00-08:00" }), { now, notify: false });
    await setBookingStatus(past.id, "completed");
    await createBooking(body(50, { staffId: "stylist-a", serviceId: "full-colour", start: "2030-01-09T10:00:00-08:00" }), { now, notify: false });
    await prisma.customer.update({
      where: { phone: "+16045550150" },
      data: {
        referredBy: "Mei Lin Chen",
        preferredLanguage: "zh-CN",
        mailingAddress: JSON.stringify({ line1: "1188 Pinetree Way", line2: "Unit 2703", city: "Coquitlam", province: "BC", postalCode: "V3B 0K9", country: "CA" }),
      },
    });
    const [c] = await listCustomers({ phone: "+16045550150" }, later);
    expect(c).toMatchObject({
      lastServiceId: "mens-cut",
      lastServiceName: "Men's Haircut",
      nextBookingAt: "2030-01-09T10:00:00-08:00",
      referredBy: "Mei Lin Chen",
      preferredLanguage: "zh-CN",
      visitCount: 1,
      mailingAddress: { line1: "1188 Pinetree Way", line2: "Unit 2703", city: "Coquitlam", province: "BC", postalCode: "V3B 0K9", country: "CA" },
    });
    const csv = customersToCsv([c], new Map());
    expect(csv.split("\n")[0]).toContain("lastServiceName,nextBookingAt,referredBy");
    expect(csv).toContain("Men's Haircut,2030-01-09T10:00:00-08:00,Mei Lin Chen");

    // A client with no visits and nothing booked gets nulls, not missing keys.
    await createBooking(body(51, { staffId: "stylist-b", start: "2030-01-10T10:00:00-08:00" }), { now, notify: false });
    const b = await prisma.booking.findFirstOrThrow({ where: { customer: { phone: "+16045550151" } } });
    await cancelBooking(b.id);
    const [d] = await listCustomers({ phone: "+16045550151" }, later);
    expect(d).toMatchObject({ lastServiceId: null, lastServiceName: null, nextBookingAt: null, referredBy: null, preferredLanguage: "en-US" });
  });
});
