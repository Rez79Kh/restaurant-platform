import type { OrderLine } from "@/generated/prisma/client";
import type { Role } from "@/lib/auth/session";
import { calculateBill } from "@/lib/bill";
import type { TenantTx } from "@/lib/tenant";

// Response shapes. Prices and totals are included only for roles allowed to
// see them: the kitchen never receives a price, from any endpoint.

export const canSeePrices = (role: Role) => role !== "KITCHEN";

export function lineView(line: OrderLine, role: Role) {
  return {
    id: line.id,
    orderId: line.orderId,
    menuItemId: line.menuItemId,
    name: line.nameSnapshot,
    quantity: line.quantity,
    note: line.note,
    status: line.status,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
    ...(canSeePrices(role) ? { unitPriceToman: line.unitPriceSnapshotToman } : {}),
  };
}

/** The database clock: cursors for /api/changes must match trigger timestamps. */
export async function dbNow(tx: TenantTx): Promise<Date> {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  return row!.now;
}

/** One order with its lines and current bill, for staff and managers. */
export async function loadOrder(tx: TenantTx, restaurantId: string, branchId: string, orderId: string, role: Role) {
  const order = await tx.order.findFirst({
    where: { restaurantId, branchId, id: orderId },
    include: {
      table: { select: { label: true } },
      lines: { orderBy: { createdAt: "asc" } },
      restaurant: { select: { vatRateBp: true, serviceChargeBp: true } },
    },
  });
  if (!order) return null;

  const bill = calculateBill({
    lines: order.lines.map((l) => ({
      unitPriceToman: l.unitPriceSnapshotToman,
      quantity: l.quantity,
      status: l.status,
    })),
    discount:
      order.discountType && order.discountValue !== null
        ? { type: order.discountType, value: order.discountValue }
        : null,
    serviceChargeBp: order.restaurant.serviceChargeBp,
    vatRateBp: order.restaurant.vatRateBp,
  });

  return {
    order: {
      id: order.id,
      tableId: order.tableId,
      tableLabel: order.table?.label ?? null,
      status: order.status,
      version: order.version,
      discountType: order.discountType,
      discountValue: order.discountValue,
      discountReason: order.discountReason,
      openedAt: order.openedAt,
      updatedAt: order.updatedAt,
    },
    lines: order.lines.map((l) => lineView(l, role)),
    // A settled order shows its snapshot, never a recomputation.
    bill:
      order.status === "SETTLED" && order.totalToman !== null
        ? {
            subtotalToman: order.subtotalToman!,
            discountToman: order.discountToman!,
            serviceChargeToman: order.serviceChargeToman!,
            vatToman: order.vatToman!,
            totalToman: order.totalToman,
          }
        : bill,
  };
}
