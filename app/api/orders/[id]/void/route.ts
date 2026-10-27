import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { conflict } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseBody, parseId } from "@/lib/http/validate";
import { idempotencyKey, idempotent, idempotentResponse } from "@/lib/idempotency";
import { lockOrderForUpdate } from "@/lib/orders/locking";
import { withTenant } from "@/lib/tenant";

const Body = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(2).max(200),
});

// Cancel an order that holds nothing billable (opened on the wrong table, or
// every item already voided). Items must be voided first, each with its own
// reason and audit entry, so cancelling an order can't hide what was served.
export const POST = route<{ id: string }>(async ({ req, params, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER", "STAFF");
  const orderId = parseId(params.id);
  const key = idempotencyKey(req);
  const { version, reason } = await parseBody(req, Body);

  const result = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    idempotent(tx, restaurantId, key, `POST /api/orders/${orderId}/void`, async () => {
      await lockOrderForUpdate(tx, restaurantId, auth.branchId, orderId, version);
      const active = await tx.orderLine.count({ where: { restaurantId, orderId, status: { not: "VOID" } } });
      if (active > 0) {
        throw conflict("ابتدا آیتم‌های این سفارش را لغو کنید.", { reason: "ORDER_NOT_EMPTY", activeLines: active });
      }
      const order = await tx.order.update({
        where: { id: orderId },
        data: { status: "VOID", version: { increment: 1 } },
        select: { id: true, status: true, version: true },
      });
      await tx.auditEvent.create({
        data: { restaurantId, actorId: auth.staffId, action: "order.void", entity: "order", entityId: orderId, data: { reason, version: order.version } },
      });
      log.info({ order_id: orderId }, "order voided");
      return { status: 200, body: { order } };
    }),
  );
  return idempotentResponse(result);
});
