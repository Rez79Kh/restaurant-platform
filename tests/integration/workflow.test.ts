import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as changesRoute } from "@/app/api/changes/route";
import { GET as floorRoute } from "@/app/api/floor/route";
import { GET as kitchenRoute } from "@/app/api/kitchen/route";
import { POST as statusRoute } from "@/app/api/order-lines/[id]/status/route";
import { POST as discountRoute } from "@/app/api/orders/[id]/discount/route";
import { POST as addLinesRoute } from "@/app/api/orders/[id]/lines/route";
import { GET as orderRoute } from "@/app/api/orders/[id]/route";
import { POST as settleRoute } from "@/app/api/orders/[id]/settle/route";
import { POST as openRoute } from "@/app/api/orders/route";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { hashPin } from "@/lib/pin";
import { createTenant, ownerDb, type TenantFixture } from "./fixtures";
import { call, sessionCookieOf, type Handler } from "./http";
import { TEST_PIN_PEPPER } from "./test-env";

// The one workflow v1 exists for, end to end through the real route handlers
// and a real Postgres (RLS on, as app_user): a table's check from the first
// item to the settled bill, with four people on four devices.
//
//   login → open table → two waiters add items at once → kitchen advances
//   → waiter serves → a second round → manager discounts → split payment
//   → settled, table free, audit trail complete

let owner: PrismaClient;
let t: TenantFixture;
let cheesecakeId: string;
const secondWaiter = { phone: "09171234567", pin: "5678" };

