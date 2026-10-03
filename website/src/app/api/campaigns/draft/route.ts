import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { draftPromo } from "@/lib/sms/draft";

export const dynamic = "force-dynamic";

/** (admin) body {brief}: returns {name, bodies} written by Claude. 404 when ANTHROPIC_API_KEY is not set. */
export const POST = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  const body = await readJson(req);
  if (!body || typeof body.brief !== "string") throw new HttpError(400, "INVALID_BRIEF");
  return json(await draftPromo(body.brief));
});
