import { z } from "zod";
import { ALL_ROLES, requireRole } from "@/lib/auth/session";
import { AppError, conflict, forbidden, notFound } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseBody, parseId } from "@/lib/http/validate";
import { idempotencyKey, idempotent, idempotentResponse } from "@/lib/idempotency";
import { findTransition } from "@/lib/orders/transitions";
import { lineView } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

const Status = z.enum(["SENT", "PREPARING", "READY", "SERVED", "VOID"]);
const Body = z.object({ from: Status, to: Status });

// A conditional update, never read-then-write:
//   UPDATE ... WHERE id = $1 AND status = $from
// Two devices moving the same line at once: the second UPDATE waits for the
// first's row lock, re-checks `status = $from`, matches nothing, and gets 409
// with the line's current state. The client shows that and refreshes; it
// never retries a 409 or overwrites.
export const POST = route<{ id: string }>(async ({ req, params, log }) => {
  const auth = await requireRole({ req, log }, ...ALL_ROLES);
  const lineId = parseId(params.id);
  const key = idempotencyKey(req);
  const { from, to } = await parseBody(req, Body);

  const transition = findTransition(from, to);
  if (!transition) {
    throw new AppError(422, "INVALID_TRANSITION", "این تغییر وضعیت مجاز نیست.");
  }
  if (!transition.roles.includes(auth.role)) throw forbidden();

  const result = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    idempotent(tx, restaurantId, key, `POST /api/order-lines/${lineId}/status`, async () => {
      const updated = await tx.$executeRaw`
        UPDATE order_lines l
        SET status = ${to}::"OrderLineStatus"
        FROM orders o
        WHERE l.restaurant_id = ${restaurantId}::uuid
          AND l.id = ${lineId}::uuid
          AND l.status = ${from}::"OrderLineStatus"
          AND o.restaurant_id = l.restaurant_id
          AND o.id = l.order_id
          AND o.branch_id = ${auth.branchId}::uuid
          AND o.status = 'OPEN'`;

      const line = await tx.orderLine.findFirst({
        where: { restaurantId, id: lineId, order: { branchId: auth.branchId } },
        include: { order: { select: { status: true } } },
      });
      if (!line) throw notFound("آیتم پیدا نشد.");

      if (updated === 0) {
        log.warn(
          { line_id: lineId, expected: from, actual: line.status, order_status: line.order.status },
          "line status conflict",
        );
        throw conflict(
          line.order.status !== "OPEN"
            ? "این سفارش بسته شده است."
            : "وضعیت این آیتم همزمان توسط شخص دیگری تغییر کرده است.",
          { line: lineView(line, auth.role), orderStatus: line.order.status },
        );
      }
      return { status: 200, body: { line: lineView(line, auth.role) } };
    }),
  );
  return idempotentResponse(result);
});
