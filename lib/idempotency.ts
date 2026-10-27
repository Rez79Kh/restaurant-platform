import type { Prisma } from "@/generated/prisma/client";
import { AppError, badRequest } from "@/lib/http/errors";
import type { TenantTx } from "@/lib/tenant";

// Every mutating request carries a client-generated Idempotency-Key header.
//
// The key is inserted in the SAME transaction as the mutation:
//  - first request: insert succeeds → run the mutation → store the response
//  - retry after success: ON CONFLICT → return the stored response
//  - concurrent duplicate: its insert waits on the unique index until the
//    first commits, then returns the stored response (exactly one execution)
//  - mutation failed: the whole transaction rolls back, key included, so a
//    retry runs again (error responses are never replayed)
// Known gap: records are never cleaned up; a TTL job would delete old rows.

const KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

export function idempotencyKey(req: Request): string {
  const key = req.headers.get("idempotency-key");
  if (!key || !KEY_PATTERN.test(key)) {
    throw badRequest(
      "شناسهٔ درخواست (Idempotency-Key) ارسال نشده یا نامعتبر است.",
      undefined,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }
  return key;
}

export type StoredResponse = { status: number; body: unknown };

export async function idempotent(
  tx: TenantTx,
  restaurantId: string,
  key: string,
  route: string,
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO idempotency_records (id, restaurant_id, key, route)
    VALUES (gen_random_uuid(), ${restaurantId}::uuid, ${key}, ${route})
    ON CONFLICT (restaurant_id, key) DO NOTHING
    RETURNING id`;

  if (inserted.length === 0) {
    const prior = await tx.idempotencyRecord.findFirst({ where: { restaurantId, key } });
    if (!prior || prior.route !== route || prior.responseStatus === null) {
      throw new AppError(
        422,
        "IDEMPOTENCY_KEY_REUSED",
        "این شناسهٔ درخواست قبلاً برای کار دیگری استفاده شده است.",
      );
    }
    return { status: prior.responseStatus, body: prior.responseBody, replayed: true };
  }

  const result = await run();
  // Normalise through JSON so a fresh response and its replay are byte-identical.
  const body = JSON.parse(JSON.stringify(result.body)) as Prisma.InputJsonValue;
  await tx.idempotencyRecord.update({
    where: { id: inserted[0]!.id },
    data: { responseStatus: result.status, responseBody: body },
  });
  return { status: result.status, body, replayed: false };
}

export function idempotentResponse(result: StoredResponse & { replayed: boolean }): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: result.replayed ? { "idempotent-replayed": "true" } : {},
  });
}
