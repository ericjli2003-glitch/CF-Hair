import { NextResponse } from "next/server";
import { HttpError, handle, readJson } from "@/lib/api";
import { ADMIN_COOKIE, checkPassword, createSessionToken } from "@/lib/auth";

export const POST = handle(async (req: Request) => {
  if (!process.env.ADMIN_PASSWORD) throw new HttpError(503, "ADMIN_DISABLED", "Set ADMIN_PASSWORD to enable the admin");
  const body = await readJson(req);
  if (!checkPassword(body?.password)) {
    await new Promise((r) => setTimeout(r, 400));
    throw new HttpError(401, "INVALID_PASSWORD");
  }
  const { token, maxAge } = createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.ALLOW_INSECURE_COOKIE,
    path: "/",
    maxAge,
  });
  return res;
});
