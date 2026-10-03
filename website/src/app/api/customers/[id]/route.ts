import { prisma } from "@/lib/db";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { isLanguageCode, LANGUAGE_CODES } from "@/lib/languages";
import { isDateKey } from "@/lib/time";

/** (admin) Update owner-editable customer fields. Language changes sync to the caller profile. */
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/customers/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw new HttpError(404, "CUSTOMER_NOT_FOUND");

  const data: Record<string, unknown> = {};
  if (body.preferredLanguage !== undefined) {
    if (!isLanguageCode(body.preferredLanguage)) {
      throw new HttpError(400, "INVALID_LANGUAGE", `preferredLanguage must be one of ${LANGUAGE_CODES.join(", ")}`);
    }
    data.preferredLanguage = body.preferredLanguage;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === "string")) throw new HttpError(400, "INVALID_TAGS");
    data.tags = JSON.stringify(body.tags);
  }
  if (body.birthday !== undefined) {
    if (body.birthday !== null && !isDateKey(body.birthday)) throw new HttpError(400, "INVALID_BIRTHDAY");
    data.birthday = body.birthday;
  }
  if (body.referredBy !== undefined) {
    if (body.referredBy !== null && typeof body.referredBy !== "string") throw new HttpError(400, "INVALID_REFERRED_BY");
    const v = typeof body.referredBy === "string" ? body.referredBy.trim().slice(0, 200) : "";
    data.referredBy = v || null;
  }
  if (body.notes !== undefined) data.notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id }, data });
    if (data.preferredLanguage) {
      await tx.callerProfile.updateMany({
        where: { OR: [{ customerId: id }, { phone: customer.phone }] },
        data: { preferredLanguage: data.preferredLanguage as string, customerId: id },
      });
    }
  });
  const updated = await prisma.customer.findUniqueOrThrow({ where: { id } });
  return json({ customer: { ...updated, tags: JSON.parse(updated.tags) } });
});
