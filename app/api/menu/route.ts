import { requireRole } from "@/lib/auth/session";
import { route } from "@/lib/http/handler";
import { withTenant } from "@/lib/tenant";

export const GET = route(async ({ req, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER", "STAFF");
  const categories = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    tx.menuCategory.findMany({
      where: { restaurantId },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        items: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true, priceToman: true, isAvailable: true },
        },
      },
    }),
  );
  return Response.json({ categories });
});
