import { handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { deleteTimeOff } from "@/lib/time-off";

export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/time-off/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  await deleteTimeOff(id);
  return json({ ok: true });
});
