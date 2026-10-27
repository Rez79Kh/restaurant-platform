import { requireRole } from "@/lib/auth/session";
import { notFound } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseId } from "@/lib/http/validate";
import { dbNow, loadOrder } from "@/lib/orders/views";
import { withTenant } from "@/lib/tenant";

export const GET = route<{ id: string }>(async ({ req, params, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER", "STAFF");
  const orderId = parseId(params.id);
  const body = await withTenant(auth.restaurantId, async (tx, restaurantId) => {
    const now = await dbNow(tx);
    const view = await loadOrder(tx, restaurantId, auth.branchId, orderId, auth.role);
    return view && { now, ...view };
  });
  if (!body) throw notFound("سفارش پیدا نشد.");
  return Response.json(body);
});
