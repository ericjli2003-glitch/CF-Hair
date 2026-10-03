import { prisma } from "@/lib/db";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { campaignStats, deleteDraft, parseCampaignInput, serializeCampaign, updateCampaign } from "@/lib/sms/campaigns";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/campaigns/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "CAMPAIGN_NOT_FOUND");
  return json({ campaign: { ...serializeCampaign(c), stats: (await campaignStats([id])).get(id) } });
});

/** (admin) Edit a draft or scheduled campaign. */
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/campaigns/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  const c = await updateCampaign(id, parseCampaignInput(body, true));
  return json({ campaign: serializeCampaign(c) });
});

/** (admin) Delete a draft or cancelled campaign. */
export const DELETE = handle(async (req: Request, ctx: RouteContext<"/api/campaigns/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  await deleteDraft(id);
  return json({ ok: true });
});
