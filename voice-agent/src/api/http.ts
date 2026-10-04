import type { Service, Staff } from "../salon.js";
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
  type SmsConsentInput,
  type CallPayload,
} from "./types.js";

/** Client for the website's booking API (docs/ARCHITECTURE.md). */
export class HttpBookingApi implements BookingApi {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 5000,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ApiUnavailableError(`${method} ${path} failed: ${(err as Error).message}`);
    }
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if ([502, 503, 504].includes(res.status)) {
      throw new ApiUnavailableError(`${method} ${path} returned ${res.status}`);
    }
    if (!res.ok) {
      const code =
        data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `HTTP_${res.status}`;
      throw new ApiError(res.status, code, `${method} ${path} returned ${res.status} ${code}`);
    }
    return data as T;
  }

  getServices(): Promise<Service[]> {
    return this.request("GET", "/api/services");
  }

  getStaff(): Promise<Staff[]> {
    return this.request("GET", "/api/staff");
  }

  getAvailability(q: { serviceId: string; date: string; staffId?: string }): Promise<Availability> {
    const p = new URLSearchParams({ serviceId: q.serviceId, date: q.date });
    if (q.staffId) p.set("staffId", q.staffId);
    return this.request("GET", `/api/availability?${p}`);
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const r = await this.request<{ booking: Booking }>("POST", "/api/bookings", input);
    return r.booking;
  }

  async lookupBookings(phone: string): Promise<Booking[]> {
    const r = await this.request<Booking[] | { bookings: Booking[] }>(
      "GET",
      `/api/bookings/lookup?${new URLSearchParams({ phone })}`,
    );
    return Array.isArray(r) ? r : (r?.bookings ?? []);
  }

  async cancelBooking(id: string): Promise<Booking> {
    const r = await this.request<{ booking: Booking }>("POST", `/api/bookings/${encodeURIComponent(id)}/cancel`, {});
    return r.booking;
  }

  async rescheduleBooking(id: string, body: { start: string; staffId?: string }): Promise<Booking> {
    const r = await this.request<{ booking: Booking } | Booking>(
      "POST",
      `/api/bookings/${encodeURIComponent(id)}/reschedule`,
      body,
    );
    return "booking" in r ? r.booking : r;
  }

  postMessage(input: MessageInput): Promise<unknown> {
    return this.request("POST", "/api/messages", input);
  }

  getCaller(phone: string, timeoutMs?: number): Promise<CallerProfile> {
    return this.request("GET", `/api/callers/${encodeURIComponent(phone)}`, undefined, timeoutMs);
  }

  putCaller(phone: string, update: CallerUpdate): Promise<CallerProfile> {
    return this.request("PUT", `/api/callers/${encodeURIComponent(phone)}`, update);
  }

  postCall(call: CallPayload): Promise<unknown> {
    return this.request("POST", "/api/calls", call);
  }

  recordSmsConsent(input: SmsConsentInput): Promise<unknown> {
    return this.request("POST", "/api/customers/consent", input);
  }
}
