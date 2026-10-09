import { DateTime } from "luxon";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { ApiError, ApiUnavailableError, type BookingApi, type Booking, type Slot } from "../api/types.js";
import { hoursOn, openStatus, type SalonData } from "../salon.js";
import { LANGUAGE_CODES, type LanguageCode } from "../languages.js";
import { isAnonymousCaller, phoneForSpeech, toE164 } from "../phone.js";
import { SMS_OPTIN_QUESTION } from "./sms-optin.js";

export type Outcome = "booked" | "rescheduled" | "cancelled" | "message" | "transferred" | "info-only" | "abandoned";

/** What tools can do to the call. Implemented by CallSession. */
export interface ToolHooks {
  callSid: string;
  callerPhone: string | null;
  currentLanguage(): LanguageCode;
  /** Switch voice and transcription and save the preference. `refused` when the transcript does not support it. */
  switchLanguage(code: LanguageCode): Promise<{ saved: "api" | "local" | "skipped"; refused?: string }>;
  /** Speak the four-language "which language?" question. Optional; absent means not available. */
  askLanguage?(): { ok: boolean; spoken: string };
  requestEnd(reason: string): void;
  requestTransfer(reason: string, summary: string): { ok: boolean; why?: string };
  recordOutcome(outcome: Outcome, detail?: Record<string, unknown>): void;
  rememberName(name: string): void;
  sendMessage(input: { callerName: string; phone: string; message: string; urgency: "low" | "normal" | "high" }): Promise<"sent" | "queued">;
  now(): DateTime;
  /** Promotional SMS opt-in (optional: absent means never ask). */
  smsOptIn?: SmsOptInHooks;
}

