// Demo data: two restaurants, a week of settled history, and a few live orders.
//
//   node prisma/seed.mts           create the demo restaurants if missing (idempotent)
//   node prisma/seed.mts --reset   delete and recreate them (only these two tenants)
//
// Runs as the owner (DIRECT_URL). Every write happens inside the restaurant's
// own tenant context, because on Neon the owner is not a superuser and FORCE
// ROW LEVEL SECURITY applies to it too. One transaction per restaurant: a
// failed seed leaves nothing half-written.
//
// Shapes are deterministic (fixed PRNG seed); timestamps are relative to now,
// so the history always covers the last week and live orders look live.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.ts";
import { calculateBill, type BillDiscount } from "../lib/bill.ts";
import { hashPin } from "../lib/pin.ts";
import {
  DEMO_RESTAURANTS,
  DISCOUNTS,
  VOID_REASONS,
  type RestaurantSpec,
} from "./seed-data.mts";

if (existsSync(".env")) process.loadEnvFile(".env");

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error("DIRECT_URL is required to seed.");
  process.exit(1);
}
// Must be the same PIN_PEPPER the app runs with, or the demo PINs won't verify.
const pinPepper = process.env.PIN_PEPPER ?? "";
if (pinPepper.length < 32) {
  console.error("PIN_PEPPER (at least 32 characters) is required to seed staff PINs.");
  process.exit(1);
}
const reset = process.argv.includes("--reset");
// Missing variables are filled from .env, so say where we're writing: a run
// meant for Neon that forgot DIRECT_URL would otherwise seed localhost.
const target = new URL(directUrl);
console.log(`Seeding ${target.host}${target.pathname}${reset ? " (--reset)" : ""}`);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl }) });

type Tx = Prisma.TransactionClient;
type LineStatus = "SENT" | "PREPARING" | "READY" | "SERVED" | "VOID";
type Method = "CARD_READER" | "CASH" | "CARD_TRANSFER";

// Randomness -----------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(1405);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
function weighted<T>(entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) if ((r -= w) < 0) return value;
  return entries[entries.length - 1]![0];
}

// Time (Asia/Tehran: UTC+03:30, no DST since 2022) -------------------------------

const TEHRAN_OFFSET_MS = 3.5 * 3_600_000;
const MINUTE = 60_000;
const now = Date.now();

function tehranMidnight(daysAgo: number): Date {
  const d = new Date(now + TEHRAN_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d; // a "wall clock" date: shift back by the offset to get the instant
}
const at = (daysAgo: number, hour: number, minute: number) =>
  new Date(tehranMidnight(daysAgo).getTime() + (hour * 60 + minute) * MINUTE - TEHRAN_OFFSET_MS);
const weekday = (daysAgo: number) => tehranMidnight(daysAgo).getUTCDay(); // 4 Thu, 5 Fri
const currentTehranHour = new Date(now + TEHRAN_OFFSET_MS).getUTCHours();
const plus = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MINUTE);

// Weekly rhythm: Thursday evening and Friday are the peaks.
const dayFactor = (wd: number) => (wd === 4 ? 1.5 : wd === 5 ? 1.7 : 1);
function hourWeight(spec: RestaurantSpec, wd: number, hour: number) {
  let w = spec.hourWeights[hour] ?? 0;
  if (wd === 4 && hour >= 17) w *= 2.2;
  if (wd === 5) w *= hour < 13 ? 2 : 1.6;
  return w;
}

// Building blocks ---------------------------------------------------------------

type MenuItemRef = { id: string; name: string; price: number; notes: string[] };
type Ids = {
  restaurantId: string;
  branchId: string;
  managerId: string;
  staffIds: string[];
  tableIds: Map<string, string>;
  categories: { weight: (hour: number) => number; items: MenuItemRef[] }[];
};

type Rows = {
  orders: Prisma.OrderCreateManyInput[];
  lines: Prisma.OrderLineCreateManyInput[];
  payments: Prisma.PaymentCreateManyInput[];
  audits: Prisma.AuditEventCreateManyInput[];
};

