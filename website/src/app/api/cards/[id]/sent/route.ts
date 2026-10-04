import { HttpError, handle, json } from "@/lib/api";
import { requireAgent } from "@/lib/auth";
import { reportSent } from "@/lib/cards";

export const dynamic = "force-dynamic";

/**
 * (agent) {provider, providerOrderId?, sentAt, costCAD?} marks an approved card sent;
 * {failed: true, error} marks it failed. 409 NOT_APPROVED for pending or skipped cards.
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/cards/[id]/sent">) => {
  requireAgent(req);
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "INVALID_BODY");
  }
  const { card } = await reportSent(id, body);
  return json({ card });
});
