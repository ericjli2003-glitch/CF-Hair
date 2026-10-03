import { prisma } from "./db";
import { HttpError } from "./api";
import { DEFAULT_LANGUAGE, isLanguageCode, LANGUAGE_CODES, type LanguageCode } from "./languages";
import { toE164 } from "./phone";
import { SALON_TZ } from "./salon";
import { toZonedISO } from "./time";

export interface CallerView {
  phone: string;
  name?: string;
  preferredLanguage: LanguageCode;
  lastCallAt?: string;
  callCount: number;
  customerId?: string;
}

export function normalisePhoneParam(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  // A "+" in a path segment sometimes arrives as a space after form-style decoding.
  decoded = decoded.trim().replace(/^ /, "+");
  if (/^\d{11}$/.test(decoded) && decoded.startsWith("1")) decoded = `+${decoded}`;
  const e164 = toE164(decoded);
  if (!e164) throw new HttpError(400, "INVALID_PHONE", "Phone must be a valid number (E.164 preferred)");
  return e164;
}

export async function getCaller(phone: string): Promise<CallerView> {
  const profile = await prisma.callerProfile.findUnique({ where: { phone }, include: { customer: true } });
  if (profile) {
    return {
      phone,
      name: profile.name ?? profile.customer?.name ?? undefined,
      preferredLanguage: isLanguageCode(profile.preferredLanguage) ? profile.preferredLanguage : DEFAULT_LANGUAGE,
      lastCallAt: profile.lastCallAt ? toZonedISO(profile.lastCallAt, SALON_TZ) : undefined,
      callCount: profile.callCount,
      customerId: profile.customerId ?? undefined,
    };
  }
  const customer = await prisma.customer.findUnique({ where: { phone } });
  if (customer) {
    return {
      phone,
      name: customer.name,
      preferredLanguage: isLanguageCode(customer.preferredLanguage) ? customer.preferredLanguage : DEFAULT_LANGUAGE,
      callCount: 0,
      customerId: customer.id,
    };
  }
  return { phone, preferredLanguage: DEFAULT_LANGUAGE, callCount: 0 };
}

export async function putCaller(phone: string, body: Record<string, unknown>): Promise<CallerView> {
  const { preferredLanguage, name, incrementCallCount } = body;
  if (preferredLanguage !== undefined && !isLanguageCode(preferredLanguage)) {
    throw new HttpError(400, "INVALID_LANGUAGE", `preferredLanguage must be one of ${LANGUAGE_CODES.join(", ")}`);
  }
  if (name !== undefined && name !== null && (typeof name !== "string" || name.length > 120)) {
    throw new HttpError(400, "INVALID_NAME");
  }
  if (incrementCallCount !== undefined && typeof incrementCallCount !== "boolean") {
    throw new HttpError(400, "INVALID_BODY", "incrementCallCount must be a boolean");
  }
  const cleanName = typeof name === "string" && name.trim() ? name.trim() : undefined;

  await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { phone } });
    const existing = await tx.callerProfile.findUnique({ where: { phone } });
    const lang = (preferredLanguage as LanguageCode | undefined) ??
      existing?.preferredLanguage ?? customer?.preferredLanguage ?? DEFAULT_LANGUAGE;
    const inc = incrementCallCount === true;
    await tx.callerProfile.upsert({
      where: { phone },
      create: {
        phone,
        name: cleanName ?? customer?.name ?? null,
        preferredLanguage: lang,
        callCount: inc ? 1 : 0,
        lastCallAt: inc ? new Date() : null,
        customerId: customer?.id ?? null,
      },
      update: {
        ...(cleanName ? { name: cleanName } : {}),
        preferredLanguage: lang,
        ...(inc ? { callCount: { increment: 1 }, lastCallAt: new Date() } : {}),
        ...(customer && !existing?.customerId ? { customerId: customer.id } : {}),
      },
    });
    if (customer && preferredLanguage !== undefined && customer.preferredLanguage !== lang) {
      await tx.customer.update({ where: { id: customer.id }, data: { preferredLanguage: lang } });
    }
  });
  return getCaller(phone);
}
