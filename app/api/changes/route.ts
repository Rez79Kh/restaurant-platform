import { z } from "zod";
import { ALL_ROLES, requireRole } from "@/lib/auth/session";
import { route } from "@/lib/http/handler";
import { parseWith } from "@/lib/http/validate";
import { dbNow, lineView } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

// Realtime by short polling. Every screen polls this every ~2.5 s with the
// cursor from its last response and refetches its own snapshot when anything
// changed. Cheap: two indexed range scans on (restaurant_id, ..., updated_at).
//
// Where this breaks, deliberately accepted for v1:
//  - Cost scales with devices × polls: 10 devices ≈ 4 req/s per café, fine on
//    serverless + Neon; hundreds of busy restaurants would want SSE/websockets
//    on a long-lived server, or a push service.
//  - Latency is up to one poll interval (the brief asks for "a few seconds").
//  - No offline support: when the network drops, polls fail, the UI says so,
//    and nothing is queued.
//  - A transaction can commit after a later one with an earlier updated_at, so
//    we re-read an OVERLAP window and clients treat results as "something
//    changed", never as a complete diff.
const OVERLAP_MS = 10_000;
// A cursor this old (tab asleep, phone locked) means "reload everything".
const MAX_AGE_MS = 5 * 60_000;
const LIMIT = 300;

const Query = z.object({ since: z.iso.datetime({ offset: true }).optional() });

export const GET = route(async ({ req, log }) => {
  const auth = await requireRole({ req, log }, ...ALL_ROLES);
  const { since } = parseWith(Query, Object.fromEntries(new URL(req.url).searchParams));

  const body = await withTenant(auth.restaurantId, async (tx, restaurantId) => {
    const now = await dbNow(tx);
    const sinceMs = since ? Date.parse(since) : NaN;
    if (!since || now.getTime() - sinceMs > MAX_AGE_MS) {
      return { now, resync: true, orders: [], lines: [] };
    }
    const from = new Date(sinceMs - OVERLAP_MS);
    const [orders, lines] = [
      await tx.order.findMany({
        where: { restaurantId, branchId: auth.branchId, updatedAt: { gt: from } },
        select: { id: true, tableId: true, status: true, version: true, updatedAt: true },
        take: LIMIT,
      }),
      await tx.orderLine.findMany({
        where: { restaurantId, updatedAt: { gt: from }, order: { branchId: auth.branchId } },
        take: LIMIT,
      }),
    ];
    return {
      now,
      resync: orders.length === LIMIT || lines.length === LIMIT,
      orders,
      lines: lines.map((l) => lineView(l, auth.role)),
    };
  });
  return Response.json(body);
});
