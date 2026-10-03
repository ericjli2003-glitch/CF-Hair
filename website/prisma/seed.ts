/* Seeds services and staff from shared/salon.json (via src/data/salon.json) plus
   realistic demo customers, bookings, caller profiles and messages. */
import { PrismaClient } from "@prisma/client";
import { blocksFor, computeSlots, type BusyBlock, type StaffLite } from "../src/lib/availability";
import { salon, SALON_TZ } from "../src/lib/salon";
import { addDays, dateKeyOf, zonedTime } from "../src/lib/time";

const prisma = new PrismaClient();

// Deterministic PRNG so every reset produces the same demo data shape.
let seed = 20261003;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

type Kind = "m" | "f" | "k" | "sm" | "sf";
interface DemoCustomer {
  name: string;
  kind: Kind;
  lang?: "en-US" | "zh-CN" | "zh-HK" | "ko-KR";
  email?: boolean;
  address?: { line1: string; line2?: string; city: string; postalCode: string };
  birthday?: string; // MM-DD, year added below
  tags?: string[];
  referredBy?: string;
  weight?: number; // how often they visit
  calls?: number; // phone agent caller profile
}

const CUSTOMERS: DemoCustomer[] = [
  { name: "Wei Zhang", kind: "m", lang: "zh-CN", weight: 4, calls: 3 },
  { name: "Mei Lin Chen", kind: "f", lang: "zh-CN", email: true, address: { line1: "1188 Pinetree Way", line2: "Unit 2703", city: "Coquitlam", postalCode: "V3B 0K9" }, birthday: "10-21", tags: ["colour-client"], weight: 4, calls: 2 },
  { name: "Kevin Wong", kind: "m", lang: "zh-HK", weight: 3, calls: 4 },
  { name: "Jasmine Liu", referredBy: "Mei Lin Chen", kind: "f", email: true, address: { line1: "2975 Atlantic Ave", line2: "#1504", city: "Coquitlam", postalCode: "V3B 0C5" }, birthday: "03-14", weight: 3 },
  { name: "Ka Yan Leung", kind: "f", lang: "zh-HK", email: true, address: { line1: "3007 Glen Dr", line2: "Unit 908", city: "Coquitlam", postalCode: "V3B 0L8" }, birthday: "10-12", tags: ["vip"], weight: 3, calls: 2 },
  { name: "Ji-woo Park", kind: "f", lang: "ko-KR", email: true, weight: 2, calls: 1 },
  { name: "Min-jun Kim", kind: "m", lang: "ko-KR", weight: 3, calls: 2 },
  { name: "Seo-yeon Lee", referredBy: "Ji-woo Park", kind: "f", email: true, address: { line1: "567 Lougheed Hwy", line2: "#1902", city: "Coquitlam", postalCode: "V3K 0M5" }, birthday: "07-02", weight: 1 },
  { name: "Arash Rahimi", kind: "m", weight: 2 },
  { name: "Shirin Moradi", kind: "f", email: true, address: { line1: "1220 Guildford Way", line2: "Unit 311", city: "Coquitlam", postalCode: "V3B 7Y5" }, birthday: "12-05", weight: 2 },
  { name: "Maria Santos", kind: "f", email: true, address: { line1: "2345 Whitman Ave", city: "Coquitlam", postalCode: "V3K 3K4" }, birthday: "10-28", weight: 2 },
  { name: "Paolo Reyes", kind: "m", weight: 1 },
  { name: "Priya Sharma", kind: "f", email: true, address: { line1: "1477 Lansdowne Dr", city: "Coquitlam", postalCode: "V3E 2N9" }, birthday: "01-19", weight: 1 },
  { name: "Harjit Gill", kind: "m", weight: 2 },
  { name: "Emily Thompson", kind: "f", email: true, address: { line1: "1428 Purcell Dr", city: "Coquitlam", postalCode: "V3E 1G4" }, birthday: "05-30", tags: ["colour-client"], weight: 2 },
  { name: "Ryan MacDonald", kind: "m", email: true, weight: 1 },
  { name: "Yuki Tanaka", kind: "f", email: true, weight: 1 },
  { name: "Linh Nguyen", kind: "f", address: { line1: "3093 Windsor Gate", line2: "#402", city: "Coquitlam", postalCode: "V3B 0P3" }, birthday: "08-16", weight: 1 },
  { name: "Daniel Ho", referredBy: "Walked past in the mall", kind: "m", lang: "zh-HK", weight: 2 },
  { name: "Grace Huang", kind: "f", lang: "zh-CN", email: true, address: { line1: "1155 The High St", line2: "Unit 1806", city: "Coquitlam", postalCode: "V3B 7W4" }, birthday: "11-08", weight: 2, calls: 1 },
  { name: "Tony Lam", kind: "m", lang: "zh-HK", weight: 2 },
  { name: "Sophie Tremblay", referredBy: "Instagram", kind: "f", email: true, weight: 1 },
  { name: "Ethan Chow", kind: "k", weight: 2 },
  { name: "Olivia Kwan", kind: "f", email: true, birthday: "10-09", weight: 1 },
  { name: "Hassan Ahmadi", kind: "m", weight: 1 },
  { name: "Chloe Yeung", referredBy: "Ka Yan Leung", kind: "f", lang: "zh-HK", email: true, weight: 1 },
  { name: "Margaret Wilson", kind: "sf", address: { line1: "2980 Mariner Way", city: "Coquitlam", postalCode: "V3C 4J2" }, birthday: "04-03", tags: ["prefers-phone"], weight: 2 },
  { name: "Raymond Fung", kind: "sm", lang: "zh-HK", weight: 2, calls: 2 },
  { name: "Hana Choi", kind: "f", lang: "ko-KR", email: true, weight: 1 },
  { name: "Lucas Martins", kind: "m", weight: 1 },
];

