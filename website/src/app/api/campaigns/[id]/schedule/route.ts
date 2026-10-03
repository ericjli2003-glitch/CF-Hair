import { handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { processQueue, scheduleCampaign, serializeCampaign } from "@/lib/sms/campaigns";

export const dynamic = "force-dynamic";

/**
 * (admin) body {at?: ISO date-time}. Omit `at` (or null) to send now. Times in quiet
 * hours (before 09:00 or from 20:00 America/Vancouver) move to the next allowed time.
 * When the time has come, the first batch is sent straight away.
 */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/campaigns/[id]/schedule">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const body = (await readJson(req)) ?? {};
  const { campaign, adjustedForQuietHours } = await scheduleCampaign(id, body.at ?? null);
  const run = campaign.scheduledAt && campaign.scheduledAt <= new Date() ? await processQueue() : null;
  return json({ campaign: serializeCampaign(campaign), adjustedForQuietHours, run });
});
