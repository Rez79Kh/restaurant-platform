import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { AppError, conflict, notFound } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseBody, parseId } from "@/lib/http/validate";
import { idempotencyKey, idempotent, idempotentResponse } from "@/lib/idempotency";
import { lineView } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

const AddLines = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.uuid(),
        quantity: z.number().int().min(1).max(20),
        note: z.string().trim().max(120).optional(),
      }),
    )
    .min(1)
    .max(30),
});

// Adding items is an INSERT of new order_line rows and nothing else: the
// order row is never read-modified-written, so concurrent adds from several
// phones cannot overwrite each other. Name and price are snapshotted from the
// menu now; later menu changes never touch this bill.
export const POST = route<{ id: string }>(async ({ req, params, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER", "STAFF");
  const orderId = parseId(params.id);
  const key = idempotencyKey(req);
  const { items } = await parseBody(req, AddLines);

  const result = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    idempotent(tx, restaurantId, key, `POST /api/orders/${orderId}/lines`, async () => {
      // FOR SHARE: concurrent adds don't block each other, but settle (which
      // takes FOR UPDATE) cannot interleave with an add.
      const [order] = await tx.$queryRaw<{ status: string; branch_id: string }[]>`
        SELECT status, branch_id FROM orders
        WHERE restaurant_id = ${restaurantId}::uuid AND id = ${orderId}::uuid
        FOR SHARE`;
      if (!order || order.branch_id !== auth.branchId) throw notFound("سفارش پیدا نشد.");
      if (order.status !== "OPEN") {
        throw conflict("این سفارش بسته شده و نمی‌توان به آن آیتم اضافه کرد.", { orderStatus: order.status });
      }

      const ids = [...new Set(items.map((i) => i.menuItemId))];
      const menu = await tx.menuItem.findMany({ where: { restaurantId, id: { in: ids } } });
      const byId = new Map(menu.map((m) => [m.id, m]));
      const unavailable = ids.filter((id) => !byId.get(id)?.isAvailable);
      if (unavailable.length > 0) {
        throw new AppError(409, "MENU_ITEM_UNAVAILABLE", "برخی آیتم‌ها دیگر موجود نیستند.", {
          menuItemIds: unavailable,
        });
      }

      const rows = items.map((item) => {
        const menuItem = byId.get(item.menuItemId)!;
        return {
          id: randomUUID(),
          restaurantId,
          orderId,
          menuItemId: menuItem.id,
          nameSnapshot: menuItem.name,
          unitPriceSnapshotToman: menuItem.priceToman,
          quantity: item.quantity,
          note: item.note || null,
          createdById: auth.staffId,
        };
      });
      await tx.orderLine.createMany({ data: rows });
      const lines = await tx.orderLine.findMany({
        where: { restaurantId, id: { in: rows.map((r) => r.id) } },
        orderBy: { createdAt: "asc" },
      });
      log.info({ order_id: orderId, line_count: lines.length }, "lines added");
      return { status: 201, body: { lines: lines.map((l) => lineView(l, auth.role)) } };
    }),
  );
  return idempotentResponse(result);
});
