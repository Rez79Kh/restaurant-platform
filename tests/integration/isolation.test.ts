import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { createTenant, ownerDb, type TenantFixture } from "./fixtures";
import { TEST_DATABASE_URL, TEST_DIRECT_URL } from "./test-env";

// Three independent layers, each tested on its own so a regression in one is
// not masked by the others:
//   1. composite foreign keys  (tested as the owner, with RLS out of the way)
//   2. Row-Level Security      (raw SQL as app_user, no WHERE restaurant_id)
//   3. withTenant()            (Prisma as app_user, the way routes use it)
// API-level tests (an authenticated user of A calling routes with B's ids)
// come with the routes in Phases 5–8.

const TENANT_TABLES = [
  "restaurants",
  "branches",
  "staff_members",
  "sessions",
  "menu_categories",
  "menu_items",
  "dining_tables",
  "orders",
  "order_lines",
  "payments",
  "audit_events",
  "menu_import_drafts",
  "idempotency_records",
] as const;

let owner: PrismaClient;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  owner = ownerDb();
  a = await createTenant(owner, "a");
  b = await createTenant(owner, "b");
});

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

describe("runtime connection", () => {
  it("is app_user: not a superuser, no BYPASSRLS, owns no tables", async () => {
    const [row] = await db().$queryRaw<
      { user: string; rolsuper: boolean; rolbypassrls: boolean; owned: number }[]
    >`
      SELECT current_user AS "user", r.rolsuper, r.rolbypassrls,
             (SELECT count(*)::int FROM pg_tables
               WHERE schemaname = 'public' AND tableowner = current_user) AS owned
      FROM pg_roles r WHERE r.rolname = current_user`;

    expect(row).toEqual({ user: "app_user", rolsuper: false, rolbypassrls: false, owned: 0 });
  });

  it("cannot update or delete the audit log", async () => {
    await expect(
      withTenant(a.restaurantId, (tx) => tx.$executeRaw`DELETE FROM audit_events`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("schema invariants", () => {
  it("every table with a restaurant_id column has RLS enabled, forced, and a policy", async () => {
    const rows = await db().$queryRaw<
      { table: string; enabled: boolean; forced: boolean; policies: number }[]
    >`
      SELECT c.relname AS "table", c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'
        AND (c.relname = 'restaurants' OR EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public' AND col.table_name = c.relname
            AND col.column_name = 'restaurant_id'))
      ORDER BY 1`;

    expect(rows.map((r) => r.table).sort()).toEqual([...TENANT_TABLES].sort());
    for (const row of rows) {
      expect(row, row.table).toMatchObject({ enabled: true, forced: true });
      expect(row.policies, row.table).toBeGreaterThan(0);
    }
  });

  it("the role, RLS and auth-lookup migrations are safe to run twice", async () => {
    const client = new pg.Client({ connectionString: TEST_DIRECT_URL });
    await client.connect();
    try {
      for (const name of ["20261027150100_app_user_and_rls", "20261027170000_auth_lookup"]) {
        const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
        await client.query(sql);
        await client.query(sql);
      }
    } finally {
      await client.end();
    }
  });
});

describe("layer 1: composite foreign keys (owner connection, RLS not involved)", () => {
  it("rejects an order line in A that references B's menu item", async () => {
    await expect(
      owner.orderLine.create({
        data: {
          restaurantId: a.restaurantId,
          orderId: a.orderId,
          menuItemId: b.menuItemId,
          nameSnapshot: "x",
          unitPriceSnapshotToman: 1,
          quantity: 1,
          createdById: a.staffId,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("rejects an order in A on B's table", async () => {
    await expect(
      owner.order.create({
        data: {
          restaurantId: a.restaurantId,
          branchId: a.branchId,
          tableId: b.tableId,
          openedById: a.staffId,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe("layer 2: row-level security (app_user, raw SQL, no restaurant filter)", () => {
  it("returns zero rows from every tenant table without a tenant context", async () => {
    for (const table of TENANT_TABLES) {
      const [row] = await db().$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${table}"`,
      );
      expect(row?.n, table).toBe(0);
    }
  });

  it("sees only its own restaurant's rows inside a tenant context", async () => {
    const rows = await withTenant(
      a.restaurantId,
      (tx) => tx.$queryRaw<{ restaurant_id: string }[]>`SELECT restaurant_id FROM orders`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.restaurant_id === a.restaurantId)).toBe(true);
  });

  it("cannot update or delete another restaurant's rows by id", async () => {
    const [updated, deleted] = await withTenant(a.restaurantId, async (tx) => [
      await tx.$executeRaw`UPDATE orders SET version = version + 1 WHERE id = ${b.orderId}::uuid`,
      await tx.$executeRaw`DELETE FROM order_lines WHERE id = ${b.lineId}::uuid`,
    ]);
    expect([updated, deleted]).toEqual([0, 0]);

    const order = await owner.order.findUniqueOrThrow({ where: { id: b.orderId } });
    expect(order.version).toBe(1);
    expect(await owner.orderLine.count({ where: { id: b.lineId } })).toBe(1);
  });

  it("cannot write a row that belongs to another restaurant", async () => {
    await expect(
      withTenant(
        a.restaurantId,
        (tx) => tx.$executeRaw`
          INSERT INTO menu_categories (id, restaurant_id, name)
          VALUES (gen_random_uuid(), ${b.restaurantId}::uuid, 'planted')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("fails closed on a malformed tenant context", async () => {
    await expect(
      db().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.restaurant_id', 'not-a-uuid', true)`;
        return tx.$queryRaw`SELECT count(*) FROM orders`;
      }),
    ).rejects.toThrow(/uuid/i);
  });

  it("transaction-local context does not survive on the pooled connection", async () => {
    // Single connection, so the second query provably reuses it.
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.restaurant_id', $1, true)", [a.restaurantId]);
      const inside = await client.query("SELECT count(*)::int AS n FROM orders");
      await client.query("COMMIT");
      const after = await client.query("SELECT count(*)::int AS n FROM orders");

      expect(inside.rows[0].n).toBeGreaterThan(0);
      expect(after.rows[0].n).toBe(0);
    } finally {
      await client.end();
    }
  });
});

describe("layer 3: withTenant() with Prisma (as routes use it)", () => {
  it("cannot read B's order, table or menu item by id", async () => {
    const found = await withTenant(a.restaurantId, async (tx) => [
      await tx.order.findUnique({ where: { id: b.orderId } }),
      await tx.diningTable.findUnique({ where: { id: b.tableId } }),
      await tx.menuItem.findUnique({ where: { id: b.menuItemId } }),
    ]);
    expect(found).toEqual([null, null, null]);
  });

  it("cannot update B's order by id", async () => {
    const result = await withTenant(a.restaurantId, (tx) =>
      tx.order.updateMany({ where: { id: b.orderId }, data: { discountReason: "x" } }),
    );
    expect(result.count).toBe(0);
  });

  it("cannot add B's menu item to A's order", async () => {
    await expect(
      withTenant(a.restaurantId, (tx, restaurantId) =>
        tx.orderLine.create({
          data: {
            restaurantId,
            orderId: a.orderId,
            menuItemId: b.menuItemId,
            nameSnapshot: "x",
            unitPriceSnapshotToman: 1,
            quantity: 1,
            createdById: a.staffId,
          },
        }),
      ),
    ).rejects.toThrow();
    expect(await owner.orderLine.count({ where: { menuItemId: b.menuItemId } })).toBe(1);
  });

  it("cannot add a line to B's order", async () => {
    await expect(
      withTenant(a.restaurantId, (tx) =>
        tx.orderLine.create({
          data: {
            restaurantId: b.restaurantId,
            orderId: b.orderId,
            menuItemId: b.menuItemId,
            nameSnapshot: "x",
            unitPriceSnapshotToman: 1,
            quantity: 1,
            createdById: b.staffId,
          },
        }),
      ),
    ).rejects.toThrow();
    expect(await owner.orderLine.count({ where: { orderId: b.orderId } })).toBe(1);
  });

  it("refuses to run without a valid restaurant id", async () => {
    for (const bad of ["", "undefined", "1 OR 1=1", "not-a-uuid"]) {
      await expect(withTenant(bad, async () => "ran")).rejects.toThrow(/invalid restaurant id/);
    }
  });
});
