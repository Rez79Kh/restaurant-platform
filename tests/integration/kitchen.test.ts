import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as kitchenRoute } from "@/app/api/kitchen/route";
import { POST as statusRoute } from "@/app/api/order-lines/[id]/status/route";
import { POST as addLinesRoute } from "@/app/api/orders/[id]/lines/route";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createTenant, ownerDb, type TenantFixture } from "./fixtures";
import { call, loginAs, type Handler } from "./http";

let owner: PrismaClient;
let a: TenantFixture;
let b: TenantFixture;
let kitchen: string;
let staff: string;
let manager: string;
let kitchenB: string;

beforeAll(async () => {
  owner = ownerDb();
  a = await createTenant(owner, "kitchen-a");
  b = await createTenant(owner, "kitchen-b");
  [kitchen, staff, manager, kitchenB] = await Promise.all([
    loginAs(a, "KITCHEN"),
    loginAs(a, "STAFF"),
    loginAs(a, "MANAGER"),
    loginAs(b, "KITCHEN"),
  ]);
});

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

async function post(handler: Handler, path: string, cookie: string, body: unknown, params: Record<string, string>, key: string = randomUUID()) {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "idempotency-key": key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) as Promise<never> },
  );
  return { status: res.status, body: await res.json(), replayed: res.headers.get("idempotent-replayed") === "true" };
}

const move = (lineId: string, cookie: string, from: string, to: string, key?: string) =>
  post(statusRoute as Handler, `/api/order-lines/${lineId}/status`, cookie, { from, to }, { id: lineId }, key);

/** A fresh SENT line on a fresh open order in tenant A. */
async function freshLine(status: "SENT" | "PREPARING" | "READY" = "SENT") {
  const order = await owner.order.create({
    data: { restaurantId: a.restaurantId, branchId: a.branchId, openedById: a.people.STAFF.id },
  });
  const line = await owner.orderLine.create({
    data: {
      restaurantId: a.restaurantId,
      orderId: order.id,
      menuItemId: a.menuItemId,
      nameSnapshot: "Latte",
      unitPriceSnapshotToman: 95_000,
      quantity: 1,
      status,
      createdById: a.people.STAFF.id,
    },
  });
  return { orderId: order.id, lineId: line.id };
}

const statusOf = async (lineId: string) => (await owner.orderLine.findUniqueOrThrow({ where: { id: lineId } })).status;

