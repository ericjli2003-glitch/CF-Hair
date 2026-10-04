import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { getCardSettings, monthSummary, saveCardSettings } from "@/lib/cards";

export const dynamic = "force-dynamic";

/** (admin) {monthlyCap, pricePerCardCAD} plus this month's usage. */
export const GET = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  return json({ ...(await getCardSettings()), month: await monthSummary() });
});

/** (admin) body {monthlyCap?, pricePerCardCAD?} */
export const PUT = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "INVALID_BODY");
  }
  return json(await saveCardSettings(body));
});
