import { requireRole } from "@/lib/auth/session";
import { route } from "@/lib/http/handler";
import { dbNow } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

const ACTIVE_STATUSES = ["SENT", "PREPARING", "READY", "SERVED"] as const;

// Tables grid snapshot: every table with its open order (if any) and line
// counts by status, plus open takeaway orders. `now` is the polling cursor.
export const GET = route(async ({ req, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER", "STAFF");
  const body = await withTenant(auth.restaurantId, async (tx, restaurantId) => {
    const now = await dbNow(tx);
    const tables = await tx.diningTable.findMany({
      where: { restaurantId, branchId: auth.branchId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, label: true, seats: true },
    });
    const open = await tx.order.findMany({
      where: { restaurantId, branchId: auth.branchId, status: "OPEN" },
      orderBy: { openedAt: "asc" },
      select: { id: true, tableId: true, openedAt: true, lines: { select: { status: true } } },
    });
    const summaries = open.map((o) => ({
      id: o.id,
      tableId: o.tableId,
      openedAt: o.openedAt,
      counts: Object.fromEntries(
        ACTIVE_STATUSES.map((s) => [s, o.lines.filter((l) => l.status === s).length]),
      ) as Record<(typeof ACTIVE_STATUSES)[number], number>,
    }));
    return {
      now,
      tables: tables.map((t) => ({ ...t, order: summaries.find((o) => o.tableId === t.id) ?? null })),
      takeaways: summaries.filter((o) => o.tableId === null),
    };
  });
  return Response.json(body);
});
