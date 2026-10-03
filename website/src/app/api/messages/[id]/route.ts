import { prisma } from "@/lib/db";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/messages/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!body || (body.status !== "new" && body.status !== "done")) throw new HttpError(400, "INVALID_STATUS");
  const exists = await prisma.message.findUnique({ where: { id } });
  if (!exists) throw new HttpError(404, "MESSAGE_NOT_FOUND");
  return json({ message: await prisma.message.update({ where: { id }, data: { status: body.status } }) });
});
