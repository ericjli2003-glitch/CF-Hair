import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { campaignStats, createCampaign, parseCampaignInput, serializeCampaign, type CampaignInput } from "@/lib/sms/campaigns";

export const dynamic = "force-dynamic";

/** (admin) Campaigns, newest first, with delivery and attribution stats. */
export const GET = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const rows = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" } });
  const stats = await campaignStats(rows.map((r) => r.id));
  return json(rows.map((c) => ({ ...serializeCampaign(c), stats: stats.get(c.id) })));
});

/** (admin) Create a draft: {name, bodies:{"en-US", "zh-CN"?, "zh-HK"?, "ko-KR"?}, audience:{type,...}, includeImplied} */
export const POST = handle(async (req: NextRequest) => {
  await requireAdminOrAgent(req);
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  const input = parseCampaignInput(body) as CampaignInput;
  const c = await createCampaign(input);
  return json({ campaign: serializeCampaign(c) }, 201);
});
