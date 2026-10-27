import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { conflict, forbidden, notFound } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseBody, parseId } from "@/lib/http/validate";
import { idempotencyKey, idempotent, idempotentResponse } from "@/lib/idempotency";
import { lineView } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

const Body = z.object({
  from: z.enum(["SENT", "PREPARING", "READY", "SERVED"]),
  reason: z.string().trim().min(2).max(200),
});

// Staff may void a line the kitchen hasn't started (SENT). Once the kitchen
// has started it, only a manager may. Every void is audit-logged with its
// reason. Conditional like any status change (WHERE status = $from), and it
// holds the order FOR SHARE so it can't interleave with a settle.
export const POST = route<{ id: string }>(async ({ req, params, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER", "STAFF");
  const lineId = parseId(params.id);
  const key = idempotencyKey(req);
  const { from, reason } = await parseBody(req, Body);
  if (auth.role === "STAFF" && from !== "SENT") {
    throw forbidden("لغو آیتمی که آشپزخانه شروع کرده فقط با مدیر است.");
  }

  const result = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    idempotent(tx, restaurantId, key, `POST /api/order-lines/${lineId}/void`, async () => {
      const [order] = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT o.id, o.status FROM orders o
        JOIN order_lines l ON l.restaurant_id = o.restaurant_id AND l.order_id = o.id
        WHERE l.restaurant_id = ${restaurantId}::uuid AND l.id = ${lineId}::uuid
          AND o.branch_id = ${auth.branchId}::uuid
        FOR SHARE OF o`;
      if (!order) throw notFound("آیتم پیدا نشد.");

      const updated =
        order.status === "OPEN"
          ? await tx.orderLine.updateMany({
              where: { restaurantId, id: lineId, status: from },
              data: { status: "VOID", voidedById: auth.staffId, voidReason: reason },
            })
          : { count: 0 };
      const line = (await tx.orderLine.findFirst({ where: { restaurantId, id: lineId } }))!;
      if (updated.count === 0) {
        log.warn({ line_id: lineId, expected: from, actual: line.status, order_status: order.status }, "line void conflict");
        throw conflict(
          order.status !== "OPEN" ? "این سفارش بسته شده است." : "وضعیت این آیتم همزمان تغییر کرده است.",
          { line: lineView(line, auth.role), orderStatus: order.status },
        );
      }
      await tx.auditEvent.create({
        data: {
          restaurantId,
          actorId: auth.staffId,
          action: "order_line.void",
          entity: "order_line",
          entityId: lineId,
          data: {
            orderId: order.id,
            reason,
            previousStatus: from,
            item: line.nameSnapshot,
            quantity: line.quantity,
            unitPriceToman: line.unitPriceSnapshotToman,
          },
        },
      });
      log.info({ line_id: lineId, previous_status: from }, "line voided");
      return { status: 200, body: { line: lineView(line, auth.role) } };
    }),
  );
  return idempotentResponse(result);
});
