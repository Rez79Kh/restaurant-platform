import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export type TenantTx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant isolation, layer 3: the only way application code touches tenant data.
 *
 * Opens an interactive transaction and first runs
 *   SELECT set_config('app.restaurant_id', $1, true)
 * The `true` makes the setting transaction-local. On Neon the connection is
 * pooled, and a session-level setting would survive on the connection and be
 * picked up by another tenant's request.
 *
 * `restaurantId` must come from the server-side session only — never from the
 * request body, URL or headers. Queries inside should still filter by
 * restaurantId explicitly (defense in depth on top of RLS).
 */
export async function withTenant<T>(
  restaurantId: string,
  fn: (tx: TenantTx, restaurantId: string) => Promise<T>,
): Promise<T> {
  // Fail closed: never run tenant queries with a missing or malformed context.
  if (!UUID.test(restaurantId)) {
    throw new Error("withTenant: invalid restaurant id");
  }
  return db().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.restaurant_id', ${restaurantId}, true)`;
    return fn(tx, restaurantId);
  });
}
