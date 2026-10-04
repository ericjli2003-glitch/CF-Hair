import type { BookingView } from "./bookings";
import { dictionaries, fill, type Lang } from "./i18n/dictionary";
import { serviceName } from "./i18n/localize";
import { fullAddress, salon, formatPhoneDisplay } from "./salon";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);

/** Calendar file for a booking, with the title and notes in the visitor's site language. */
export function bookingToIcs(b: BookingView, lang: Lang = "en"): string {
  const t = dictionaries[lang];
  const vars = {
    service: serviceName(t, b.serviceId, b.serviceName),
    salon: salon.name,
    stylist: b.staffName,
    phone: formatPhoneDisplay(salon.phone),
  };
  const summary = fill(t.ics.summary, vars);
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
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(fill(t.ics.description, vars))}`,
    `LOCATION:${esc(fullAddress())}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
