import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { forbidden, unauthorized } from "@/lib/http/errors";
import type { Logger } from "@/lib/logger";

export const SESSION_COOKIE = "rp_session";
// One shift plus margin. Fixed, not sliding: a lost phone stops working by
// the next day without anyone having to remember to log it out.
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type Role = "MANAGER" | "STAFF" | "KITCHEN";
export const ALL_ROLES: readonly Role[] = ["MANAGER", "STAFF", "KITCHEN"];

/** Who is calling. restaurantId comes from here and nowhere else. */
export type AuthContext = {
  sessionId: string;
  restaurantId: string;
  branchId: string;
  staffId: string;
  role: Role;
  name: string;
};

/** The cookie holds the random token; the database holds only its SHA-256. */
export function newSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

// Secure whenever served over HTTPS (always on Vercel). Plain-HTTP localhost
// (docker compose) gets no Secure flag, or Safari would drop the cookie.
function cookieAttributes(req: Request, maxAge: number) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export const sessionCookie = (req: Request, token: string) =>
  `${SESSION_COOKIE}=${token}; ${cookieAttributes(req, SESSION_TTL_SECONDS)}`;

export const clearedSessionCookie = (req: Request) =>
  `${SESSION_COOKIE}=; ${cookieAttributes(req, 0)}`;

/**
 * Resolves a session token via auth_find_session(), one of the two SECURITY
 * DEFINER lookups that work without a tenant context. Expired sessions and
 * deactivated staff resolve to null.
 */
export async function getSession(token: string | undefined): Promise<AuthContext | null> {
  if (!token || token.length > 64) return null;
  const rows = await db().$queryRaw<
    {
      session_id: string;
      restaurant_id: string;
      branch_id: string;
      staff_id: string;
      role: Role;
      name: string;
    }[]
  >`SELECT * FROM auth_find_session(${hashToken(token)})`;
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    restaurantId: row.restaurant_id,
    branchId: row.branch_id,
    staffId: row.staff_id,
    role: row.role,
    name: row.name,
  };
}

/**
 * The single authorization check for route handlers. No session → 401;
 * wrong role → 403. Both are logged at warn by the route wrapper. UI hiding
 * is cosmetic; this is the control.
 */
export async function requireRole(
  { req, log }: { req: Request; log: Logger },
  ...roles: Role[]
): Promise<AuthContext> {
  const auth = await getSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  if (!auth) throw unauthorized();
  log.setBindings({ restaurant_id: auth.restaurantId, staff_id: auth.staffId, role: auth.role });
  if (!roles.includes(auth.role)) throw forbidden();
  return auth;
}