beforeAll(async () => {
  owner = ownerDb();
  t = await createTenant(owner, "workflow");
  await owner.restaurant.update({ where: { id: t.restaurantId }, data: { vatRateBp: 1000, serviceChargeBp: 500 } });
  const cheesecake = await owner.menuItem.create({
    data: { restaurantId: t.restaurantId, categoryId: t.categoryId, name: "Cheesecake", priceToman: 210_000 },
  });
  cheesecakeId = cheesecake.id;
  await owner.staffMember.create({
    data: {
      restaurantId: t.restaurantId,
      branchId: t.branchId,
      name: "Second waiter",
      phone: secondWaiter.phone,
      pinHash: await hashPin(secondWaiter.pin, TEST_PIN_PEPPER),
      role: "STAFF",
    },
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

async function login(phone: string, pin: string) {
  const { res, status } = await call(loginRoute as Handler, {
    method: "POST",
    path: "/api/auth/login",
    body: { slug: t.slug, phone, pin },
  });
  expect(status).toBe(200);
  return sessionCookieOf(res);
}

const get = (handler: unknown, path: string, cookie: string, params?: Record<string, string>) =>
  call(handler as Handler, { path, cookie, params });
const mutate = (handler: unknown, path: string, cookie: string, body: unknown, params?: Record<string, string>) =>
  call(handler as Handler, { method: "POST", path, cookie, body, params, key: randomUUID() });

describe("full workflow: a table's check from first item to settled bill", () => {
  it("runs the whole shift scenario", async () => {
    // 1. Everyone logs in on their own device.
    const waiter = await login(t.people.STAFF.phone, t.people.STAFF.pin);
    const waiter2 = await login(secondWaiter.phone, secondWaiter.pin);
    const kitchen = await login(t.people.KITCHEN.phone, t.people.KITCHEN.pin);
    const manager = await login(t.people.MANAGER.phone, t.people.MANAGER.pin);

    // 2. The table is free; the waiter opens it.
    const table = await owner.diningTable.create({
      data: { restaurantId: t.restaurantId, branchId: t.branchId, label: "12", seats: 4 },
    });
    const floor0 = await get(floorRoute, "/api/floor", waiter);
    expect(floor0.body.tables.find((x: { id: string }) => x.id === table.id).order).toBeNull();
    const opened = await mutate(openRoute, "/api/orders", waiter, { tableId: table.id });
    expect(opened.status).toBe(201);
    const orderId: string = opened.body.order.id;
    const cursor: string = floor0.body.now;

    // 3. Two waiters add items to the same table at the same moment.
    const [a1, a2] = await Promise.all([
      mutate(addLinesRoute, `/api/orders/${orderId}/lines`, waiter, { items: [{ menuItemId: t.menuItemId, quantity: 2, note: "بدون شکر" }] }, { id: orderId }),
      mutate(addLinesRoute, `/api/orders/${orderId}/lines`, waiter2, { items: [{ menuItemId: cheesecakeId, quantity: 1 }] }, { id: orderId }),
    ]);
    expect([a1.status, a2.status]).toEqual([201, 201]);

    // 4. The kitchen sees the new items on its next poll, without prices.
    const changes = await get(changesRoute, `/api/changes?since=${encodeURIComponent(cursor)}`, kitchen);
    const newLines = changes.body.lines.filter((l: { orderId: string }) => l.orderId === orderId);
    expect(newLines).toHaveLength(2);
    expect(JSON.stringify(changes.body)).not.toMatch(/price|Toman/i);
    const board = await get(kitchenRoute, "/api/kitchen", kitchen);
    const ticket = board.body.tickets.find((x: { orderId: string }) => x.orderId === orderId);
    expect(ticket.tableLabel).toBe("12");
    expect(ticket.lines.map((l: { note: string | null }) => l.note)).toContain("بدون شکر");

    // 5. Kitchen: SENT → PREPARING → READY, one tap each.
    const advance = async (lineId: string, cookie: string, from: string, to: string) => {
      const r = await mutate(statusRoute, `/api/order-lines/${lineId}/status`, cookie, { from, to }, { id: lineId });
      expect(r.status).toBe(200);
    };
    for (const line of ticket.lines) {
      await advance(line.id, kitchen, "SENT", "PREPARING");
      await advance(line.id, kitchen, "PREPARING", "READY");
    }
    const floorReady = await get(floorRoute, "/api/floor", waiter);
    expect(floorReady.body.tables.find((x: { id: string }) => x.id === table.id).order.counts.READY).toBe(2);

    // 6. The waiter serves; then the table orders a second round.
    for (const line of ticket.lines) await advance(line.id, waiter, "READY", "SERVED");
    const round2 = await mutate(addLinesRoute, `/api/orders/${orderId}/lines`, waiter2, { items: [{ menuItemId: t.menuItemId, quantity: 1 }] }, { id: orderId });
    expect(round2.status).toBe(201);
    const extra = round2.body.lines[0].id;
    await advance(extra, kitchen, "SENT", "PREPARING");
    await advance(extra, kitchen, "PREPARING", "READY");
    await advance(extra, waiter2, "READY", "SERVED");

    // 7. The manager applies a 10% discount with a reason.
    const before = await get(orderRoute, `/api/orders/${orderId}`, manager, { id: orderId });
    const discounted = await mutate(discountRoute, `/api/orders/${orderId}/discount`, manager, {
      version: before.body.order.version,
      discount: { type: "PERCENT", value: 1000 },
      reason: "مشتری دائمی",
    }, { id: orderId });
    expect(discounted.status).toBe(200);

    // 8. The bill, in Toman:
    //    3 × 95,000 + 210,000                 = 495,000
    //    discount 10%                          = 49,500   → 445,500
    //    service 5% of 445,500                 = 22,275   → 467,775
    //    VAT 10% of 467,775 = 46,777.5, half-up = 46,778
    //    total                                 = 514,553
    expect(discounted.body.bill).toEqual({
      subtotalToman: 495_000,
      discountToman: 49_500,
      serviceChargeToman: 22_275,
      vatToman: 46_778,
      totalToman: 514_553,
    });

    // 9. Guests split the bill: card reader, cash and a card-to-card transfer.
    const payments = [
      { method: "CARD_READER", amountToman: 300_000 },
      { method: "CASH", amountToman: 100_000 },
      { method: "CARD_TRANSFER", amountToman: 114_553 },
    ];
    const settled = await mutate(settleRoute, `/api/orders/${orderId}/settle`, waiter2, {
      version: discounted.body.order.version,
      payments,
    }, { id: orderId });
    expect(settled.status).toBe(200);

    // 10. Settled: snapshot written, table free, kitchen board clear, audit trail complete.
    const order = await owner.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, payments: true } });
    expect(order).toMatchObject({ status: "SETTLED", totalToman: 514_553, discountToman: 49_500, discountReason: "مشتری دائمی" });
    expect(order.lines.every((l) => l.status === "SERVED")).toBe(true);
    expect(order.payments.reduce((s, p) => s + p.amountToman, 0)).toBe(514_553);

    const floorAfter = await get(floorRoute, "/api/floor", waiter);
    expect(floorAfter.body.tables.find((x: { id: string }) => x.id === table.id).order).toBeNull();
    const boardAfter = await get(kitchenRoute, "/api/kitchen", kitchen);
    expect(boardAfter.body.tickets.some((x: { orderId: string }) => x.orderId === orderId)).toBe(false);

    const trail = await owner.auditEvent.findMany({
      where: { restaurantId: t.restaurantId, entityId: orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(trail.map((e) => [e.action, e.actorId])).toEqual([
      ["order.discount", t.people.MANAGER.id],
      ["order.settle", expect.any(String)],
    ]);
  });
});
