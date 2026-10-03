import { handle, json, readJson } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { sendTest } from "@/lib/sms/campaigns";

export const dynamic = "force-dynamic";

/** (admin) body {phone?, language?}: sends the final text (with footer) to the owner's phone. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/campaigns/[id]/test">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  const body = (await readJson(req)) ?? {};
  const message = await sendTest(id, { phone: body.phone, language: body.language });
  return json({ message });
});
