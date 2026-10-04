import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { approveAll } from "@/lib/cards";

export const dynamic = "force-dynamic";

/**
 * (admin) Approve every pending card in the batch whose text passes the checks.
 * Body {limit?}: without it, 409 MONTHLY_CAP {cap, used, left, ready} when they do
 * not all fit this month; with it, approves up to that many.
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/cards/batches/[id]/approve-all">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { limit?: unknown } | null;
  const limit = body?.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 0)) throw new HttpError(400, "INVALID_LIMIT");
  return json(await approveAll(id, { limit: limit as number | undefined }));
});
