import { POST as loginRoute } from "@/app/api/auth/login/route";
import type { TenantFixture } from "./fixtures";

// Calls route handlers in-process with real Request objects: the same code
// path as production minus the network.

type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;

let ipCounter = 0;
/** A distinct client IP per caller, so per-IP rate limits don't leak between tests. */
export const freshIp = () => `10.${(++ipCounter >> 8) & 255}.${ipCounter & 255}.1`;

export async function call(
  handler: Handler,
  {
    method = "GET",
    path = "/",
    body,
    cookie,
    ip = freshIp(),
    params = {},
  }: {
    method?: string;
    path?: string;
    body?: unknown;
    cookie?: string;
    ip?: string;
    params?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) as Promise<never> },
  );
  const text = await res.text();
  return { res, status: res.status, body: text ? JSON.parse(text) : null };
}

export const sessionCookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

/** Logs in as the fixture's staff member with the given role; returns the cookie header value. */
export async function loginAs(tenant: TenantFixture, role: "MANAGER" | "STAFF" | "KITCHEN") {
  const person = tenant.people[role];
  const { res, status } = await call(loginRoute as Handler, {
    method: "POST",
    path: "/api/auth/login",
    body: { slug: tenant.slug, phone: person.phone, pin: person.pin },
  });
  if (status !== 200) throw new Error(`login as ${role} failed: ${status}`);
  return sessionCookieOf(res);
}

export type { Handler };
