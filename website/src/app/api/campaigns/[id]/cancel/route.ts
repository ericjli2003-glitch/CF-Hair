import { handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { cancelCampaign } from "@/lib/sms/campaigns";

export const dynamic = "force-dynamic";

/** (admin) Cancel a scheduled campaign, or stop one mid-send (queued texts are skipped). */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/campaigns/[id]/cancel">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  await cancelCampaign(id);
  return json({ ok: true });
});
