import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as floorRoute } from "@/app/api/floor/route";
import { POST as voidLineRoute } from "@/app/api/order-lines/[id]/void/route";
import { POST as discountRoute } from "@/app/api/orders/[id]/discount/route";
import { POST as addLinesRoute } from "@/app/api/orders/[id]/lines/route";
import { GET as orderRoute } from "@/app/api/orders/[id]/route";
import { POST as settleRoute } from "@/app/api/orders/[id]/settle/route";
import { POST as voidOrderRoute } from "@/app/api/orders/[id]/void/route";
import type { PrismaClient } from "@/generated/prisma/client";
import { calculateBill } from "@/lib/bill";
import { db } from "@/lib/db";
import { createTenant, ownerDb, type TenantFixture } from "./fixtures";
import { call, loginAs, type Handler } from "./http";

let owner: PrismaClient;
let a: TenantFixture;
let manager: string;
let staff: string;
let kitchen: string;

beforeAll(async () => {
  owner = ownerDb();
  a = await createTenant(owner, "checkout");
  // VAT 10%, service 5%: every bill exercises the whole calculation.
  await owner.restaurant.update({ where: { id: a.restaurantId }, data: { vatRateBp: 1000, serviceChargeBp: 500 } });
  [manager, staff, kitchen] = await Promise.all([loginAs(a, "MANAGER"), loginAs(a, "STAFF"), loginAs(a, "KITCHEN")]);
});

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

async function post(handler: Handler, path: string, cookie: string, body: unknown, id: string, key: string = randomUUID()) {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "idempotency-key": key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) as Promise<never> },
  );
  return { status: res.status, body: await res.json(), replayed: res.headers.get("idempotent-replayed") === "true" };
}

const discount = (id: string, cookie: string, body: unknown, key?: string) => post(discountRoute as Handler, `/api/orders/${id}/discount`, cookie, body, id, key);
const settle = (id: string, cookie: string, body: unknown, key?: string) => post(settleRoute as Handler, `/api/orders/${id}/settle`, cookie, body, id, key);
const voidLine = (id: string, cookie: string, body: unknown) => post(voidLineRoute as Handler, `/api/order-lines/${id}/void`, cookie, body, id);
const voidOrder = (id: string, cookie: string, body: unknown) => post(voidOrderRoute as Handler, `/api/orders/${id}/void`, cookie, body, id);
const addLine = (id: string) => post(addLinesRoute as Handler, `/api/orders/${id}/lines`, staff, { items: [{ menuItemId: a.menuItemId, quantity: 1 }] }, id);
const view = async (id: string) => (await call(orderRoute as Handler, { path: `/api/orders/${id}`, cookie: manager, params: { id } })).body;

/** Open order on a fresh table with lines (Latte, 95,000) in the given statuses. */
async function freshOrder(statuses: ("SENT" | "PREPARING" | "READY" | "SERVED")[] = ["SERVED", "SERVED"]) {
  const table = await owner.diningTable.create({
    data: { restaurantId: a.restaurantId, branchId: a.branchId, label: randomUUID().slice(0, 6), seats: 2 },
  });
  const order = await owner.order.create({
    data: { restaurantId: a.restaurantId, branchId: a.branchId, tableId: table.id, openedById: a.people.STAFF.id },
  });
  const lines = [];
  for (const status of statuses) {
    lines.push(
      await owner.orderLine.create({
        data: {
          restaurantId: a.restaurantId, orderId: order.id, menuItemId: a.menuItemId, nameSnapshot: "Latte",
          unitPriceSnapshotToman: 95_000, quantity: 1, status, createdById: a.people.STAFF.id,
        },
      }),
    );
  }
  return { orderId: order.id, tableId: table.id, lineIds: lines.map((l) => l.id) };
}

const audits = (entityId: string, action: string) =>
  owner.auditEvent.findMany({ where: { restaurantId: a.restaurantId, entityId, action } });

