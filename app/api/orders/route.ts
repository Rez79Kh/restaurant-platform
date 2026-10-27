import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth/session";
import { conflict, notFound } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseBody } from "@/lib/http/validate";
import { idempotencyKey, idempotent, idempotentResponse } from "@/lib/idempotency";
import { withTenant } from "@/lib/tenant";

const OpenOrder = z.object({ tableId: z.uuid().nullable() }); // null = takeaway

// Open a table (or a takeaway). Two waiters opening the same table at once:
// the partial unique index orders_one_open_per_table lets exactly one INSERT
// win; the other gets 409 and the UI sends them to the existing order.
export const POST = route(async ({ req, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER", "STAFF");
  const key = idempotencyKey(req);
  const { tableId } = await parseBody(req, OpenOrder);

  const result = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    idempotent(tx, restaurantId, key, "POST /api/orders", async () => {
      if (tableId) {
        const table = await tx.diningTable.findFirst({
          where: { restaurantId, branchId: auth.branchId, id: tableId },
        });
        if (!table) throw notFound("میز پیدا نشد.");
        const existing = await tx.order.findFirst({
          where: { restaurantId, tableId, status: "OPEN" },
          select: { id: true },
        });
        if (existing) throw conflict("این میز همین حالا باز است.", { orderId: existing.id });
      }
      try {
        const order = await tx.order.create({
          data: { restaurantId, branchId: auth.branchId, tableId, openedById: auth.staffId },
          select: { id: true, tableId: true, status: true, version: true, openedAt: true },
        });
        return { status: 201, body: { order } };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw conflict("همکار دیگری همین حالا این میز را باز کرد.", { reason: "TABLE_OCCUPIED" });
        }
        throw err;
      }
    }),
  );
  return idempotentResponse(result);
});
