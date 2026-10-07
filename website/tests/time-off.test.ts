// Time off: blocks online and phone booking, per stylist or for the whole salon.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking, getAvailability } from "@/lib/bookings";
import { prisma } from "@/lib/db";
import { createTimeOff, deleteTimeOff, listTimeOff } from "@/lib/time-off";
import { DELETE as deleteRoute } from "@/app/api/time-off/[id]/route";
import { POST as postRoute } from "@/app/api/time-off/route";

const now = new Date("2030-01-01T00:00:00Z");
const DAY = "2030-01-07"; // Monday
const at = (hhmm: string) => `${DAY}T${hhmm}:00-08:00`;

async function resetData() {
  await prisma.timeOff.deleteMany();
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
  await prisma.service.create({
    data: { id: "mens-cut", name: "Men's Haircut", category: "Haircuts", durationMin: 30, priceCAD: 30, description: "" },
  });
  for (const [i, id] of ["stylist-a", "stylist-b"].entries()) {
    await prisma.staff.create({
      data: { id, name: id, role: "Stylist", bio: "", sortOrder: i, services: { create: [{ serviceId: "mens-cut" }] } },
    });
  }
});
beforeEach(resetData);
afterAll(resetData);

const book = (n: number, extra: Record<string, unknown> = {}) =>
  createBooking(
    { serviceId: "mens-cut", start: at("13:00"), customer: { name: `Client ${n}`, phone: `604-555-02${String(n).padStart(2, "0")}` }, source: "web", ...extra },
    { now, notify: false },
  );

const startsFor = async (staffId?: string) =>
  (await getAvailability({ serviceId: "mens-cut", date: DAY, staffId, now })).slots.map((s) => s.start.slice(11, 16));

describe("time off", () => {
  it("removes a stylist's time from online availability and refuses bookings in it", async () => {
    await createTimeOff({ staffId: "stylist-a", start: at("13:00"), end: at("14:00"), reason: "Lunch" });
    const a = await startsFor("stylist-a");
    expect(a).not.toContain("13:00");
    expect(a).not.toContain("13:30");
    expect(a).not.toContain("12:45"); // would run into the time off
    expect(a).toContain("14:00");
    await expect(book(1, { staffId: "stylist-a" })).rejects.toMatchObject({ status: 409 });
    // The other stylist is unaffected, and "anyone" goes to them.
    expect(await startsFor("stylist-b")).toContain("13:00");
    await expect(book(2)).resolves.toMatchObject({ staffId: "stylist-b" });
  });

  it("whole-salon time off blocks every stylist, and removing it frees the time again", async () => {
    const { timeOff } = await createTimeOff({ staffId: "all", start: at("10:00"), end: at("18:00"), reason: "Holiday" });
    expect(timeOff.staffId).toBeNull();
    expect(await startsFor()).toEqual([]);
    await expect(book(3)).rejects.toMatchObject({ status: 409 });
    await deleteTimeOff(timeOff.id);
    expect(await startsFor()).toContain("13:00");
  });

  it("keeps existing bookings and reports how many overlap", async () => {
    await book(4, { staffId: "stylist-b" });
    const r = await createTimeOff({ staffId: "stylist-b", start: at("12:00"), end: at("15:00") });
    expect(r.overlappingBookings).toBe(1);
    expect(await prisma.booking.count({ where: { status: "confirmed" } })).toBe(1);
    const listed = await listTimeOff(new Date(`${DAY}T00:00:00-08:00`), new Date("2030-01-08T00:00:00-08:00"));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ staffName: "stylist-b", start: at("12:00"), end: at("15:00"), reason: null });
  });

  it("rejects bad times and unknown stylists", async () => {
    await expect(createTimeOff({ start: at("13:00"), end: at("13:00") })).rejects.toMatchObject({ status: 400 });
    await expect(createTimeOff({ start: at("13:10"), end: at("14:00") })).rejects.toMatchObject({ status: 400 });
    await expect(createTimeOff({ staffId: "nobody", start: at("13:00"), end: at("14:00") })).rejects.toMatchObject({ status: 404 });
  });

  it("the API creates and removes time off (agent key)", async () => {
    const req = (headers: Record<string, string>) =>
      new Request("http://test/api/time-off", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ staffId: "stylist-a", start: at("15:00"), end: at("16:00") }),
      });
    const ok = await postRoute(req({ "x-api-key": "test-agent-key" }) as never);
    expect(ok.status).toBe(201);
    const { timeOff } = await ok.json();
    const del = await deleteRoute(new Request(`http://test/api/time-off/${timeOff.id}`, { method: "DELETE", headers: { "x-api-key": "test-agent-key" } }), {
      params: Promise.resolve({ id: timeOff.id }),
    } as never);
    expect(del.status).toBe(200);
    expect(await prisma.timeOff.count()).toBe(0);
  });
});