describe("conditional status transitions", () => {
  it("two devices moving the same line at once: exactly one wins, the other gets 409 with the current state", async () => {
    const { lineId } = await freshLine();
    const results = await Promise.all([
      move(lineId, kitchen, "SENT", "PREPARING"),
      move(lineId, manager, "SENT", "PREPARING"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe("CONFLICT");
    expect(loser.body.error.details.line).toMatchObject({ id: lineId, status: "PREPARING" });
    expect(await statusOf(lineId)).toBe("PREPARING");
  });

  it("a stale 'from' never overwrites: 409, line unchanged", async () => {
    const { lineId } = await freshLine("READY");
    const stale = await move(lineId, kitchen, "SENT", "PREPARING");
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.line.status).toBe("READY");
    expect(await statusOf(lineId)).toBe("READY");
  });

  it("a retried request (same key) replays the success instead of reporting a false conflict", async () => {
    const { lineId } = await freshLine();
    const key = randomUUID();
    const first = await move(lineId, kitchen, "SENT", "PREPARING", key);
    const retry = await move(lineId, kitchen, "SENT", "PREPARING", key);
    expect(first.status).toBe(200);
    expect(retry).toMatchObject({ status: 200, replayed: true });
  });

  it("kitchen status changes and a waiter adding items at the same moment: neither is lost", async () => {
    const { orderId, lineId } = await freshLine();
    const [moved, added] = await Promise.all([
      move(lineId, kitchen, "SENT", "PREPARING"),
      post(addLinesRoute as Handler, `/api/orders/${orderId}/lines`, staff, { items: [{ menuItemId: a.menuItemId, quantity: 2 }] }, { id: orderId }),
    ]);
    expect([moved.status, added.status]).toEqual([200, 201]);
    expect(await statusOf(lineId)).toBe("PREPARING");
    expect(await owner.orderLine.count({ where: { orderId } })).toBe(2);
  });

  it("refuses moves on a closed order", async () => {
    const { orderId, lineId } = await freshLine();
    await owner.order.update({ where: { id: orderId }, data: { status: "VOID" } });
    const res = await move(lineId, kitchen, "SENT", "PREPARING");
    expect(res.status).toBe(409);
    expect(res.body.error.details.orderStatus).toBe("VOID");
  });

  it("only allows the defined moves", async () => {
    const { lineId } = await freshLine();
    for (const [from, to] of [["SENT", "SERVED"], ["SENT", "VOID"], ["READY", "SENT"]]) {
      expect((await move(lineId, manager, from!, to!)).status).toBe(422);
    }
  });
});

describe("who may move what", () => {
  it("kitchen prepares and readies, but cannot mark served", async () => {
    const { lineId } = await freshLine("READY");
    expect((await move(lineId, kitchen, "READY", "SERVED")).status).toBe(403);
    expect((await move(lineId, staff, "READY", "SERVED")).status).toBe(200);
  });

  it("staff cannot start or finish preparing", async () => {
    const { lineId } = await freshLine();
    expect((await move(lineId, staff, "SENT", "PREPARING")).status).toBe(403);
    expect(await statusOf(lineId)).toBe("SENT");
  });

  it("another restaurant's kitchen cannot move this line (404)", async () => {
    const { lineId } = await freshLine();
    expect((await move(lineId, kitchenB, "SENT", "PREPARING")).status).toBe(404);
    expect(await statusOf(lineId)).toBe("SENT");
  });
});

describe("kitchen board", () => {
  it("shows open tickets oldest first, without a single price or total", async () => {
    const older = await freshLine();
    const newer = await freshLine();
    await owner.orderLine.update({ where: { id: older.lineId }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });

    const { status, body } = await call(kitchenRoute as Handler, { path: "/api/kitchen", cookie: kitchen });
    expect(status).toBe(200);
    const ids = body.tickets.map((t: { orderId: string }) => t.orderId);
    expect(ids.indexOf(older.orderId)).toBeLessThan(ids.indexOf(newer.orderId));
    expect(JSON.stringify(body)).not.toMatch(/price|total|Toman|discount/i);
    expect(body.tickets[0].lines[0]).toHaveProperty("name");
  });

  it("keeps a recently voided line on the ticket so the kitchen stops making it", async () => {
    const { orderId, lineId } = await freshLine("PREPARING");
    await owner.orderLine.create({
      data: {
        restaurantId: a.restaurantId, orderId, menuItemId: a.menuItemId, nameSnapshot: "Latte",
        unitPriceSnapshotToman: 95_000, quantity: 1, createdById: a.people.STAFF.id,
      },
    });
    await owner.orderLine.update({ where: { id: lineId }, data: { status: "VOID", voidedById: a.people.MANAGER.id } });
    const { body } = await call(kitchenRoute as Handler, { path: "/api/kitchen", cookie: kitchen });
    const ticket = body.tickets.find((t: { orderId: string }) => t.orderId === orderId);
    expect(ticket.lines.find((l: { id: string }) => l.id === lineId).status).toBe("VOID");
  });

  it("is closed to staff and shows nothing of another restaurant", async () => {
    expect((await call(kitchenRoute as Handler, { path: "/api/kitchen", cookie: staff })).status).toBe(403);
    const other = await call(kitchenRoute as Handler, { path: "/api/kitchen", cookie: kitchenB });
    expect(JSON.stringify(other.body)).not.toContain(a.restaurantId);
    expect(other.body.tickets.every((t: { orderId: string }) => t.orderId !== a.orderId)).toBe(true);
  });
});