export interface SmsOptInHooks {
  /** Caller ID present, the website has no answer on file, and it has not been offered on this call. */
  eligible(): boolean;
  offered(): boolean;
  markOffered(): void;
  /** Posts to /api/customers/consent with source "phone" and the exact wording spoken. */
  record(accepted: boolean, language: LanguageCode): Promise<"saved" | "failed">;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const isoDateTime = z
  .string()
  .refine((s) => DateTime.fromISO(s, { setZone: true }).isValid, "use ISO 8601 date and time, for example 2026-10-04T14:30:00-07:00");

export const ToolInputSchemas = {
  get_services: z.object({ category: z.string().optional() }).strict(),
  check_availability: z
    .object({
      service_id: z.string().min(1),
      date: isoDate,
      staff_id: z.string().min(1).optional(),
      time_preference: z.enum(["morning", "afternoon", "evening", "any"]).optional(),
      earliest_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    })
    .strict(),
  book_appointment: z
    .object({
      service_id: z.string().min(1),
      start: isoDateTime,
      staff_id: z.string().min(1).optional(),
      customer_name: z.string().trim().min(1),
      customer_phone: z.string().optional(),
      notes: z.string().max(500).optional(),
      confirmed_with_caller: z.literal(true, { message: "confirm service, stylist, time and name with the caller first" }),
    })
    .strict(),
  lookup_bookings: z.object({ phone: z.string().optional() }).strict(),
  cancel_booking: z
    .object({
      booking_id: z.string().min(1),
      confirmed_with_caller: z.literal(true, { message: "confirm the cancellation with the caller first" }),
    })
    .strict(),
  reschedule_booking: z
    .object({
      booking_id: z.string().min(1),
      new_start: isoDateTime,
      staff_id: z.string().min(1).optional(),
      confirmed_with_caller: z.literal(true, { message: "confirm the new time with the caller first" }),
    })
    .strict(),
  take_message: z
    .object({
      caller_name: z.string().trim().min(1),
      callback_phone: z.string().optional(),
      message: z.string().trim().min(1).max(1000),
      urgency: z.enum(["low", "normal", "high"]),
      reason: z.enum(["callback", "booking_request", "complaint", "question", "other"]),
    })
    .strict(),
  transfer_to_human: z.object({ reason: z.string().min(1), summary: z.string().min(1).max(500) }).strict(),
  end_call: z.object({ reason: z.enum(["completed", "spam", "caller_request", "no_response"]) }).strict(),
  set_language: z.object({ language: z.enum(LANGUAGE_CODES) }).strict(),
  ask_caller_language: z.object({ reason: z.string().max(200).optional() }).strict(),
  record_sms_consent: z.object({ accepted: z.boolean() }).strict(),
} as const;

export type ToolName = keyof typeof ToolInputSchemas;

type ToolDef = Anthropic.Beta.BetaTool;

/** Tool definitions in a fixed order (the order is part of the prompt cache key). */
export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: "get_services",
    description:
      "List the salon's services with prices in Canadian dollars and durations, plus which stylists do each. Use when the caller asks about services or prices and you need the live list.",
    input_schema: {
      type: "object",
      properties: { category: { type: "string", description: "Optional filter: Haircuts, Styling, Colour, Perm, Treatment, Extensions." } },
      additionalProperties: false,
    },
  },
  {
    name: "check_availability",
    description:
      "Find open appointment times for one service on one date. Returns up to eight start times with stylist names. If that day has nothing, it also returns the next days that have openings.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "Service id, for example mens-cut." },
        date: { type: "string", description: "Date in YYYY-MM-DD, salon timezone." },
        staff_id: { type: "string", description: "Only if the caller asked for a specific stylist." },
        time_preference: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
        earliest_time: { type: "string", description: "Optional HH:MM 24 hour clock, only show times at or after this." },
      },
      required: ["service_id", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "book_appointment",
    description:
      "Book an appointment. Only call after the caller confirmed service, stylist, day and time, and name. start must be one of the start values returned by check_availability.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        start: { type: "string", description: "ISO 8601 start with offset, copied from check_availability." },
        staff_id: { type: "string", description: "Stylist id from the chosen slot." },
        customer_name: { type: "string" },
        customer_phone: { type: "string", description: "Only if different from the caller ID. Digits as spoken." },
        notes: { type: "string", description: "Short note for the stylist, for example hair length." },
        confirmed_with_caller: { type: "boolean", description: "Must be true: the caller said yes to the details." },
      },
      required: ["service_id", "start", "customer_name", "confirmed_with_caller"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_bookings",
    description: "Find the caller's upcoming appointments. Uses the caller ID unless the caller gives another number.",
    input_schema: {
      type: "object",
      properties: { phone: { type: "string", description: "Only if the booking is under a different number." } },
      additionalProperties: false,
    },
  },
  {
    name: "cancel_booking",
    description: "Cancel an appointment found with lookup_bookings, after the caller confirmed.",
    input_schema: {
      type: "object",
      properties: { booking_id: { type: "string" }, confirmed_with_caller: { type: "boolean" } },
      required: ["booking_id", "confirmed_with_caller"],
      additionalProperties: false,
    },
  },
  {
    name: "reschedule_booking",
    description:
      "Move an appointment found with lookup_bookings to a new time from check_availability, after the caller confirmed.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: { type: "string" },
        new_start: { type: "string", description: "ISO 8601 start with offset from check_availability." },
        staff_id: { type: "string" },
        confirmed_with_caller: { type: "boolean" },
      },
      required: ["booking_id", "new_start", "confirmed_with_caller"],
      additionalProperties: false,
    },
  },
  {
    name: "take_message",
    description:
      "Leave a callback request for the salon team: questions you cannot answer, booking requests when the system is down, complaints (urgency high), or callers who want a person when no one is available.",
    input_schema: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        callback_phone: { type: "string", description: "Only if different from the caller ID." },
        message: { type: "string", description: "One or two sentences in English for the team, including what the caller wants." },
        urgency: { type: "string", enum: ["low", "normal", "high"] },
        reason: { type: "string", enum: ["callback", "booking_request", "complaint", "question", "other"] },
      },
      required: ["caller_name", "message", "urgency", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "transfer_to_human",
    description:
      "Transfer the caller to the salon team. Only works while the salon is open. Tell the caller you are connecting them after this succeeds.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        summary: { type: "string", description: "One sentence in English for the staff member picking up." },
      },
      required: ["reason", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "end_call",
    description: "Hang up after your goodbye has been said in this same reply. Use when the caller is done, or for spam.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", enum: ["completed", "spam", "caller_request", "no_response"] } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  {
    name: "set_language",
    description:
      "Switch the call's speech recognition and voice to another language and remember it for this caller's number. Use when the caller asks for Mandarin (zh-CN), Cantonese (zh-HK), Korean (ko-KR) or English (en-US), or clearly speaks it. The phone system already switches automatically when it sees Chinese or Korean text, so you rarely need this. It refuses a switch the transcript does not support, such as English because of one word.",
    input_schema: {
      type: "object",
      properties: { language: { type: "string", enum: [...LANGUAGE_CODES] } },
      required: ["language"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_caller_language",
    description:
      "Speaks one short question in English, Mandarin, Cantonese and Korean asking the caller to press 1, 2, 3 or 4 for their language, and ends your reply. Use when the transcript looks like nonsense English or romanized syllables, which usually means the caller is speaking another language. Do not guess a language in that case. Say nothing else in the same reply.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "Short note for the call log." } },
      additionalProperties: false,
    },
  },
  {
    name: "record_sms_consent",
    description:
      "Save the caller's answer to the promotional text question. Only usable after a book_appointment result included smsOptIn and you asked that exact question. accepted is true only for a clear yes; anything else is false.",
    input_schema: {
      type: "object",
      properties: { accepted: { type: "boolean", description: "true for a clear yes, false for no or unsure." } },
      required: ["accepted"],
      additionalProperties: false,
    },
  },
].map((t) => ({ ...t, eager_input_streaming: true }) as ToolDef);

