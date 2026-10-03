import type { Service, Staff } from "../salon.js";
import type { LanguageCode } from "../languages.js";

/** Types and client interface for the booking API contract in docs/ARCHITECTURE.md. */

export interface Slot {
  start: string;
  end: string;
  staffId: string;
  staffName: string;
}

export interface Availability {
  date: string;
  slots: Slot[];
}

export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no-show";
export type BookingSource = "web" | "phone" | "walk-in" | "admin";

export interface Customer {
  name: string;
  phone: string;
  email?: string | null;
}

export interface Booking {
  id: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  start: string;
  end: string;
  status: BookingStatus;
  customer: Customer;
  source: BookingSource;
  notes?: string | null;
  createdAt: string;
}

export interface CreateBookingInput {
  serviceId: string;
  staffId?: string;
  start: string;
  customer: Customer;
  notes?: string;
  source: BookingSource;
}

export type Urgency = "low" | "normal" | "high";

export interface MessageInput {
  callerName: string;
  phone: string;
  message: string;
  urgency: Urgency;
}

export interface CallerProfile {
  phone: string;
  name?: string | null;
  preferredLanguage: LanguageCode | string;
  lastCallAt?: string | null;
  callCount: number;
  /** Promotional SMS consent. canAsk: no answer recorded yet, so the assistant may ask once. */
  smsConsent?: { status: string; canAsk: boolean; declinedAt?: string | null };
}

/** POST /api/customers/consent. "declined" records a no so the caller is never asked again. */
export interface SmsConsentInput {
  phone: string;
  status: "express" | "declined";
  source: "phone";
  wording: string;
  language: LanguageCode;
  detail?: Record<string, unknown>;
}

export interface CallerUpdate {
  preferredLanguage?: LanguageCode;
  name?: string;
  incrementCallCount?: boolean;
}

export interface BookingApi {
  getServices(): Promise<Service[]>;
  getStaff(): Promise<Staff[]>;
  getAvailability(q: { serviceId: string; date: string; staffId?: string }): Promise<Availability>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  lookupBookings(phone: string): Promise<Booking[]>;
  cancelBooking(id: string): Promise<Booking>;
  rescheduleBooking(id: string, body: { start: string; staffId?: string }): Promise<Booking>;
  postMessage(input: MessageInput): Promise<unknown>;
  getCaller(phone: string): Promise<CallerProfile>;
  putCaller(phone: string, update: CallerUpdate): Promise<CallerProfile>;
  recordSmsConsent(input: SmsConsentInput): Promise<unknown>;
}

/** The API answered with an error status (4xx or 5xx other than "unreachable"). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The API could not be reached (network error, timeout, or 502/503/504). */
export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnavailableError";
  }
}
