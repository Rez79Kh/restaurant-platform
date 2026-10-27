import { requireRole } from "@/lib/auth/session";
import { route } from "@/lib/http/handler";
import { dbNow } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

// Cancellations must reach the kitchen: a line voided in the last 15 minutes
// stays on its ticket, struck through, so nobody keeps cooking it.
const RECENT_VOID_MS = 15 * 60_000;

// Kitchen tickets: one per open order with work in progress, oldest first.
// No prices or totals, by construction: they are never selected.
export const GET = route(async ({ req, log }) => {
  const auth = await requireRole({ req, log }, "KITCHEN", "MANAGER");
  const body = await withTenant(auth.restaurantId, async (tx, restaurantId) => {
    const now = await dbNow(tx);
    const orders = await tx.order.findMany({
      where: {
        restaurantId,
        branchId: auth.branchId,
        status: "OPEN",
        lines: { some: { status: { in: ["SENT", "PREPARING", "READY"] } } },
      },
      select: {
        id: true,
        openedAt: true,
        table: { select: { label: true } },
        lines: {
          where: {
            OR: [
              { status: { in: ["SENT", "PREPARING", "READY"] } },
              { status: "VOID", updatedAt: { gt: new Date(now.getTime() - RECENT_VOID_MS) } },
            ],
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, nameSnapshot: true, quantity: true, note: true, status: true, createdAt: true, updatedAt: true },
        },
      },
    });
    const tickets = orders
      .map((o) => {
        const waiting = o.lines.filter((l) => l.status === "SENT" || l.status === "PREPARING");
        return {
          orderId: o.id,
          tableLabel: o.table?.label ?? null,
          // Age = how long the oldest unfinished item has been waiting.
          waitingSince: (waiting[0] ?? o.lines[0])?.createdAt ?? o.openedAt,
          lines: o.lines.map(({ nameSnapshot, ...line }) => ({ ...line, name: nameSnapshot })),
        };
      })
      .sort((x, y) => x.waitingSince.getTime() - y.waitingSince.getTime());
    return { now, tickets };
  });
  return Response.json(body);
});