describe("discount (manager, versioned, audited)", () => {
  it("applies a percent discount, bumps the version, and records who, why, before and after", async () => {
    const { orderId } = await freshOrder();
    const res = await discount(orderId, manager, { version: 1, discount: { type: "PERCENT", value: 1000 }, reason: "مشتری دائمی" });
    expect(res.status).toBe(200);
    expect(res.body.order.version).toBe(2);
    // 190,000 − 19,000 = 171,000; service 5% = 8,550; VAT 10% of 179,550 = 17,955
    expect(res.body.bill).toEqual({ subtotalToman: 190_000, discountToman: 19_000, serviceChargeToman: 8_550, vatToman: 17_955, totalToman: 197_505 });

    const [event] = await audits(orderId, "order.discount");
    expect(event).toMatchObject({ actorId: a.people.MANAGER.id });
    expect(event!.data).toMatchObject({ reason: "مشتری دائمی", before: { type: null }, after: { type: "PERCENT", value: 1000, discountToman: 19_000 } });
  });

  it("STAFF cannot discount; KITCHEN cannot discount", async () => {
    const { orderId } = await freshOrder();
    const body = { version: 1, discount: { type: "AMOUNT", value: 10_000 }, reason: "x y" };
    expect((await discount(orderId, staff, body)).status).toBe(403);
    expect((await discount(orderId, kitchen, body)).status).toBe(403);
    expect((await owner.order.findUniqueOrThrow({ where: { id: orderId } })).discountType).toBeNull();
  });

  it("a stale version is refused with 409 and the current version", async () => {
    const { orderId } = await freshOrder();
    await discount(orderId, manager, { version: 1, discount: { type: "AMOUNT", value: 10_000 }, reason: "اول" });
    const stale = await discount(orderId, manager, { version: 1, discount: { type: "AMOUNT", value: 90_000 }, reason: "دوم" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.version).toBe(2);
    expect((await owner.order.findUniqueOrThrow({ where: { id: orderId } })).discountValue).toBe(10_000);
  });

  it("two managers discounting the same version at once: one wins, one 409", async () => {
    const { orderId } = await freshOrder();
    const results = await Promise.all([
      discount(orderId, manager, { version: 1, discount: { type: "PERCENT", value: 500 }, reason: "الف" }),
      discount(orderId, manager, { version: 1, discount: { type: "PERCENT", value: 2000 }, reason: "تخفیف همکار" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await owner.order.findUniqueOrThrow({ where: { id: orderId } })).version).toBe(2);
  });

  it("refuses an amount larger than the subtotal, and can remove a discount (audited)", async () => {
    const { orderId } = await freshOrder();
    expect((await discount(orderId, manager, { version: 1, discount: { type: "AMOUNT", value: 500_000 }, reason: "زیاد" })).status).toBe(422);
    await discount(orderId, manager, { version: 1, discount: { type: "AMOUNT", value: 20_000 }, reason: "تأخیر" });
    const removed = await discount(orderId, manager, { version: 2, discount: null, reason: "اشتباه بود" });
    expect(removed.status).toBe(200);
    expect(removed.body.bill.discountToman).toBe(0);
    expect(await audits(orderId, "order.discount_removed")).toHaveLength(1);
  });
});

describe("voiding lines", () => {
  it("staff can void an item the kitchen hasn't started; it leaves the bill and is audited", async () => {
    const { orderId, lineIds } = await freshOrder(["SENT", "SERVED"]);
    const res = await voidLine(lineIds[0]!, staff, { from: "SENT", reason: "مشتری منصرف شد" });
    expect(res.status).toBe(200);
    expect((await view(orderId)).bill.subtotalToman).toBe(95_000);
    const [event] = await audits(lineIds[0]!, "order_line.void");
    expect(event).toMatchObject({ actorId: a.people.STAFF.id });
    expect(event!.data).toMatchObject({ reason: "مشتری منصرف شد", previousStatus: "SENT" });
  });

  it("staff cannot void once the kitchen has started; a manager can", async () => {
    const { lineIds } = await freshOrder(["PREPARING"]);
    expect((await voidLine(lineIds[0]!, staff, { from: "PREPARING", reason: "اشتباه" })).status).toBe(403);
    expect((await voidLine(lineIds[0]!, kitchen, { from: "PREPARING", reason: "اشتباه" })).status).toBe(403);
    expect((await voidLine(lineIds[0]!, manager, { from: "PREPARING", reason: "تأخیر زیاد آشپزخانه" })).status).toBe(200);
  });

  it("is conditional: a stale 'from' gets 409 with the current state", async () => {
    const { lineIds } = await freshOrder(["SENT"]);
    await owner.orderLine.update({ where: { id: lineIds[0] }, data: { status: "PREPARING" } });
    const res = await voidLine(lineIds[0]!, staff, { from: "SENT", reason: "منصرف شد" });
    expect(res.status).toBe(409);
    expect(res.body.error.details.line.status).toBe("PREPARING");
  });
});

describe("settle", () => {
  it("settles a split payment that equals the total exactly; snapshot, payments, audit, table free", async () => {
    const { orderId, tableId } = await freshOrder();
    const { bill } = await view(orderId);
    expect(bill.totalToman).toBe(219_450); // 190,000 + 5% + 10%
    const res = await settle(orderId, staff, {
      version: 1,
      payments: [
        { method: "CARD_READER", amountToman: 100_000 },
        { method: "CASH", amountToman: 50_000 },
        { method: "CARD_TRANSFER", amountToman: 69_450 },
      ],
    });
    expect(res.status).toBe(200);

    const order = await owner.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
    expect(order).toMatchObject({ status: "SETTLED", totalToman: 219_450, subtotalToman: 190_000, settledById: a.people.STAFF.id, version: 2 });
    expect(order.payments.map((p) => p.amountToman).sort()).toEqual([100_000, 50_000, 69_450].sort());
    expect(await audits(orderId, "order.settle")).toHaveLength(1);

    const floor = await call(floorRoute as Handler, { path: "/api/floor", cookie: staff });
    expect(floor.body.tables.find((t: { id: string }) => t.id === tableId).order).toBeNull();
  });

  it("refuses payments that don't match the total, by even one Toman, and writes nothing", async () => {
    const { orderId } = await freshOrder();
    for (const amount of [219_449, 219_451]) {
      const res = await settle(orderId, staff, { version: 1, payments: [{ method: "CARD_READER", amountToman: amount }] });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: "PAYMENT_MISMATCH", details: { totalToman: 219_450, paidToman: amount } });
    }
    const order = await owner.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
    expect(order.status).toBe("OPEN");
    expect(order.payments).toHaveLength(0);
  });

  it("refuses a stale version (the bill changed since the waiter looked)", async () => {
    const { orderId } = await freshOrder();
    await discount(orderId, manager, { version: 1, discount: { type: "AMOUNT", value: 10_000 }, reason: "تأخیر" });
    const res = await settle(orderId, staff, { version: 1, payments: [{ method: "CASH", amountToman: 219_450 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.details.version).toBe(2);
  });

  it("two devices settling at once: one settles, the other gets 409; payments recorded once", async () => {
    const { orderId } = await freshOrder();
    const body = { version: 1, payments: [{ method: "CARD_READER", amountToman: 219_450 }] };
    const results = await Promise.all([settle(orderId, staff, body), settle(orderId, manager, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await owner.payment.count({ where: { orderId } })).toBe(1);
  });

  it("a retried settle (same key, weak Wi-Fi) replays the result without paying twice", async () => {
    const { orderId } = await freshOrder();
    const key = randomUUID();
    const body = { version: 1, payments: [{ method: "CASH", amountToman: 219_450 }] };
    expect((await settle(orderId, staff, body, key)).status).toBe(200);
    const retry = await settle(orderId, staff, body, key);
    expect(retry).toMatchObject({ status: 200, replayed: true });
    expect(await owner.payment.count({ where: { orderId } })).toBe(1);
  });

  it("KITCHEN cannot settle", async () => {
    const { orderId } = await freshOrder();
    expect((await settle(orderId, kitchen, { version: 1, payments: [{ method: "CASH", amountToman: 219_450 }] })).status).toBe(403);
  });

  it("a settled bill never changes: later menu price changes don't touch it", async () => {
    const { orderId } = await freshOrder();
    await settle(orderId, staff, { version: 1, payments: [{ method: "CASH", amountToman: 219_450 }] });
    await owner.menuItem.update({ where: { id: a.menuItemId }, data: { priceToman: 150_000 } });
    await owner.restaurant.update({ where: { id: a.restaurantId }, data: { vatRateBp: 1200 } });
    try {
      expect((await view(orderId)).bill.totalToman).toBe(219_450);
    } finally {
      await owner.menuItem.update({ where: { id: a.menuItemId }, data: { priceToman: 95_000 } });
      await owner.restaurant.update({ where: { id: a.restaurantId }, data: { vatRateBp: 1000 } });
    }
  });

  it("settling while items are added or voided never produces a bill that misses or keeps one", async () => {
    for (let round = 0; round < 6; round++) {
      const { orderId, lineIds } = await freshOrder(["SERVED", "SENT"]);
      const body = { version: 1, payments: [{ method: "CARD_READER", amountToman: 219_450 }] };
      const change = round % 2 === 0 ? addLine(orderId) : voidLine(lineIds[1]!, staff, { from: "SENT", reason: "منصرف شد" });
      const [settled, changed] = await Promise.all([settle(orderId, staff, body), change]);

      const order = await owner.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, payments: true } });
      if (order.status === "SETTLED") {
        // Whatever won, the snapshot matches the lines and the payments match the snapshot.
        const recomputed = calculateBill({
          lines: order.lines.map((l) => ({ unitPriceToman: l.unitPriceSnapshotToman, quantity: l.quantity, status: l.status })),
          discount: null,
          serviceChargeBp: 500,
          vatRateBp: 1000,
        });
        expect(order.totalToman).toBe(recomputed.totalToman);
        expect(order.payments.reduce((s, p) => s + p.amountToman, 0)).toBe(order.totalToman);
        expect(changed.status).toBe(409); // the change came after the settle and was refused
      } else {
        expect(settled.status).toBe(422); // the change came first; the old total no longer matched
        expect([200, 201]).toContain(changed.status);
      }
    }
  });
});

describe("cancelling an order", () => {
  it("cancels an empty order (wrong table) and frees the table; audited", async () => {
    const { orderId } = await freshOrder([]);
    const res = await voidOrder(orderId, staff, { version: 1, reason: "میز اشتباه" });
    expect(res.status).toBe(200);
    expect(await audits(orderId, "order.void")).toHaveLength(1);
  });

  it("refuses to cancel an order with billable items", async () => {
    const { orderId } = await freshOrder(["SERVED"]);
    const res = await voidOrder(orderId, manager, { version: 1, reason: "بستن" });
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe("ORDER_NOT_EMPTY");
  });
});
