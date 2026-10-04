import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { getCall } from "@/lib/calls";

export const dynamic = "force-dynamic";

/** (admin) One call with its transcript (null once cleared after CALL_TRANSCRIPT_DAYS). */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/calls/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const call = await getCall(id);
  if (!call) throw new HttpError(404, "CALL_NOT_FOUND");
  return json({ call });
});