const SERVICES_BY_KIND: Record<Kind, string[]> = {
  m: ["mens-cut", "mens-cut", "mens-cut", "mens-cut", "down-perm", "mens-perm", "scalp-treatment"],
  f: ["womens-cut", "womens-cut", "womens-cut", "root-colour", "full-colour", "highlights", "balayage", "digital-perm", "keratin", "wash-blowdry", "updo", "braiding", "straightening"],
  k: ["kids-cut"],
  sm: ["senior-cut"],
  sf: ["senior-cut", "senior-cut", "wash-blowdry", "root-colour"],
};

const NOTES = [
  "Same as last time, slightly shorter on the sides.",
  "Would like to try a warmer tone.",
  "Sensitive scalp, please use gentle shampoo.",
  "Prefers Mandarin.",
  "Bringing reference photo.",
  "Running from work, may be 5 min late.",
];

function emailFor(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z ]/g, "").trim().replace(/\s+/, ".").replace(/\s+/g, "")}@example.com`;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:") && process.env.SEED_ALLOW_REMOTE !== "1") {
    throw new Error("Refusing to wipe and seed a non-SQLite database. Set SEED_ALLOW_REMOTE=1 to seed a fresh Postgres demo database.");
  }
  console.log("Seeding from salon.json:", salon.name);
  await prisma.slotLock.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.callerProfile.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.message.deleteMany();
  await prisma.staffService.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.service.deleteMany();

  for (const [i, s] of salon.services.entries()) {
    await prisma.service.create({
      data: { id: s.id, name: s.name, category: s.category, durationMin: s.durationMin, priceCAD: s.priceCAD, description: s.description, sortOrder: i },
    });
  }
  for (const [i, s] of salon.staff.entries()) {
    await prisma.staff.create({
      data: {
        id: s.id, name: s.name, role: s.role, bio: s.bio, sortOrder: i,
        services: { create: s.serviceIds.filter((id) => salon.services.some((x) => x.id === id)).map((serviceId) => ({ serviceId })) },
      },
    });
  }
  const staff: StaffLite[] = salon.staff.map((s) => ({ id: s.id, name: s.name, serviceIds: s.serviceIds }));
  const serviceById = new Map(salon.services.map((s) => [s.id, s]));

  const now = new Date();
  const today = dateKeyOf(now, SALON_TZ);

  const customers = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    const area = i % 3 === 2 ? "778" : "604";
    const phone = `+1${area}5550${String(100 + i).slice(-3)}`;
    const birthYear = c.kind === "k" ? 2017 : c.kind === "sm" || c.kind === "sf" ? 1952 + (i % 6) : 1970 + ((i * 7) % 33);
    customers.push(
      await prisma.customer.create({
        data: {
          name: c.name,
          phone,
          email: c.email ? emailFor(c.name) : null,
          mailingAddress: c.address ? JSON.stringify({ ...c.address, province: "BC", country: "CA" }) : null,
          birthday: c.birthday ? `${birthYear}-${c.birthday}` : null,
          preferredLanguage: c.lang ?? "en-US",
          tags: JSON.stringify(c.tags ?? []),
          referredBy: c.referredBy ?? null,
          createdAt: new Date(now.getTime() - (130 - i) * 86400000),
        },
      }),
    );
  }

  // Weighted pool so regulars show up more often.
  const pool: number[] = [];
  CUSTOMERS.forEach((c, i) => {
    for (let k = 0; k < (c.weight ?? 1); k++) pool.push(i);
  });

  const busy: BusyBlock[] = [];
  let created = 0;
  // 40 past visits over the last 120 days: the first 24 clients once each, plus
  // repeat visits for a handful of regulars. Then ~5 today and ~11 over the next 10 days.
  const pastClients = [...Array(24).keys(), 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 4, 4, 26, 26, 6, 6];
  const futureClients = [24, 25, 27, 28, 29, 26];
  const plan: { dayOffset: number; ci: number }[] = [];
  for (const ci of pastClients) plan.push({ dayOffset: -Math.floor(1 + rand() * 119), ci });
  for (let k = 0; k < 5; k++) plan.push({ dayOffset: 0, ci: k < 2 ? futureClients[k + 4] : pick(pool) });
  for (let k = 0; k < 11; k++) plan.push({ dayOffset: 1 + Math.floor(rand() * 10), ci: k < 4 ? futureClients[k] : pick(pool) });

  for (const p of plan) {
    const ci = p.ci;
    const c = CUSTOMERS[ci];
    const date = addDays(today, p.dayOffset);
    let placed = false;
    for (let attempt = 0; attempt < 6 && !placed; attempt++) {
      const serviceId = pick(SERVICES_BY_KIND[c.kind]);
      const svc = serviceById.get(serviceId)!;
      const wantStaff = rand() < 0.5 ? pick(staff.filter((s) => s.serviceIds.includes(serviceId))).id : undefined;
      const slots = computeSlots({
        date, serviceId, durationMin: svc.durationMin, staff, bookings: busy, hours: salon.hours, tz: SALON_TZ,
        now: zonedTime(date, 0, SALON_TZ), staffId: wantStaff,
      });
      if (!slots.length) continue;
      // Prefer round-ish times for realism.
      const nice = slots.filter((s) => s.start.getUTCMinutes() % 30 === 0);
      const slot = pick(nice.length ? nice : slots);
      const isPast = slot.end <= now;
      let status = "confirmed";
      if (isPast) {
        const r = rand();
        status = r < 0.86 ? "completed" : r < 0.93 ? "no-show" : "cancelled";
      } else if (p.dayOffset > 0 && rand() < 0.08) status = "cancelled";
      const source = pick(["phone", "phone", "walk-in", "walk-in", "web", "admin"]);
      const booking = await prisma.booking.create({
        data: {
          serviceId, staffId: slot.staffId, customerId: customers[ci].id, start: slot.start, end: slot.end,
          status, source, priceCAD: svc.priceCAD, notes: rand() < 0.25 ? pick(NOTES) : null,
          createdAt: new Date(Math.min(slot.start.getTime() - 3 * 86400000 * rand(), now.getTime())),
        },
      });
      if (status !== "cancelled") {
        busy.push({ id: booking.id, staffId: slot.staffId, start: slot.start, end: slot.end });
        await prisma.slotLock.createMany({
          data: blocksFor(slot.start, slot.end).map((slotStart) => ({ staffId: slot.staffId, slotStart, bookingId: booking.id })),
        });
      }
      created++;
      placed = true;
    }
  }

  // Caller profiles for people who have phoned the AI agent.
  for (const [i, c] of CUSTOMERS.entries()) {
    if (!c.calls) continue;
    await prisma.callerProfile.create({
      data: {
        phone: customers[i].phone, name: c.name, preferredLanguage: c.lang ?? "en-US", callCount: c.calls,
        lastCallAt: new Date(now.getTime() - (i + 1) * 3 * 86400000), customerId: customers[i].id,
      },
    });
  }
  // A caller who has phoned but never booked.
  await prisma.callerProfile.create({
    data: { phone: "+17785550188", name: "Mrs. Tsang", preferredLanguage: "zh-HK", callCount: 1, lastCallAt: new Date(now.getTime() - 2 * 3600000) },
  });

  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000);
  await prisma.message.createMany({
    data: [
      { callerName: "Mrs. Tsang", phone: "+17785550188", message: "Asked (in Cantonese) whether a digital perm is suitable for fine, colour-treated hair. Would like a call back before booking.", urgency: "normal", source: "phone", createdAt: hoursAgo(2) },
      { callerName: "Arash Rahimi", phone: customers[8].phone, message: "Running 20 minutes late for his next appointment and wants to know if he should rebook.", urgency: "high", source: "phone", createdAt: hoursAgo(5) },
      { callerName: "Grace Huang", phone: customers[19].phone, message: "Bridal party of 4 for updos on a Saturday in November. Asking about group pricing.", urgency: "normal", source: "phone", createdAt: hoursAgo(26) },
      { callerName: "Unknown caller", phone: "+16045550177", message: "Asked if you sell the keratin shampoo used in treatments. No callback needed unless in stock.", urgency: "low", source: "phone", status: "done", createdAt: hoursAgo(50) },
    ],
  });

  console.log(`Seeded ${salon.services.length} services, ${salon.staff.length} staff, ${customers.length} customers, ${created} bookings, 4 messages.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
