import { conflict, notFound } from "@/lib/http/errors";
import type { TenantTx } from "@/lib/tenant";

type LockedOrder = { id: string; status: string; version: number; branch_id: string };

/**
 * Order-level changes (discount, settle, void order) lock the order row
 * FOR UPDATE and check the version the client saw. Adds and line voids take
 * FOR SHARE, so they never run in the middle of a settle: the settled
 * snapshot always matches the lines.
 */
export async function lockOrderForUpdate(
  tx: TenantTx,
  restaurantId: string,
  branchId: string,
  orderId: string,
  expectedVersion: number,
): Promise<LockedOrder> {
  const [order] = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, status, version, branch_id FROM orders
    WHERE restaurant_id = ${restaurantId}::uuid AND id = ${orderId}::uuid
    FOR UPDATE`;
  if (!order || order.branch_id !== branchId) throw notFound("سفارش پیدا نشد.");
  if (order.status !== "OPEN") {
    throw conflict("این سفارش بسته شده است.", { status: order.status, version: order.version });
  }
  if (order.version !== expectedVersion) {
    throw conflict("این سفارش همزمان تغییر کرده است. صفحه به‌روز شد؛ دوباره بررسی کنید.", {
      status: order.status,
      version: order.version,
    });
  }
  return order;
}