function chooseItems(ids: Ids, hour: number, count: number): MenuItemRef[] {
  const chosen = new Map<string, MenuItemRef>();
  for (let tries = 0; chosen.size < count && tries < 20; tries++) {
    const category = weighted(ids.categories.map((c) => [c, c.weight(hour)] as const));
    const item = pick(category.items);
    chosen.set(item.id, item);
  }
  return [...chosen.values()];
}

function newLine(
  ids: Ids,
  orderId: string,
  item: MenuItemRef,
  createdById: string,
  createdAt: Date,
  status: LineStatus,
  updatedAt: Date,
): Prisma.OrderLineCreateManyInput {
  return {
    id: randomUUID(),
    restaurantId: ids.restaurantId,
    orderId,
    menuItemId: item.id,
    nameSnapshot: item.name,
    unitPriceSnapshotToman: item.price,
    quantity: weighted([[1, 80], [2, 17], [3, 3]]),
    note: item.notes.length > 0 && chance(0.12) ? pick(item.notes) : null,
    status,
    createdById,
    createdAt,
    updatedAt,
  };
}

function splitPayments(total: number): { method: Method; amount: number }[] {
  const r = rand();
  if (r < 0.62) return [{ method: "CARD_READER", amount: total }];
  if (r < 0.77) return [{ method: "CARD_TRANSFER", amount: total }];
  if (r < 0.9) return [{ method: "CASH", amount: total }];

  if (chance(0.6) && total >= 200_000) {
    // Friends splitting the bill (دنگی): equal shares, the last one absorbs the remainder.
    const people = int(2, 4);
    const share = Math.floor(total / people / 1000) * 1000;
    const parts = Array.from({ length: people }, (_, i) => ({
      method: (i === people - 1 && chance(0.4) ? "CARD_TRANSFER" : "CARD_READER") as Method,
      amount: i === people - 1 ? total - share * (people - 1) : share,
    }));
    return parts;
  }
  // Part cash, the rest on the card reader.
  const cash = Math.floor(total / 2 / 50_000) * 50_000;
  if (cash <= 0) return [{ method: "CARD_READER", amount: total }];
  return [
    { method: "CASH", amount: cash },
    { method: "CARD_READER", amount: total - cash },
  ];
}

// History: settled orders ---------------------------------------------------------

