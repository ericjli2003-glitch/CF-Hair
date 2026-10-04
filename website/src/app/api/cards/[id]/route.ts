import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { patchCard } from "@/lib/cards";

export const dynamic = "force-dynamic";

/**
 * (admin) {status?: "pending"|"approved"|"skipped", message?, messageAlt?}.
 * 400 INVALID_TEXT {issues} when edited text breaks maxChars or the punctuation rules;
 * 409 MONTHLY_CAP when approving past this month's cap; 409 CARD_SENT once mailed.
 */
export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/cards/[id]">) => {
  await requireAdminOrAgent(req);
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "INVALID_BODY");
  }
  return json({ card: await patchCard(id, body) });
});
