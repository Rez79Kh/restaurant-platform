import { ALL_ROLES, requireRole } from "@/lib/auth/session";
import { route } from "@/lib/http/handler";
import { withTenant } from "@/lib/tenant";

export const GET = route(async ({ req, log }) => {
  const auth = await requireRole({ req, log }, ...ALL_ROLES);
  const restaurant = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    tx.restaurant.findFirstOrThrow({ where: { id: restaurantId }, select: { name: true } }),
  );
  return Response.json({
    staff: { id: auth.staffId, name: auth.name, role: auth.role },
    restaurant,
  });
});
