import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { parseCampaignInput, previewCampaign, type CampaignInput } from "@/lib/sms/campaigns";

export const dynamic = "force-dynamic";

/** (admin) Live preview: final text per language, segments, audience counts by consent and skip reason, cost. */
export const POST = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  const input = parseCampaignInput({ ...body, name: typeof body.name === "string" && body.name.trim() ? body.name : "preview" }) as CampaignInput;
  return json(await previewCampaign(input));
});
