import { prisma } from "@/lib/db";
import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { ATTRIBUTION_DAYS, campaignStats, recipientOutcomes, serializeCampaign } from "@/lib/sms/campaigns";

export const dynamic = "force-dynamic";

/** (admin) Totals plus one row per recipient (status, skip reason, opt-out, bookings within 14 days). */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/campaigns/[id]/results">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "CAMPAIGN_NOT_FOUND");
  const [stats, recipients] = await Promise.all([campaignStats([id]), recipientOutcomes(id)]);
  return json({ campaign: serializeCampaign(c), attributionDays: ATTRIBUTION_DAYS, stats: stats.get(id), recipients });
});
