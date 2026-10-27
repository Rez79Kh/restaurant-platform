import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { AppError } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseBody, parseId } from "@/lib/http/validate";
import { idempotencyKey, idempotent, idempotentResponse } from "@/lib/idempotency";
import { lockOrderForUpdate } from "@/lib/orders/locking";
import { loadOrder } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

const Body = z.object({
  version: z.number().int().positive(),
  // null removes the discount
  discount: z
    .object({
      type: z.enum(["AMOUNT", "PERCENT"]), // AMOUNT in Toman, PERCENT in basis points
      value: z.number().int().positive(),
    })
    .nullable(),
  reason: z.string().trim().min(2).max(200),
});

// Manager only. Versioned (stale version → 409) and audit-logged with the
// before/after values. Stored as type + value; the bill derives the Toman.
export const POST = route<{ id: string }>(async ({ req, params, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER");
  const orderId = parseId(params.id);
  const key = idempotencyKey(req);
  const { version, discount, reason } = await parseBody(req, Body);

  const result = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    idempotent(tx, restaurantId, key, `POST /api/orders/${orderId}/discount`, async () => {
      await lockOrderForUpdate(tx, restaurantId, auth.branchId, orderId, version);
      const before = (await loadOrder(tx, restaurantId, auth.branchId, orderId, auth.role))!;

      if (discount?.type === "PERCENT" && discount.value > 10_000) {
        throw new AppError(422, "DISCOUNT_TOO_LARGE", "تخفیف نمی‌تواند بیش از ۱۰۰٪ باشد.");
      }
      if (discount?.type === "AMOUNT" && discount.value > before.bill.subtotalToman) {
        throw new AppError(422, "DISCOUNT_TOO_LARGE", "مبلغ تخفیف از جمع سفارش بیشتر است.", {
          subtotalToman: before.bill.subtotalToman,
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          discountType: discount?.type ?? null,
          discountValue: discount?.value ?? null,
          discountReason: discount ? reason : null,
          version: { increment: 1 },
        },
      });
      const after = (await loadOrder(tx, restaurantId, auth.branchId, orderId, auth.role))!;
      await tx.auditEvent.create({
        data: {
          restaurantId,
          actorId: auth.staffId,
          action: discount ? "order.discount" : "order.discount_removed",
          entity: "order",
          entityId: orderId,
          data: {
            reason,
            before: { type: before.order.discountType, value: before.order.discountValue, discountToman: before.bill.discountToman },
            after: { type: discount?.type ?? null, value: discount?.value ?? null, discountToman: after.bill.discountToman },
            version: after.order.version,
          },
        },
      });
      log.info({ order_id: orderId, discount, version: after.order.version }, "discount changed");
      return { status: 200, body: after };
    }),
  );
  return idempotentResponse(result);
});
