import type { BookingView } from "./bookings";
import { fullAddress, salon, formatPhoneDisplay } from "./salon";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);

export function bookingToIcs(b: BookingView): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CF Hair Salon//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.id}@cfhairsalon`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(b.start))}`,
    `DTEND:${stamp(new Date(b.end))}`,
    `SUMMARY:${esc(`${b.serviceName} at ${salon.name}`)}`,
    `DESCRIPTION:${esc(`With ${b.staffName}. To change or cancel, call ${formatPhoneDisplay(salon.phone)}.`)}`,
    `LOCATION:${esc(fullAddress())}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`${b.serviceName} at ${salon.name}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
