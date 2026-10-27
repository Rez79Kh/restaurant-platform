import { clearedSessionCookie, getSession, readCookie, SESSION_COOKIE } from "@/lib/auth/session";
import { route } from "@/lib/http/handler";
import { withTenant } from "@/lib/tenant";

// Always succeeds and clears the cookie; deletes the session if there is one.
export const POST = route(async ({ req, log }) => {
  const auth = await getSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  if (auth) {
    await withTenant(auth.restaurantId, (tx, restaurantId) =>
      tx.session.deleteMany({ where: { restaurantId, id: auth.sessionId } }),
    );
    log.info({ staff_id: auth.staffId }, "logged out");
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie(req) } });
});
