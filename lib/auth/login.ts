import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError, tooManyRequests } from "@/lib/http/errors";
import { maskPhone, type Logger } from "@/lib/logger";
import { hashPin, verifyPin } from "@/lib/pin";
import { withTenant } from "@/lib/tenant";
import { newSessionToken, SESSION_TTL_SECONDS, type Role } from "./session";

// Rate limiting lives in Postgres (login_attempts): Vercel functions are
// stateless, so an in-memory counter would reset per instance.
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_ACCOUNT = 5; // per restaurant + phone, since its last success
const MAX_FAILURES_PER_IP = 20; // across all restaurants
// Known gap: concurrent attempts can each read the count before any of them
// is recorded, so a burst may slightly exceed the limit. The limit stays bounded.

const INVALID_CREDENTIALS = () =>
  new AppError(401, "INVALID_CREDENTIALS", "شماره تلفن یا رمز ورود اشتباه است.");

let dummyHash: Promise<string> | undefined;

export type LoginInput = { slug: string; phone: string; pin: string; ip: string };
export type LoginResult = {
  token: string;
  staff: { id: string; name: string; role: Role };
  restaurant: { name: string };
};

export async function login(input: LoginInput, log: Logger): Promise<LoginResult> {
  const { PIN_PEPPER } = getEnv();
  const { slug, phone, pin, ip } = input;
  // Phones are stored only as a keyed hash here (no tenant, no RLS on this table).
  const phoneHash = createHmac("sha256", PIN_PEPPER).update(`login:${slug}:${phone}`).digest("hex");
  // "phone" is a redacted log key; the masked form goes under its own name.
  const logFields = { slug, phone_masked: maskPhone(phone), ip };

  const [counts] = await db().$queryRaw<{ account: number; ip: number }[]>`
    SELECT
      count(*) FILTER (
        WHERE restaurant_slug = ${slug} AND phone_hash = ${phoneHash}
          AND created_at > coalesce((
            SELECT max(created_at) FROM login_attempts
            WHERE restaurant_slug = ${slug} AND phone_hash = ${phoneHash} AND succeeded
          ), '-infinity')
      )::int AS account,
      count(*) FILTER (WHERE ip = ${ip})::int AS ip
    FROM login_attempts
    WHERE NOT succeeded
      AND created_at > now() - make_interval(mins => ${WINDOW_MINUTES})`;
  if (counts && (counts.account >= MAX_FAILURES_PER_ACCOUNT || counts.ip >= MAX_FAILURES_PER_IP)) {
    const reason = counts.account >= MAX_FAILURES_PER_ACCOUNT ? "account_locked" : "ip_limited";
    log.warn({ ...logFields, reason }, "login rate limited");
    throw tooManyRequests("تعداد تلاش‌های ناموفق زیاد است. ۱۵ دقیقه دیگر دوباره امتحان کنید.");
  }

  const [staff] = await db().$queryRaw<
    { restaurant_id: string; staff_id: string; pin_hash: string; role: Role; is_active: boolean }[]
  >`SELECT * FROM auth_find_staff(${slug}, ${phone})`;

  // Always run one scrypt, even for an unknown slug or phone, so response
  // time doesn't reveal which staff accounts exist.
  dummyHash ??= hashPin("0000", PIN_PEPPER);
  const pinMatches = await verifyPin(pin, staff?.pin_hash ?? (await dummyHash), PIN_PEPPER);
  const ok = Boolean(staff?.is_active) && pinMatches;

  await db().loginAttempt.create({
    data: { ip, restaurantSlug: slug, phoneHash, succeeded: ok },
  });

  if (!staff || !ok) {
    const reason = !staff ? "unknown_account" : !staff.is_active ? "inactive" : "wrong_pin";
    log.warn({ ...logFields, reason }, "login failed");
    if (staff) {
      await withTenant(staff.restaurant_id, (tx, restaurantId) =>
        tx.auditEvent.create({
          data: {
            restaurantId,
            actorId: null,
            action: "auth.login_failed",
            entity: "staff_member",
            entityId: staff.staff_id,
            data: { reason, ip, phone: maskPhone(phone) },
          },
        }),
      );
    }
    // Same response for every failure: no hint whether the slug or phone exists.
    throw INVALID_CREDENTIALS();
  }

  const { token, tokenHash } = newSessionToken();
  const result = await withTenant(staff.restaurant_id, async (tx, restaurantId) => {
    await tx.session.create({
      data: {
        restaurantId,
        staffMemberId: staff.staff_id,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      },
    });
    const member = await tx.staffMember.findFirstOrThrow({
      where: { restaurantId, id: staff.staff_id },
      select: { id: true, name: true, role: true },
    });
    const restaurant = await tx.restaurant.findFirstOrThrow({
      where: { id: restaurantId },
      select: { name: true },
    });
    return { token, staff: member, restaurant };
  });

  log.setBindings({ restaurant_id: staff.restaurant_id, staff_id: staff.staff_id, role: staff.role });
  log.info("login succeeded");
  return result;
}

/** Client IP for rate limiting. On Vercel, x-forwarded-for is set by the platform. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}
