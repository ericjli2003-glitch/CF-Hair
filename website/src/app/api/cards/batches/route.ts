import { HttpError, handle, json } from "@/lib/api";
import { requireAdminOrAgent, requireAgent } from "@/lib/auth";
import { createBatch, listBatches, monthSummary } from "@/lib/cards";

export const dynamic = "force-dynamic";

/** (agent) Upload a batch of generated cards for the owner to review. */
export const POST = handle(async (req: Request) => {
  requireAgent(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "INVALID_BODY");
  }
  return json(await createBatch(body), 201);
});

/** (admin) Batches, newest first, with counts by status, plus this month's usage against the cap. */
export const GET = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  const [batches, month] = await Promise.all([listBatches(), monthSummary()]);
  return json({ batches, month });
});
