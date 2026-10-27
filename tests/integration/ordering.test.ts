import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as changesRoute } from "@/app/api/changes/route";
import { GET as floorRoute } from "@/app/api/floor/route";
import { GET as menuRoute } from "@/app/api/menu/route";
import { GET as orderRoute } from "@/app/api/orders/[id]/route";
import { POST as addLinesRoute } from "@/app/api/orders/[id]/lines/route";
import { POST as openRoute } from "@/app/api/orders/route";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createTenant, ownerDb, type TenantFixture } from "./fixtures";
import { call, loginAs, type Handler } from "./http";

let owner: PrismaClient;
let a: TenantFixture;
let b: TenantFixture;
let staffA: string; // cookies
let managerA: string;
let kitchenA: string;
let staffB: string;

beforeAll(async () => {
  owner = ownerDb();
  a = await createTenant(owner, "order-a");
  b = await createTenant(owner, "order-b");
  [staffA, managerA, kitchenA, staffB] = await Promise.all([
    loginAs(a, "STAFF"),
    loginAs(a, "MANAGER"),
    loginAs(a, "KITCHEN"),
    loginAs(b, "STAFF"),
  ]);
});

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

const withKey = (key: string) => ({ "idempotency-key": key });

async function callWithKey(
  handler: Handler,
  opts: { path: string; cookie: string; body: unknown; params?: Record<string, string>; key?: string },
) {
  const key = opts.key ?? randomUUID();
  const res = await handler(
    new Request(`http://localhost${opts.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: opts.cookie, ...withKey(key) },
      body: JSON.stringify(opts.body),
    }),
    { params: Promise.resolve(opts.params ?? {}) as Promise<never> },
  );
  return { status: res.status, body: await res.json(), replayed: res.headers.get("idempotent-replayed") === "true" };
}

const addLines = (orderId: string, cookie: string, items: unknown[], key?: string) =>
  callWithKey(addLinesRoute as Handler, {
    path: `/api/orders/${orderId}/lines`,
    cookie,
    body: { items },
    params: { id: orderId },
    key,
  });

const openOrder = (cookie: string, tableId: string | null, key?: string) =>
  callWithKey(openRoute as Handler, { path: "/api/orders", cookie, body: { tableId }, key });

const latte = () => ({ menuItemId: a.menuItemId, quantity: 1 });

/** A fresh open order in tenant A on a fresh table. */
async function freshOrder() {
  const table = await owner.diningTable.create({
    data: { restaurantId: a.restaurantId, branchId: a.branchId, label: randomUUID().slice(0, 6), seats: 2 },
  });
  const opened = await openOrder(staffA, table.id);
  expect(opened.status).toBe(201);
  return { orderId: opened.body.order.id as string, tableId: table.id };
}

const lineCount = (orderId: string) => owner.orderLine.count({ where: { orderId } });

describe("adding items concurrently", () => {
  it("10 simultaneous adds from different devices all persist", async () => {
    const { orderId } = await freshOrder();
    const cookies = [staffA, managerA];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        addLines(orderId, cookies[i % 2]!, [{ ...latte(), note: `device ${i}` }]),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await lineCount(orderId)).toBe(10);
    const notes = (await owner.orderLine.findMany({ where: { orderId } })).map((l) => l.note).sort();
    expect(notes).toEqual(Array.from({ length: 10 }, (_, i) => `device ${i}`).sort());
  });

  it("the same request sent 5 times at once is applied exactly once", async () => {
    const { orderId } = await freshOrder();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => addLines(orderId, staffA, [latte(), latte()], key)),
    );
    expect(await lineCount(orderId)).toBe(2);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    for (const r of results) expect(r.body).toEqual(results[0]!.body);
  });

  it("a retry after success returns the original result and adds nothing", async () => {
    const { orderId } = await freshOrder();
    const key = randomUUID();
    const first = await addLines(orderId, staffA, [latte()], key);
    const retry = await addLines(orderId, staffA, [latte()], key);
    expect(retry.replayed).toBe(true);
    expect(retry.body).toEqual(first.body);
    expect(await lineCount(orderId)).toBe(1);
  });

  it("rejects a key reused for a different request", async () => {
    const one = await freshOrder();
    const two = await freshOrder();
    const key = randomUUID();
    expect((await addLines(one.orderId, staffA, [latte()], key)).status).toBe(201);
    const reused = await addLines(two.orderId, staffA, [latte()], key);
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await lineCount(two.orderId)).toBe(0);
  });

  it("requires an idempotency key on mutations", async () => {
    const { orderId } = await freshOrder();
    const { status, body } = await call(addLinesRoute as Handler, {
      method: "POST",
      path: `/api/orders/${orderId}/lines`,
      cookie: staffA,
      body: { items: [latte()] },
      params: { id: orderId },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});

describe("opening tables", () => {
  it("two waiters opening the same table at once: exactly one wins, the other gets 409", async () => {
    const table = await owner.diningTable.create({
      data: { restaurantId: a.restaurantId, branchId: a.branchId, label: randomUUID().slice(0, 6), seats: 2 },
    });
    const results = await Promise.all([openOrder(staffA, table.id), openOrder(managerA, table.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await owner.order.count({ where: { tableId: table.id, status: "OPEN" } })).toBe(1);
  });

  it("an occupied table answers 409 with the open order's id", async () => {
    const { orderId, tableId } = await freshOrder();
    const again = await openOrder(managerA, tableId);
    expect(again.status).toBe(409);
    expect(again.body.error.details.orderId).toBe(orderId);
  });

  it("opens a takeaway order without a table", async () => {
    const opened = await openOrder(staffA, null);
    expect(opened.status).toBe(201);
    expect(opened.body.order.tableId).toBeNull();
  });
});

describe("order rules", () => {
  it("snapshots name and price: a later menu price change doesn't touch the bill", async () => {
    const { orderId } = await freshOrder();
    await addLines(orderId, staffA, [latte()]);
    await owner.menuItem.update({ where: { id: a.menuItemId }, data: { priceToman: 120_000, name: "Latte (new)" } });
    try {
      const { body } = await call(orderRoute as Handler, { path: `/api/orders/${orderId}`, cookie: staffA, params: { id: orderId } });
      expect(body.lines[0]).toMatchObject({ name: "Latte", unitPriceToman: 95_000 });
      expect(body.bill.subtotalToman).toBe(95_000);
    } finally {
      await owner.menuItem.update({ where: { id: a.menuItemId }, data: { priceToman: 95_000, name: "Latte" } });
    }
  });

  it("refuses unavailable menu items", async () => {
    const { orderId } = await freshOrder();
    await owner.menuItem.update({ where: { id: a.menuItemId }, data: { isAvailable: false } });
    try {
      const res = await addLines(orderId, staffA, [latte()]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("MENU_ITEM_UNAVAILABLE");
    } finally {
      await owner.menuItem.update({ where: { id: a.menuItemId }, data: { isAvailable: true } });
    }
  });

  it("refuses to add items to a settled order", async () => {
    const { orderId } = await freshOrder();
    await owner.order.update({
      where: { id: orderId },
      data: {
        status: "SETTLED",
        subtotalToman: 0,
        discountToman: 0,
        serviceChargeToman: 0,
        vatToman: 0,
        totalToman: 0,
        settledAt: new Date(),
        settledById: a.people.STAFF.id,
      },
    });
    const res = await addLines(orderId, staffA, [latte()]);
    expect(res.status).toBe(409);
    expect(await lineCount(orderId)).toBe(0);
  });

  it("kitchen cannot open orders or add items", async () => {
    const { orderId } = await freshOrder();
    expect((await openOrder(kitchenA, null)).status).toBe(403);
    expect((await addLines(orderId, kitchenA, [latte()])).status).toBe(403);
  });
});

describe("changes endpoint (polling)", () => {
  it("reports lines added since the cursor; asks for a resync without one", async () => {
    const first = await call(changesRoute as Handler, { path: "/api/changes", cookie: staffA });
    expect(first.body.resync).toBe(true);

    const { orderId } = await freshOrder();
    const cursor = first.body.now as string;
    await addLines(orderId, managerA, [latte()]);
    const { body } = await call(changesRoute as Handler, {
      path: `/api/changes?since=${encodeURIComponent(cursor)}`,
      cookie: staffA,
    });
    expect(body.resync).toBe(false);
    expect(body.lines.some((l: { orderId: string }) => l.orderId === orderId)).toBe(true);
    expect(body.orders.some((o: { id: string }) => o.id === orderId)).toBe(true);
  });

  it("never sends prices to the kitchen", async () => {
    const { orderId } = await freshOrder();
    const since = new Date(Date.now() - 60_000).toISOString();
    await addLines(orderId, staffA, [latte()]);
    const kitchen = await call(changesRoute as Handler, {
      path: `/api/changes?since=${encodeURIComponent(since)}`,
      cookie: kitchenA,
    });
    const staff = await call(changesRoute as Handler, {
      path: `/api/changes?since=${encodeURIComponent(since)}`,
      cookie: staffA,
    });
    expect(kitchen.body.lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(kitchen.body)).not.toMatch(/price|total|Toman/i);
    expect(staff.body.lines[0]).toHaveProperty("unitPriceToman");
  });

  it("kitchen cannot load an order with prices or the menu", async () => {
    const { orderId } = await freshOrder();
    expect((await call(orderRoute as Handler, { path: `/api/orders/${orderId}`, cookie: kitchenA, params: { id: orderId } })).status).toBe(403);
    expect((await call(menuRoute as Handler, { path: "/api/menu", cookie: kitchenA })).status).toBe(403);
  });
});

describe("API-level isolation: a signed-in user of B against A's ids", () => {
  it("cannot read A's order", async () => {
    const res = await call(orderRoute as Handler, { path: `/api/orders/${a.orderId}`, cookie: staffB, params: { id: a.orderId } });
    expect(res.status).toBe(404);
  });

  it("cannot add items to A's order", async () => {
    const before = await lineCount(a.orderId);
    const res = await addLines(a.orderId, staffB, [{ menuItemId: b.menuItemId, quantity: 1 }]);
    expect(res.status).toBe(404);
    expect(await lineCount(a.orderId)).toBe(before);
  });

  it("cannot reference A's menu item from its own order", async () => {
    const opened = await openOrder(staffB, null);
    const res = await addLines(opened.body.order.id, staffB, [{ menuItemId: a.menuItemId, quantity: 1 }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MENU_ITEM_UNAVAILABLE");
    expect(await lineCount(opened.body.order.id)).toBe(0);
  });

  it("cannot open an order on A's table", async () => {
    const res = await openOrder(staffB, a.tableId);
    expect(res.status).toBe(404);
  });

  it("sees none of A's tables, orders or menu in its own listings", async () => {
    const floor = await call(floorRoute as Handler, { path: "/api/floor", cookie: staffB });
    const menu = await call(menuRoute as Handler, { path: "/api/menu", cookie: staffB });
    const changes = await call(changesRoute as Handler, {
      path: `/api/changes?since=${encodeURIComponent(new Date(Date.now() - 120_000).toISOString())}`,
      cookie: staffB,
    });
    const everything = JSON.stringify([floor.body, menu.body, changes.body]);
    for (const id of [a.tableId, a.orderId, a.menuItemId, a.lineId]) expect(everything).not.toContain(id);
  });

  it("a malformed id is a 404, not a server error", async () => {
    const res = await call(orderRoute as Handler, { path: "/api/orders/not-a-uuid", cookie: staffA, params: { id: "not-a-uuid" } });
    expect(res.status).toBe(404);
  });
});
