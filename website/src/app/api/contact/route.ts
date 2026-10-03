import { prisma } from "@/lib/db";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { toE164 } from "@/lib/phone";

/** Public contact form. Lands in the owner's Messages inbox. */
export const POST = handle(async (req: Request) => {
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  if (typeof body.website === "string" && body.website) return json({ ok: true }, 201); // honeypot
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  const phone = toE164(body.phone);
  if (!name) throw new HttpError(400, "INVALID_NAME");
  if (!phone) throw new HttpError(400, "INVALID_PHONE");
  if (!message) throw new HttpError(400, "INVALID_MESSAGE");
  await prisma.message.create({ data: { callerName: name, phone, message, urgency: "normal", source: "web" } });
  return json({ ok: true }, 201);
});
