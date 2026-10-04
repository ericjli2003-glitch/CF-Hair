import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { hoursOn, type SalonData, type Service, type Staff } from "../salon.js";
import { isLanguageCode } from "../languages.js";
import {
  ApiError,
  ApiUnavailableError,
  type Availability,
  type Booking,
  type BookingApi,
  type CallerProfile,
  type CallerUpdate,
  type CreateBookingInput,
  type MessageInput,
  type Slot,
  type SmsConsentInput,
  type CallPayload,
} from "./types.js";

export interface StoredMessage extends MessageInput {
  id: string;
  createdAt: string;
}

export interface MockOptions {
  now?: () => DateTime;
  slotStepMin?: number;
  /** Add a few sample bookings and caller profiles used by the demo. */
  seedDemoData?: boolean;
}

/** Demo phone numbers used by `npm run demo` and the tests. */
export const DEMO_PHONES = {
  newCaller: "+16045550123",
  rescheduler: "+16045550199",
  mandarin: "+16045550168",
  korean: "+16045550142",
  returningCantonese: "+16045550188",
  newCantonese: "+16045550177",
} as const;

/**
 * In-memory implementation of the booking API contract. Used by `--mock`, the demo,
 * the tests, and (wrapped in HTTP by src/mock/server.ts) as a stand-in website.
 */
export class InMemoryBookingApi implements BookingApi {
  readonly bookings: Booking[] = [];
  readonly messages: StoredMessage[] = [];
  readonly callers = new Map<string, CallerProfile>();
  /** Promotional SMS consent by phone, with the append-only event list the website keeps. */
  readonly consents = new Map<string, { status: "none" | "express"; declinedAt: string | null }>();
  readonly consentEvents: (SmsConsentInput & { at: string })[] = [];
  /** POST /api/calls records, upserted by callSid. `posts` counts every POST for tests. */
  readonly calls = new Map<string, CallPayload & { id: string }>();
  callPosts = 0;
  /** Set to true to simulate the website being down. */
  offline = false;
  private readonly now: () => DateTime;
  private readonly step: number;

  constructor(
    private readonly salon: SalonData,
    opts: MockOptions = {},
  ) {
    this.now = opts.now ?? (() => DateTime.now());
    this.step = opts.slotStepMin ?? 30;
    if (opts.seedDemoData) this.seedDemoData();
  }

  private check() {
    if (this.offline) throw new ApiUnavailableError("mock API is offline");
  }

  private local(dt: DateTime) {
    return dt.setZone(this.salon.timezone);
  }

  private service(id: string): Service {
    const s = this.salon.services.find((x) => x.id === id);
    if (!s) throw new ApiError(404, "SERVICE_NOT_FOUND", `unknown service ${id}`);
    return s;
  }

  private staffFor(serviceId: string, staffId?: string): Staff[] {
    const list = this.salon.staff.filter((s) => s.serviceIds.includes(serviceId));
    if (!staffId) return list;
    const one = list.filter((s) => s.id === staffId);
    if (!one.length) throw new ApiError(400, "STAFF_CANNOT_DO_SERVICE", `staff ${staffId} does not offer ${serviceId}`);
    return one;
  }

  private isFree(staffId: string, start: DateTime, end: DateTime, ignoreId?: string): boolean {
    return !this.bookings.some(
      (b) =>
        b.status === "confirmed" &&
        b.staffId === staffId &&
        b.id !== ignoreId &&
        DateTime.fromISO(b.start) < end &&
        DateTime.fromISO(b.end) > start,
    );
  }

  private freeSlots(serviceId: string, date: string, staffId?: string, ignoreId?: string): Slot[] {
    const svc = this.service(serviceId);
    const day = DateTime.fromISO(date, { zone: this.salon.timezone });
    if (!day.isValid) throw new ApiError(400, "BAD_DATE", "date must be YYYY-MM-DD");
    const hours = hoursOn(this.salon, day);
    if (!hours) return [];
    const earliest = this.local(this.now()).plus({ minutes: 30 });
    const slots: Slot[] = [];
    for (let t = hours.open; t.plus({ minutes: svc.durationMin }) <= hours.close; t = t.plus({ minutes: this.step })) {
      if (t < earliest) continue;
      const end = t.plus({ minutes: svc.durationMin });
      for (const st of this.staffFor(serviceId, staffId)) {
        if (this.isFree(st.id, t, end, ignoreId)) {
          slots.push({ start: t.toISO()!, end: end.toISO()!, staffId: st.id, staffName: st.name });
          if (!staffId) break; // "anyone": one slot per start time
        }
      }
    }
    return slots;
  }

