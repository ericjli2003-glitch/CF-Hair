import { handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processQueue, scheduleCampaign, serializeCampaign } from "@/lib/sms/campaigns";

export const dynamic = "force-dynamic";

/** (admin) Send now (same as schedule with no time). In quiet hours it is scheduled for 09:00 instead. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/campaigns/[id]/send">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const { campaign, adjustedForQuietHours } = await scheduleCampaign(id, null);
  const run = campaign.scheduledAt && campaign.scheduledAt <= new Date() ? await processQueue() : null;
  const fresh = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  return json({ campaign: serializeCampaign(fresh), adjustedForQuietHours, run });
});
