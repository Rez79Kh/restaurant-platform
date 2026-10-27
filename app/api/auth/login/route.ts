import { z } from "zod";
import { clientIp, login } from "@/lib/auth/login";
import { sessionCookie } from "@/lib/auth/session";
import { normalizePhone, toAsciiDigits } from "@/lib/digits";
import { route } from "@/lib/http/handler";
import { parseBody } from "@/lib/http/validate";

const LoginBody = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  phone: z.string().max(30).transform(normalizePhone).pipe(z.string().regex(/^09\d{9}$/)),
  pin: z.string().max(12).transform(toAsciiDigits).pipe(z.string().regex(/^\d{4,6}$/)),
});

// No idempotency key: a retried login only creates a second session.
export const POST = route(async ({ req, log }) => {
  const body = await parseBody(req, LoginBody);
  const { token, staff, restaurant } = await login({ ...body, ip: clientIp(req) }, log);
  return Response.json(
    { staff, restaurant },
    { headers: { "set-cookie": sessionCookie(req, token) } },
  );
});