function settledOrder(spec: RestaurantSpec, ids: Ids, rows: Rows, openedAt: Date, hour: number) {
  const orderId = randomUUID();
  const takeaway = chance(spec.takeawayShare);
  const openedById = chance(0.1) ? ids.managerId : pick(ids.staffIds);
  const settledById = pick(ids.staffIds);
  const settledAt = plus(openedAt, takeaway ? int(5, 15) : int(30, 95));

  const lines = chooseItems(ids, hour, weighted([[1, 20], [2, 40], [3, 25], [4, 15]])).map((item) => {
    const createdAt = plus(openedAt, int(0, 2));
    return newLine(ids, orderId, item, openedById, createdAt, "SERVED", plus(createdAt, int(8, 25)));
  });
  // A second round of items, sometimes from another waiter.
  if (!takeaway && chance(0.2)) {
    const createdAt = plus(openedAt, int(20, 30));
    for (const item of chooseItems(ids, hour, int(1, 2))) {
      lines.push(newLine(ids, orderId, item, pick(ids.staffIds), createdAt, "SERVED", plus(createdAt, int(5, 15))));
    }
  }
  for (const line of lines) {
    if ((line.updatedAt as Date) > settledAt) line.updatedAt = settledAt;
  }

  if (lines.length >= 2 && chance(0.04)) {
    const line = pick(lines);
    const voidedAt = plus(line.createdAt as Date, int(5, 12));
    const reason = pick(VOID_REASONS);
    Object.assign(line, { status: "VOID", voidedById: ids.managerId, voidReason: reason, updatedAt: voidedAt });
    rows.audits.push({
      restaurantId: ids.restaurantId,
      actorId: ids.managerId,
      action: "order_line.void",
      entity: "order_line",
      entityId: line.id,
      data: { orderId, reason, previousStatus: "PREPARING", item: line.nameSnapshot, quantity: line.quantity },
      createdAt: voidedAt,
    });
  }

  const lineInputs = lines.map((l) => ({
    unitPriceToman: l.unitPriceSnapshotToman,
    quantity: l.quantity,
    status: l.status as string,
  }));
  let discount: (typeof DISCOUNTS)[number] | null = chance(0.03) ? pick(DISCOUNTS) : null;
  if (discount?.type === "AMOUNT") {
    const subtotal = calculateBill({ lines: lineInputs, discount: null, serviceChargeBp: 0, vatRateBp: 0 }).subtotalToman;
    if (discount.value * 3 > subtotal) discount = null; // keep amount discounts plausible
  }
  const bill = calculateBill({
    lines: lineInputs,
    discount: discount as BillDiscount | null,
    serviceChargeBp: spec.serviceChargeBp,
    vatRateBp: spec.vatRateBp,
  });

  if (discount) {
    rows.audits.push({
      restaurantId: ids.restaurantId,
      actorId: ids.managerId,
      action: "order.discount",
      entity: "order",
      entityId: orderId,
      data: { type: discount.type, value: discount.value, reason: discount.reason, discountToman: bill.discountToman },
      createdAt: plus(settledAt, -5),
    });
  }

  const payments = splitPayments(bill.totalToman);
  for (const p of payments) {
    rows.payments.push({
      restaurantId: ids.restaurantId,
      orderId,
      method: p.method,
      amountToman: p.amount,
      recordedById: settledById,
      createdAt: plus(settledAt, -int(0, 2)),
    });
  }
  rows.audits.push({
    restaurantId: ids.restaurantId,
    actorId: settledById,
    action: "order.settle",
    entity: "order",
    entityId: orderId,
    data: { totalToman: bill.totalToman, payments },
    createdAt: settledAt,
  });

  rows.orders.push({
    id: orderId,
    restaurantId: ids.restaurantId,
    branchId: ids.branchId,
    tableId: takeaway ? null : pick([...ids.tableIds.values()]),
    status: "SETTLED",
    version: discount ? 3 : 2,
    discountType: discount?.type ?? null,
    discountValue: discount?.value ?? null,
    discountReason: discount?.reason ?? null,
    ...bill,
    openedById,
    settledById,
    openedAt,
    settledAt,
    updatedAt: settledAt,
  });
  rows.lines.push(...lines);
}

function history(spec: RestaurantSpec, ids: Ids, rows: Rows) {
  const hours = Object.keys(spec.hourWeights).map(Number);
  for (let daysAgo = spec.historyDays; daysAgo >= 0; daysAgo--) {
    const wd = weekday(daysAgo);
    const count = Math.round(spec.ordersPerDay * dayFactor(wd) * (0.85 + 0.3 * rand()));
    for (let i = 0; i < count; i++) {
      const hour = weighted(hours.map((h) => [h, hourWeight(spec, wd, h)] as const));
      const openedAt = at(daysAgo, hour, int(0, 59));
      // Today: only orders that would already be settled.
      if (openedAt.getTime() + 110 * MINUTE > now) continue;
      settledOrder(spec, ids, rows, openedAt, hour);
    }
  }
}

// Live orders: what the app shows right after login ---------------------------------

type LiveSpec = { table: string | null; minutesAgo: number; statuses: LineStatus[]; discount?: (typeof DISCOUNTS)[number] };

