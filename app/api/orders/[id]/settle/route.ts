import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { formatToman } from "@/lib/format";
import { AppError } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseBody, parseId } from "@/lib/http/validate";
import { idempotencyKey, idempotent, idempotentResponse } from "@/lib/idempotency";
import { lockOrderForUpdate } from "@/lib/orders/locking";
import { dbNow, loadOrder } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

const Body = z.object({
  version: z.number().int().positive(),
  // One entry per payment: a split bill is several entries, any mix of methods.
  payments: z
    .array(
      z.object({
        method: z.enum(["CARD_READER", "CASH", "CARD_TRANSFER"]),
        amountToman: z.number().int().positive().max(10_000_000_000),
      }),
    )
    .max(20),
});

// Settle in ONE transaction:
//   1. lock the order (FOR UPDATE) and check it is OPEN at the version the
//      client saw
//   2. recompute the bill from the lines, after the lock, so nothing added
//      or voided concurrently is missed (adds/voids hold FOR SHARE)
//   3. payments must equal the total exactly, to the Toman
//   4. write payments, the totals snapshot and SETTLED; the table is free
export const POST = route<{ id: string }>(async ({ req, params, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER", "STAFF");
  const orderId = parseId(params.id);
  const key = idempotencyKey(req);
  const { version, payments } = await parseBody(req, Body);

  const result = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    idempotent(tx, restaurantId, key, `POST /api/orders/${orderId}/settle`, async () => {
      await lockOrderForUpdate(tx, restaurantId, auth.branchId, orderId, version);
      const view = (await loadOrder(tx, restaurantId, auth.branchId, orderId, auth.role))!;
      const { bill } = view;
      const paid = payments.reduce((sum, p) => sum + p.amountToman, 0);

      if (paid !== bill.totalToman) {
        log.warn({ order_id: orderId, total: bill.totalToman, paid }, "settle rejected: payments do not match total");
        throw new AppError(
          422,
          "PAYMENT_MISMATCH",
          `مجموع پرداخت‌ها (${formatToman(paid)}) با مبلغ قابل پرداخت (${formatToman(bill.totalToman)}) برابر نیست.`,
          { totalToman: bill.totalToman, paidToman: paid, version: view.order.version },
        );
      }

      const now = await dbNow(tx);
      await tx.payment.createMany({
        data: payments.map((p) => ({
          id: randomUUID(),
          restaurantId,
          orderId,
          method: p.method,
          amountToman: p.amountToman,
          recordedById: auth.staffId,
        })),
      });
      const order = await tx.order.update({
        where: { id: orderId },
        data: {
          status: "SETTLED",
          ...bill,
          version: { increment: 1 },
          settledById: auth.staffId,
          settledAt: now,
        },
        select: { id: true, status: true, version: true, settledAt: true },
      });
      await tx.auditEvent.create({
        data: {
          restaurantId,
          actorId: auth.staffId,
          action: "order.settle",
          entity: "order",
          entityId: orderId,
          data: { ...bill, payments, version: order.version },
        },
      });
      log.info({ order_id: orderId, total: bill.totalToman, payment_count: payments.length }, "order settled");
      return { status: 200, body: { order, bill, payments } };
    }),
  );
  return idempotentResponse(result);
});