  async getServices(): Promise<Service[]> {
    this.check();
    return this.salon.services;
  }

  async getStaff(): Promise<Staff[]> {
    this.check();
    return this.salon.staff;
  }

  async getAvailability(q: { serviceId: string; date: string; staffId?: string }): Promise<Availability> {
    this.check();
    return { date: q.date, slots: this.freeSlots(q.serviceId, q.date, q.staffId) };
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    this.check();
    const svc = this.service(input.serviceId);
    const start = DateTime.fromISO(input.start, { setZone: true });
    if (!start.isValid) throw new ApiError(400, "BAD_START", "start must be ISO 8601");
    const end = start.plus({ minutes: svc.durationMin });
    const date = this.local(start).toISODate()!;
    const free = this.freeSlots(svc.id, date, input.staffId).filter((s) => +DateTime.fromISO(s.start) === +start);
    if (!free.length) throw new ApiError(409, "SLOT_TAKEN", "slot is no longer free");
    const staff = this.salon.staff.find((s) => s.id === free[0].staffId)!;
    const booking: Booking = {
      id: `bk_${randomUUID().slice(0, 8)}`,
      serviceId: svc.id,
      serviceName: svc.name,
      staffId: staff.id,
      staffName: staff.name,
      start: this.local(start).toISO()!,
      end: this.local(end).toISO()!,
      status: "confirmed",
      customer: { name: input.customer.name, phone: input.customer.phone, email: input.customer.email ?? null },
      source: input.source,
      notes: input.notes ?? null,
      createdAt: this.now().toISO()!,
    };
    this.bookings.push(booking);
    return booking;
  }

