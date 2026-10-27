import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { TEST_DIRECT_URL } from "./test-env";

/**
 * Owner connection for arranging fixtures. Locally (and in CI) the owner is a
 * superuser, so RLS does not apply to it. Never use it to assert behaviour:
 * assertions go through the app's runtime connection (app_user).
 */
export function ownerDb(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DIRECT_URL }) });
}

export type TenantFixture = Awaited<ReturnType<typeof createTenant>>;

/** A restaurant with one of everything an order touches, plus one open order with one line. */
export async function createTenant(owner: PrismaClient, label: string) {
  const suffix = randomUUID().slice(0, 8);
  const restaurant = await owner.restaurant.create({
    data: { name: `Test ${label}`, slug: `${label}-${suffix}` },
  });
  const restaurantId = restaurant.id;
  const branch = await owner.branch.create({ data: { restaurantId, name: "Main" } });
  const staff = await owner.staffMember.create({
    data: {
      restaurantId,
      branchId: branch.id,
      name: `Manager ${label}`,
      phone: `0912${Math.floor(Math.random() * 1e7).toString().padStart(7, "0")}`,
      pinHash: "not-a-real-hash",
      role: "MANAGER",
    },
  });
  const category = await owner.menuCategory.create({ data: { restaurantId, name: "Drinks" } });
  const menuItem = await owner.menuItem.create({
    data: { restaurantId, categoryId: category.id, name: "Latte", priceToman: 95_000 },
  });
  const table = await owner.diningTable.create({
    data: { restaurantId, branchId: branch.id, label: "1", seats: 4 },
  });
  const order = await owner.order.create({
    data: { restaurantId, branchId: branch.id, tableId: table.id, openedById: staff.id },
  });
  const line = await owner.orderLine.create({
    data: {
      restaurantId,
      orderId: order.id,
      menuItemId: menuItem.id,
      nameSnapshot: menuItem.name,
      unitPriceSnapshotToman: menuItem.priceToman,
      quantity: 1,
      createdById: staff.id,
    },
  });
  return {
    restaurantId,
    branchId: branch.id,
    staffId: staff.id,
    categoryId: category.id,
    menuItemId: menuItem.id,
    tableId: table.id,
    orderId: order.id,
    lineId: line.id,
  };
}