export interface ToolResult {
  content: string;
  isError: boolean;
}

/** Validate tool input against its schema. Exported for tests. */
export function validateToolInput(name: string, input: unknown):
  | { ok: true; name: ToolName; data: any }
  | { ok: false; error: string } {
  if (!(name in ToolInputSchemas)) {
    const lower = name.toLowerCase();
    const match = (Object.keys(ToolInputSchemas) as ToolName[]).find((k) => k.toLowerCase() === lower);
    if (!match) return { ok: false, error: `Unknown tool "${name}". Available: ${Object.keys(ToolInputSchemas).join(", ")}.` };
    name = match;
  }
  const parsed = ToolInputSchemas[name as ToolName].safeParse(input ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { ok: false, error: `Invalid input for ${name}: ${msg}` };
  }
  return { ok: true, name: name as ToolName, data: parsed.data };
}

const json = (v: unknown): ToolResult => ({ content: JSON.stringify(v), isError: false });
const fail = (msg: string, extra: Record<string, unknown> = {}): ToolResult => ({
  content: JSON.stringify({ error: msg, ...extra }),
  isError: true,
});
const OFFLINE = {
  error: "BOOKING_SYSTEM_UNAVAILABLE",
  instruction:
    "The booking system is offline right now. Do not promise a time. Apologize and offer to take a message with take_message so the team calls back to book.",
};

export class ToolExecutor {
  constructor(
    private readonly api: BookingApi,
    private readonly salon: SalonData,
    private readonly hooks: ToolHooks,
  ) {}