const LIVE: Record<string, LiveSpec[]> = {
  "cafe-narenj": [
    { table: "2", minutesAgo: 40, statuses: ["SERVED", "SERVED", "READY"] },
    { table: "5", minutesAgo: 12, statuses: ["PREPARING", "SENT", "SENT"] },
    { table: "7", minutesAgo: 30, statuses: ["SERVED", "SERVED", "PREPARING", "SENT"] },
    { table: "9", minutesAgo: 70, statuses: ["SERVED", "SERVED", "SERVED"], discount: DISCOUNTS[0] },
    { table: null, minutesAgo: 4, statuses: ["SENT", "SENT"] },
  ],
  kucheh: [{ table: "3", minutesAgo: 20, statuses: ["SERVED", "PREPARING", "SENT"] }],
};

function liveOrders(spec: RestaurantSpec, ids: Ids, rows: Rows) {
  for (const live of LIVE[spec.slug] ?? []) {
    const orderId = randomUUID();
    const openedAt = new Date(now - live.minutesAgo * MINUTE);
    const openedById = pick(ids.staffIds);
    const items = chooseItems(ids, currentTehranHour, live.statuses.length);
    live.statuses.forEach((status, i) => {
      const item = items[i % items.length]!;
      // SENT lines are recent; anything further along was ordered near opening.
      const createdAt = status === "SENT" ? new Date(now - int(1, 3) * MINUTE) : plus(openedAt, int(0, 3));
      const updatedAt = status === "SENT" ? createdAt : new Date(Math.min(now, plus(createdAt, int(4, 15)).getTime()));
      rows.lines.push(newLine(ids, orderId, item, openedById, createdAt, status, updatedAt));
    });
    if (live.discount) {
      rows.audits.push({
        restaurantId: ids.restaurantId,
        actorId: ids.managerId,
        action: "order.discount",
        entity: "order",
        entityId: orderId,
        data: { type: live.discount.type, value: live.discount.value, reason: live.discount.reason },
        createdAt: new Date(now - 5 * MINUTE),
      });
    }
    rows.orders.push({
      id: orderId,
      restaurantId: ids.restaurantId,
      branchId: ids.branchId,
      tableId: live.table ? ids.tableIds.get(live.table)! : null,
      status: "OPEN",
      version: live.discount ? 2 : 1,
      discountType: live.discount?.type ?? null,
      discountValue: live.discount?.value ?? null,
      discountReason: live.discount?.reason ?? null,
      openedById,
      openedAt,
      updatedAt: new Date(now - int(1, 5) * MINUTE),
    });
  }
}

// One restaurant ------------------------------------------------------------------------

async function inTenant<T>(restaurantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.restaurant_id', ${restaurantId}, true)`;
      return fn(tx);
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

async function deleteTenant(tx: Tx, restaurantId: string) {
  const where = { restaurantId };
  await tx.idempotencyRecord.deleteMany({ where });
  await tx.auditEvent.deleteMany({ where });
  await tx.payment.deleteMany({ where });
  await tx.orderLine.deleteMany({ where });
  await tx.order.deleteMany({ where });
  await tx.menuImportDraft.deleteMany({ where });
  await tx.session.deleteMany({ where });
  await tx.diningTable.deleteMany({ where });
  await tx.menuItem.deleteMany({ where });
  await tx.menuCategory.deleteMany({ where });
  await tx.staffMember.deleteMany({ where });
  await tx.branch.deleteMany({ where });
  await tx.restaurant.deleteMany({ where: { id: restaurantId } });
}

async function chunked<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
}

