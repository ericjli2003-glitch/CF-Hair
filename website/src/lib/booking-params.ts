// Reads /book?service=<id>&staff=<id> into a validated starting point for the
// booking flow. Unknown or malformed ids are ignored, so a stale or edited link
// simply starts at step 1.

export type BookingStep = 0 | 1 | 2 | 3;

export interface BookingStart {
  serviceId?: string;
  staffId?: string;
  /** Stylist from the link, kept for when a service is chosen later. */
  pendingStaffId?: string;
  step: BookingStep;
}

type Param = string | string[] | undefined;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function one(v: Param): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return undefined;
  const id = s.trim();
  return ID.test(id) ? id : undefined;
}

export function parseBookingParams(
  params: Record<string, Param>,
  services: { id: string }[],
  staff: { id: string; serviceIds: string[] }[],
): BookingStart {
  const sid = one(params.service);
  const service = sid ? services.find((s) => s.id === sid) : undefined;
  const tid = one(params.staff);
  const stylist = tid ? staff.find((s) => s.id === tid) : undefined;

  if (!service) return { step: 0, pendingStaffId: stylist?.id };
  // A stylist who does not offer this service is dropped: the visitor picks one.
  if (stylist && stylist.serviceIds.includes(service.id)) {
    return { serviceId: service.id, staffId: stylist.id, pendingStaffId: stylist.id, step: 2 };
  }
  return { serviceId: service.id, step: 1 };
}

/** The /book URL that reproduces a choice, used to keep the address bar in step. */
export function bookingHref(serviceId?: string, staffId?: string): string {
  const qs = new URLSearchParams();
  if (serviceId) qs.set("service", serviceId);
  if (staffId && staffId !== "any") qs.set("staff", staffId);
  const s = qs.toString();
  return s ? `/book?${s}` : "/book";
}