  private spoken(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true }).setZone(this.salon.timezone).toFormat("cccc, LLLL d 'at' h:mm a");
  }

  private slotView = (s: Slot) => ({ start: s.start, spoken: this.spoken(s.start), staffId: s.staffId, staffName: s.staffName });

  private bookingView = (b: Booking) => ({
    id: b.id,
    service: b.serviceName,
    serviceId: b.serviceId,
    stylist: b.staffName,
    staffId: b.staffId,
    start: b.start,
    spoken: this.spoken(b.start),
    status: b.status,
    name: b.customer?.name,
  });

  async run(name: string, input: unknown): Promise<ToolResult> {
    const v = validateToolInput(name, input);
    if (!v.ok) return fail(v.error);
    try {
      return await this.dispatch(v.name, v.data);
    } catch (err) {
      if (err instanceof ApiUnavailableError) return { content: JSON.stringify(OFFLINE), isError: true };
      if (err instanceof ApiError) return fail(err.code, { status: err.status });
      return fail(`Unexpected error: ${(err as Error).message}`);
    }
  }

  private async dispatch(name: ToolName, d: any): Promise<ToolResult> {
    switch (name) {
      case "get_services":
        return this.getServices(d.category);
      case "check_availability":
        return this.checkAvailability(d);
      case "book_appointment":
        return this.book(d);
      case "lookup_bookings":
        return this.lookup(d.phone);
      case "cancel_booking":
        return this.cancel(d.booking_id);
      case "reschedule_booking":
        return this.reschedule(d);
      case "take_message":
        return this.takeMessage(d);
      case "transfer_to_human": {
        const r = this.hooks.requestTransfer(d.reason, d.summary);
        return r.ok
          ? json({ ok: true, instruction: "Say one short sentence that you are connecting them now. The call transfers after you finish speaking." })
          : fail(r.why ?? "Transfer not available", { instruction: "Offer to take a message instead." });
      }
      case "end_call":
        this.hooks.requestEnd(d.reason);
        // Nothing more is said: no "the call has ended" after the goodbye.
        return json({ ok: true, instruction: "Done. Say nothing more at all: reply with an empty message. Never mention that the call is ending or has ended." });
      case "record_sms_consent":
        return this.recordSmsConsent(d.accepted);
      case "ask_caller_language": {
        const r = this.hooks.askLanguage?.() ?? { ok: false, spoken: "" };
        return r.ok
          ? json({ ok: true, spoken: r.spoken, instruction: "The question has been spoken. Wait for the caller's keypad press or answer." })
          : fail("Already asked twice on this call.", {
              instruction: "Briefly ask in English whether they would like English, Mandarin, Cantonese or Korean, or offer to take a message.",
            });
      }
      case "set_language": {
        const before = this.hooks.currentLanguage();
        const { saved, refused } = await this.hooks.switchLanguage(d.language);
        if (refused) {
          return fail(`Language not changed: ${refused}`, {
            currentLanguage: before,
            instruction: `Keep speaking ${before}. If the caller seems to speak another language but the transcript is unclear, call ask_caller_language.`,
          });
        }
        return json({
          ok: true,
          language: d.language,
          previous: before,
          preferenceSaved: saved !== "skipped",
          instruction: `Speech recognition and voice are now ${d.language}. Reply only in this language from now on.`,
        });
      }
    }
  }

  private async getServices(category?: string): Promise<ToolResult> {
    let services = this.salon.services;
    let staff = this.salon.staff;
    let source = "live";
    try {
      [services, staff] = await Promise.all([this.api.getServices(), this.api.getStaff()]);
    } catch (err) {
      if (!(err instanceof ApiUnavailableError)) throw err;
      source = "salon.json (booking system offline, info is still accurate)";
    }
    const filtered = category ? services.filter((s) => s.category.toLowerCase() === category.toLowerCase()) : services;
    return json({
      source,
      services: filtered.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        priceCAD: s.priceCAD,
        durationMin: s.durationMin,
        stylists: staff.filter((st) => st.serviceIds.includes(s.id)).map((st) => st.name),
      })),
    });
  }

  private async checkAvailability(d: {
    service_id: string;
    date: string;
    staff_id?: string;
    time_preference?: string;
    earliest_time?: string;
  }): Promise<ToolResult> {
    const svc = this.salon.services.find((s) => s.id === d.service_id);
    if (!svc) return fail(`Unknown service_id ${d.service_id}. Use an id from the services list.`);
    if (d.staff_id) {
      const st = this.salon.staff.find((s) => s.id === d.staff_id);
      if (!st) return fail(`Unknown staff_id ${d.staff_id}.`);
      if (!st.serviceIds.includes(svc.id)) return fail(`${st.name} does not do ${svc.name}. Suggest another stylist or anyone.`);
    }
    const tz = this.salon.timezone;
    const today = this.hooks.now().setZone(tz).startOf("day");
    const day = DateTime.fromISO(d.date, { zone: tz });
    if (day < today) return fail("That date is in the past. Ask the caller for a future date.");
    if (day > today.plus({ days: 120 })) return fail("That date is too far ahead; bookings open about four months out.");

    const filter = (slots: Slot[]) =>
      slots.filter((s) => {
        const t = DateTime.fromISO(s.start, { setZone: true }).setZone(tz);
        if (d.earliest_time) {
          const [h, m] = d.earliest_time.split(":").map(Number);
          if (t.hour * 60 + t.minute < h * 60 + m) return false;
        }
        switch (d.time_preference) {
          case "morning":
            return t.hour < 12;
          case "afternoon":
            return t.hour >= 12 && t.hour < 17;
          case "evening":
            return t.hour >= 16;
          default:
            return true;
        }
      });

    const result = await this.api.getAvailability({ serviceId: svc.id, date: d.date, staffId: d.staff_id });
    const slots = filter(result.slots);
    const closed = !hoursOn(this.salon, day);
    const out: Record<string, unknown> = {
      service: svc.name,
      date: d.date,
      day: day.toFormat("cccc, LLLL d"),
      closedThatDay: closed,
      slots: slots.slice(0, 8).map(this.slotView),
      moreAvailable: slots.length > 8,
    };
    if (!slots.length) {
      const next: unknown[] = [];
      for (let i = 1; i <= 7 && next.length < 3; i++) {
        const nd = day.plus({ days: i });
        if (!hoursOn(this.salon, nd)) continue;
        const r = await this.api.getAvailability({ serviceId: svc.id, date: nd.toISODate()!, staffId: d.staff_id });
        const f = filter(r.slots);
        if (f.length) next.push({ date: nd.toISODate(), day: nd.toFormat("cccc, LLLL d"), firstSlots: f.slice(0, 3).map(this.slotView) });
      }
      out.nextDaysWithOpenings = next;
    }
    return json(out);
  }

  private resolvePhone(given?: string): string | null {
    if (given) return toE164(given);
    if (this.hooks.callerPhone && !isAnonymousCaller(this.hooks.callerPhone)) return toE164(this.hooks.callerPhone);
    return null;
  }

  private async book(d: {
    service_id: string;
    start: string;
    staff_id?: string;
    customer_name: string;
    customer_phone?: string;
    notes?: string;
  }): Promise<ToolResult> {
    const svc = this.salon.services.find((s) => s.id === d.service_id);
    if (!svc) return fail(`Unknown service_id ${d.service_id}.`);
    const phone = this.resolvePhone(d.customer_phone);
    if (!phone) return fail("No valid phone number. Ask the caller for a 10 digit callback number and read it back.");
    const start = DateTime.fromISO(d.start, { setZone: true });
    if (start < this.hooks.now()) return fail("That time has already passed. Check availability again.");
    try {
      const booking = await this.api.createBooking({
        serviceId: svc.id,
        staffId: d.staff_id,
        start: d.start,
        customer: { name: d.customer_name, phone },
        notes: [d.notes, "Booked by phone agent"].filter(Boolean).join(". "),
        source: "phone",
      });
      this.hooks.recordOutcome("booked", { bookingId: booking.id, service: booking.serviceName, start: booking.start });
      this.hooks.rememberName(d.customer_name);
      const out: Record<string, unknown> = {
        ok: true,
        booking: this.bookingView(booking),
        phoneOnFile: phoneForSpeech(phone),
        // Hang up after one goodbye, unless the caller still wants something (or the text question below comes first).
        next: "Unless the caller is still asking something, say one short goodbye in their language ending with the bye line, and end the call in that same reply. Do not wait for them to say goodbye back.",
      };
      // One polite promotional-text question, only for the caller's own number and only if never answered.
      const optIn = this.hooks.smsOptIn;
      if (optIn && phone === this.hooks.callerPhone && optIn.eligible()) {
        optIn.markOffered();
        const lang = this.hooks.currentLanguage();
        out.smsOptIn = {
          question: SMS_OPTIN_QUESTION[lang],
          instruction:
            "After confirming the booking, ask this question once, word for word, in the current language. Then call record_sms_consent with accepted true for a clear yes, false otherwise. Do not explain or persuade, and never ask again.",
        };
      }
      return json(out);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return fail("SLOT_TAKEN", { instruction: "Someone just took that time. Apologize and check availability again." });
      }
      throw err;
    }
  }

  private async recordSmsConsent(accepted: boolean): Promise<ToolResult> {
    const optIn = this.hooks.smsOptIn;
    if (!optIn || !optIn.offered()) {
      return fail("NOT_OFFERED", { instruction: "Only use this after a booking result included smsOptIn and you asked that question. Do not ask about texts otherwise." });
    }
    const saved = await optIn.record(accepted, this.hooks.currentLanguage());
    return json({
      ok: saved === "saved",
      accepted,
      instruction: accepted
        ? "Thank them in a few words. Do not mention texts again."
        : "Say no problem in a few words and move on. Never ask again.",
    });
  }

  private async lookup(given?: string): Promise<ToolResult> {
    const phone = this.resolvePhone(given);
    if (!phone) return fail("No caller ID. Ask which phone number the booking is under.");
    const list = await this.api.lookupBookings(phone);
    return json({ phone: phoneForSpeech(phone), upcoming: list.filter((b) => b.status === "confirmed").map(this.bookingView) });
  }

  private async cancel(id: string): Promise<ToolResult> {
    const b = await this.api.cancelBooking(id);
    const hoursAhead = DateTime.fromISO(b.start, { setZone: true }).diff(this.hooks.now(), "hours").hours;
    this.hooks.recordOutcome("cancelled", { bookingId: b.id, start: b.start });
    return json({
      ok: true,
      booking: this.bookingView(b),
      lessThanPolicyNotice: hoursAhead < this.salon.policies.cancellationHours,
      note:
        hoursAhead < this.salon.policies.cancellationHours
          ? `Less than ${this.salon.policies.cancellationHours} hours notice. Gently mention the notice policy for next time. Do not mention fees.`
          : undefined,
    });
  }

  private async reschedule(d: { booking_id: string; new_start: string; staff_id?: string }): Promise<ToolResult> {
    if (DateTime.fromISO(d.new_start, { setZone: true }) < this.hooks.now()) return fail("That time has already passed.");
    try {
      const b = await this.api.rescheduleBooking(d.booking_id, { start: d.new_start, staffId: d.staff_id });
      this.hooks.recordOutcome("rescheduled", { bookingId: b.id, start: b.start });
      return json({ ok: true, booking: this.bookingView(b) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return fail("SLOT_TAKEN", { instruction: "That time was just taken. Check availability again." });
      }
      throw err;
    }
  }

  private async takeMessage(d: {
    caller_name: string;
    callback_phone?: string;
    message: string;
    urgency: "low" | "normal" | "high";
    reason: string;
  }): Promise<ToolResult> {
    const phone = this.resolvePhone(d.callback_phone);
    if (!phone) return fail("No valid callback number. Ask for a 10 digit number and read it back.");
    const lang = this.hooks.currentLanguage();
    const message = `[${d.reason}] ${d.message} (phone agent, call ${this.hooks.callSid}${lang !== "en-US" ? `, caller language ${lang}` : ""})`;
    const delivery = await this.hooks.sendMessage({ callerName: d.caller_name, phone, message, urgency: d.urgency });
    this.hooks.recordOutcome("message", { urgency: d.urgency, reason: d.reason, delivery });
    this.hooks.rememberName(d.caller_name);
    const status = openStatus(this.salon, this.hooks.now());
    return json({
      ok: true,
      callbackNumber: phoneForSpeech(phone),
      salonOpenNow: status.isOpen,
      nextOpening: status.nextOpenText,
      instruction: "Tell the caller the team will call them back, during opening hours if the salon is closed.",
    });
  }
}