async function seedRestaurant(spec: RestaurantSpec) {
  rand = mulberry32(spec.slug.length * 1405); // same shape on every run, per restaurant
  const restaurantId = spec.id;

  const exists = await inTenant(restaurantId, (tx) => tx.restaurant.count({ where: { id: restaurantId } }));
  if (exists && !reset) {
    console.log(`= ${spec.name} (${spec.slug}) already seeded — skipped. Use --reset to recreate.`);
    return;
  }

  // Hash PINs before opening the transaction (scrypt is deliberately slow).
  const staff = await Promise.all(
    spec.staff.map(async (s) => ({ ...s, id: randomUUID(), pinHash: await hashPin(s.pin, pinPepper) })),
  );
  const branchId = randomUUID();
  const tableIds = new Map(spec.tables.map((t) => [t.label, randomUUID()]));
  const categories = spec.categories.map((c) => ({
    ...c,
    id: randomUUID(),
    refs: c.items.map((i) => ({ id: randomUUID(), name: i.name, price: i.price, notes: c.notes, available: i.available ?? true })),
  }));

  const ids: Ids = {
    restaurantId,
    branchId,
    managerId: staff.find((s) => s.role === "MANAGER")!.id,
    staffIds: staff.filter((s) => s.role === "STAFF").map((s) => s.id),
    tableIds,
    categories: categories.map((c) => ({ weight: c.weight, items: c.refs })),
  };
  const rows: Rows = { orders: [], lines: [], payments: [], audits: [] };
  history(spec, ids, rows);
  liveOrders(spec, ids, rows);

  // A couple of failed logins, as the audit log would show them.
  if (spec.slug === "cafe-narenj") {
    for (const daysAgo of [2, 1]) {
      const target = staff[2]!;
      rows.audits.push({
        restaurantId,
        actorId: null,
        action: "auth.login_failed",
        entity: "staff_member",
        entityId: target.id,
        data: { reason: "wrong_pin", phone: `${target.phone.slice(0, 4)}***${target.phone.slice(-4)}` },
        createdAt: at(daysAgo, 8, int(0, 30)),
      });
    }
  }

  await inTenant(restaurantId, async (tx) => {
    if (exists) await deleteTenant(tx, restaurantId);
    await tx.restaurant.create({
      data: {
        id: restaurantId,
        name: spec.name,
        slug: spec.slug,
        vatRateBp: spec.vatRateBp,
        serviceChargeBp: spec.serviceChargeBp,
        timezone: "Asia/Tehran",
      },
    });
    await tx.branch.create({ data: { id: branchId, restaurantId, name: spec.branchName } });
    await tx.staffMember.createMany({
      data: staff.map((s) => ({ id: s.id, restaurantId, branchId, name: s.name, phone: s.phone, pinHash: s.pinHash, role: s.role })),
    });
    await tx.menuCategory.createMany({
      data: categories.map((c, i) => ({ id: c.id, restaurantId, name: c.name, sortOrder: i })),
    });
    await tx.menuItem.createMany({
      data: categories.flatMap((c) =>
        c.refs.map((item, i) => ({
          id: item.id,
          restaurantId,
          categoryId: c.id,
          name: item.name,
          priceToman: item.price,
          isAvailable: item.available,
          sortOrder: i,
        })),
      ),
    });
    await tx.diningTable.createMany({
      data: spec.tables.map((t, i) => ({ id: tableIds.get(t.label)!, restaurantId, branchId, label: t.label, seats: t.seats, sortOrder: i })),
    });
    await chunked(rows.orders, (data) => tx.order.createMany({ data }));
    await chunked(rows.lines, (data) => tx.orderLine.createMany({ data }));
    await chunked(rows.payments, (data) => tx.payment.createMany({ data }));
    await chunked(rows.audits, (data) => tx.auditEvent.createMany({ data }));
  });

  const settled = rows.orders.filter((o) => o.status === "SETTLED").length;
  console.log(
    `${exists ? "↻" : "+"} ${spec.name} (${spec.slug}): ${staff.length} staff, ` +
      `${categories.reduce((n, c) => n + c.refs.length, 0)} menu items, ${spec.tables.length} tables, ` +
      `${settled} settled + ${rows.orders.length - settled} open orders, ${rows.lines.length} lines, ` +
      `${rows.payments.length} payments, ${rows.audits.length} audit events`,
  );
}

try {
  for (const spec of DEMO_RESTAURANTS) await seedRestaurant(spec);
} catch (err) {
  console.error("Seed failed; nothing was written for the restaurant in progress.", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
