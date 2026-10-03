import { HttpError, handle, json, readJson } from "@/lib/api";
import { requireAgent } from "@/lib/auth";
import { getCaller, normalisePhoneParam, putCaller } from "@/lib/callers";

export const dynamic = "force-dynamic";

/** (agent) Caller profile for the phone agent; unknown numbers get a 200 default. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/callers/[phone]">) => {
  requireAgent(req);
  const { phone } = await ctx.params;
  return json(await getCaller(normalisePhoneParam(phone)));
});

/** (agent) Upsert {preferredLanguage?, name?, incrementCallCount?}. */
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/callers/[phone]">) => {
  requireAgent(req);
  const { phone } = await ctx.params;
  const e164 = normalisePhoneParam(phone);
  const body = await readJson(req);
  if (!body) throw new HttpError(400, "INVALID_BODY");
  return json(await putCaller(e164, body));
});