  async lookupBookings(phone: string): Promise<Booking[]> {
    this.check();
    const now = this.now();
    return this.bookings
      .filter((b) => b.customer.phone === phone && b.status === "confirmed" && DateTime.fromISO(b.end) > now)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  private find(id: string): Booking {
    const b = this.bookings.find((x) => x.id === id);
    if (!b) throw new ApiError(404, "BOOKING_NOT_FOUND", `no booking ${id}`);
    return b;
  }

  async cancelBooking(id: string): Promise<Booking> {
    this.check();
    const b = this.find(id);
    b.status = "cancelled";
    return b;
  }

  async rescheduleBooking(id: string, body: { start: string; staffId?: string }): Promise<Booking> {
    this.check();
    const b = this.find(id);
    if (b.status !== "confirmed") throw new ApiError(400, "NOT_CONFIRMED", "only confirmed bookings can move");
    const svc = this.service(b.serviceId);
    const start = DateTime.fromISO(body.start, { setZone: true });
    if (!start.isValid) throw new ApiError(400, "BAD_START", "start must be ISO 8601");
    const date = this.local(start).toISODate()!;
    const free = this.freeSlots(svc.id, date, body.staffId, b.id).filter((s) => +DateTime.fromISO(s.start) === +start);
    if (!free.length) throw new ApiError(409, "SLOT_TAKEN", "slot is no longer free");
    const pick = free.find((s) => s.staffId === b.staffId) ?? free[0];
    b.start = this.local(start).toISO()!;
    b.end = this.local(start.plus({ minutes: svc.durationMin })).toISO()!;
    b.staffId = pick.staffId;
    b.staffName = pick.staffName;
    return b;
  }

  async postMessage(input: MessageInput): Promise<unknown> {
    this.check();
    const m: StoredMessage = { ...input, id: `msg_${randomUUID().slice(0, 8)}`, createdAt: this.now().toISO()! };
    this.messages.push(m);
    return { message: m };
  }

  private smsConsentFor(phone: string): NonNullable<CallerProfile["smsConsent"]> {
    const c = this.consents.get(phone) ?? { status: "none" as const, declinedAt: null };
    return { status: c.status, canAsk: c.status === "none" && !c.declinedAt, declinedAt: c.declinedAt };
  }

  async getCaller(phone: string): Promise<CallerProfile> {
    this.check();
    const base = this.callers.get(phone) ?? { phone, preferredLanguage: "en-US", callCount: 0, lastCallAt: null, name: null };
    return { ...base, smsConsent: this.smsConsentFor(phone) };
  }

  async postCall(call: CallPayload): Promise<{ call: CallPayload & { id: string }; created: boolean }> {
    this.check();
    this.callPosts++;
    for (const k of ["callSid", "startedAt", "endedAt", "language", "languageSource", "outcome", "summary", "transcript"] as const) {
      if (call[k] === undefined || call[k] === null) throw new ApiError(400, "BAD_CALL", `missing ${k}`);
    }
    const existing = this.calls.get(call.callSid);
    const saved = { ...call, id: existing?.id ?? `call_${randomUUID().slice(0, 8)}` };
    this.calls.set(call.callSid, saved);
    return { call: saved, created: !existing };
  }

  async recordSmsConsent(input: SmsConsentInput): Promise<unknown> {
    this.check();
    if (!/^\+\d{10,15}$/.test(input.phone ?? "")) throw new ApiError(400, "INVALID_PHONE", "phone must be E.164");
    if (input.status !== "express" && input.status !== "declined") throw new ApiError(400, "INVALID_STATUS", "bad status");
    if (input.status === "express" && !input.wording?.trim()) throw new ApiError(400, "WORDING_REQUIRED", "wording required");
    const cur = this.consents.get(input.phone) ?? { status: "none" as const, declinedAt: null };
    this.consents.set(
      input.phone,
      input.status === "express" ? { status: "express", declinedAt: cur.declinedAt } : { status: cur.status, declinedAt: this.now().toISO() },
    );
    this.consentEvents.push({ ...input, at: this.now().toISO()! });
    return { consent: { phone: input.phone, ...this.smsConsentFor(input.phone) } };
  }

  async putCaller(phone: string, update: CallerUpdate): Promise<CallerProfile> {
    this.check();
    if (update.preferredLanguage !== undefined && !isLanguageCode(update.preferredLanguage)) {
      throw new ApiError(400, "BAD_LANGUAGE", "unsupported preferredLanguage");
    }
    const cur = this.callers.get(phone) ?? { phone, preferredLanguage: "en-US", callCount: 0, lastCallAt: null, name: null };
    const next: CallerProfile = {
      ...cur,
      ...(update.preferredLanguage ? { preferredLanguage: update.preferredLanguage } : {}),
      ...(update.name ? { name: update.name } : {}),
      ...(update.incrementCallCount ? { callCount: cur.callCount + 1, lastCallAt: this.now().toISO() } : {}),
    };
    this.callers.set(phone, next);
    return next;
  }

  /** Sample data: a booking to reschedule, a returning Cantonese caller, and a few busy slots. */
  seedDemoData() {
    const now = this.local(this.now());
    // Next weekday at least two days out, so the demo reschedule always has room.
    let d = now.plus({ days: 2 });
    while (d.weekday > 5) d = d.plus({ days: 1 });
    const at = (day: DateTime, h: number, m = 0) => day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
    const add = (serviceId: string, staffId: string, start: DateTime, name: string, phone: string) => {
      const svc = this.service(serviceId);
      const staff = this.salon.staff.find((s) => s.id === staffId)!;
      this.bookings.push({
        id: `bk_seed${this.bookings.length + 1}`,
        serviceId,
        serviceName: svc.name,
        staffId,
        staffName: staff.name,
        start: start.toISO()!,
        end: start.plus({ minutes: svc.durationMin }).toISO()!,
        status: "confirmed",
        customer: { name, phone, email: null },
        source: "phone",
        notes: null,
        createdAt: now.minus({ days: 3 }).toISO()!,
      });
    };
    add("womens-cut", "stylist-a", at(d, 11), "Jordan Lee", DEMO_PHONES.rescheduler);
    const tomorrow = now.plus({ days: 1 });
    add("highlights", "stylist-a", at(tomorrow, 13), "Priya Singh", "+16045550111");
    add("mens-perm", "stylist-b", at(tomorrow, 14), "Daniel Park", "+16045550112");
    add("kids-cut", "stylist-c", at(tomorrow, 14), "Mia Wong", "+16045550113");
    this.callers.set(DEMO_PHONES.returningCantonese, {
      phone: DEMO_PHONES.returningCantonese,
      name: "Mrs. Chan",
      preferredLanguage: "zh-HK",
      callCount: 3,
      lastCallAt: now.minus({ days: 20 }).toISO(),
    });
  }
}
