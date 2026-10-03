import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { HttpError } from "./api";

export const ADMIN_COOKIE = "cf_admin";
const SESSION_DAYS = 14;

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || `cf-admin:${process.env.ADMIN_PASSWORD ?? ""}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(pw: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && typeof pw === "string" && safeEqual(pw, expected);
}

export function createSessionToken(now = Date.now()): { token: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 86400;
  const exp = Math.floor(now / 1000) + maxAge;
  const payload = `admin.${exp}`;
  return { token: `${payload}.${sign(payload)}`, maxAge };
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token || !process.env.ADMIN_PASSWORD) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  return safeEqual(parts[2], sign(`${parts[0]}.${parts[1]}`));
}

/** For server components and route handlers. */
export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(ADMIN_COOKIE)?.value);
}

export function hasAgentKey(req: Request): boolean {
  const expected = process.env.AGENT_API_KEY;
  const got = req.headers.get("x-api-key");
  return !!expected && !!got && safeEqual(got, expected);
}

export function requireAgent(req: Request): void {
  if (!hasAgentKey(req)) throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid x-api-key");
}

/** (admin) endpoints accept either the agent key or an admin session. */
export async function requireAdminOrAgent(req: Request): Promise<"agent" | "admin"> {
  if (hasAgentKey(req)) return "agent";
  if (await isAdminSession()) return "admin";
  throw new HttpError(401, "UNAUTHORIZED");
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) throw new HttpError(401, "UNAUTHORIZED");
}
