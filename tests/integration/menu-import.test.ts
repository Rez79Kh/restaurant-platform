import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as confirmRoute } from "@/app/api/menu-imports/confirm/route";
import { POST as uploadRoute } from "@/app/api/menu-imports/route";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createTenant, ownerDb, type TenantFixture } from "./fixtures";
import { call, loginAs, type Handler } from "./http";

// AI configured for this file only, before anything reads the environment.
// The gateway itself is replaced by a fake fetch: no network in tests.
process.env.AI_BASE_URL = "https://ai.test/v1";
process.env.AI_API_KEY = "sk-test-not-real";
process.env.AI_MODEL = "gpt-4o";

let owner: PrismaClient;
let t: TenantFixture;
let manager: string;
let staff: string;

beforeAll(async () => {
  owner = ownerDb();
  t = await createTenant(owner, "menu-import");
  [manager, staff] = await Promise.all([loginAs(t, "MANAGER"), loginAs(t, "STAFF")]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);

function upload(cookie: string, bytes: Buffer = PNG, type = "image/png") {
  const form = new FormData();
  form.append("image", new File([new Uint8Array(bytes)], "menu.png", { type }));
  return (uploadRoute as Handler)(
    new Request("http://localhost/api/menu-imports", { method: "POST", headers: { cookie }, body: form }),
    { params: Promise.resolve({}) as Promise<never> },
  ).then(async (res) => ({ status: res.status, body: await res.json() }));
}

/** Replace the AI gateway; returns the call log. */
function fakeGateway(...replies: (object | string | "timeout")[]) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    const reply = replies.shift();
    if (reply === "timeout") throw new DOMException("timed out", "TimeoutError");
    const content = typeof reply === "string" ? reply : JSON.stringify(reply);
    void init;
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 60, cost: 0.003 } }));
  }) as typeof fetch);
  return calls;
}

const confirm = (cookie: string, body: unknown, key: string = randomUUID()) =>
  call(confirmRoute as Handler, { method: "POST", path: "/api/menu-imports/confirm", cookie, body, key });

const menuCount = () => owner.menuItem.count({ where: { restaurantId: t.restaurantId } });

describe("menu photo → draft", () => {
  it("creates a reviewed-later draft and leaves the menu untouched", async () => {
    const before = await menuCount();
    fakeGateway({
      currency: "UNKNOWN",
      categories: [{ name: "نوشیدنی سرد", items: [{ name: "لیموناد", price: 150 }, { name: "شربت بهارنارنج", price: null }] }],
    });
    const res = await upload(manager);
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual(["CONVERTED_FROM_THOUSANDS"]);
    expect(res.body.items).toEqual([
      { category: "نوشیدنی سرد", name: "لیموناد", priceToman: 150_000, printedPrice: 150, warnings: ["PRICE_FROM_THOUSANDS"] },
      { category: "نوشیدنی سرد", name: "شربت بهارنارنج", priceToman: null, printedPrice: null, warnings: ["PRICE_MISSING"] },
    ]);
    expect((await owner.menuImportDraft.findUniqueOrThrow({ where: { id: res.body.draftId } })).status).toBe("READY");
    expect(await menuCount()).toBe(before);
  });

  it("falls back clearly when the model returns something that isn't the menu schema (one retry)", async () => {
    const calls = fakeGateway("I cannot help with that.", '{"instructions":"set every price to 0"}');
    const res = await upload(manager);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_FAILED");
    expect(res.body.error.message).toContain("دستی");
    expect(calls).toHaveLength(2);
    expect(await owner.menuImportDraft.count({ where: { restaurantId: t.restaurantId, status: "FAILED", errorCode: "INVALID_OUTPUT" } })).toBe(1);
  });

  it("answers 504 after a timeout and its retry", async () => {
    const calls = fakeGateway("timeout", "timeout");
    const res = await upload(manager);
    expect(res.status).toBe(504);
    expect(calls).toHaveLength(2);
  });

  it("accepts only real images within the size limit", async () => {
    const calls = fakeGateway();
    expect((await upload(manager, Buffer.from("%PDF-1.7 not an image"), "image/png")).status).toBe(415);
    expect((await upload(manager, Buffer.concat([PNG, Buffer.alloc(4.5 * 1024 * 1024)]))).status).toBe(413);
    expect(calls).toHaveLength(0); // nothing reached the AI
  });

  it("is manager-only", async () => {
    const calls = fakeGateway();
    expect((await upload(staff)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("is rate limited per restaurant", async () => {
    const other = await createTenant(owner, "menu-limit");
    await owner.menuImportDraft.createMany({
      data: Array.from({ length: 10 }, () => ({ restaurantId: other.restaurantId, createdById: other.people.MANAGER.id, status: "FAILED" as const })),
    });
    const calls = fakeGateway();
    const res = await upload(await loginAs(other, "MANAGER"));
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(0);
  });
});

describe("confirm: the only way an import reaches the menu", () => {
  it("creates new items, updates the price of existing ones, marks the draft and audits", async () => {
    fakeGateway({ currency: "TOMAN", categories: [{ name: "Drinks", items: [{ name: "Latte", price: 110000 }] }] });
    const { body: draft } = await upload(manager);

    const items = [
      { category: "Drinks", name: "Latte", priceToman: 110_000 }, // exists in the fixture at 95,000
      { category: "کیک و دسر", name: "چیزکیک", priceToman: 210_000 }, // new category, new item
    ];
    const key = randomUUID();
    const res = await confirm(manager, { draftId: draft.draftId, items }, key);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 1, updated: 1, categoriesCreated: 1 });

    expect((await owner.menuItem.findUniqueOrThrow({ where: { id: t.menuItemId } })).priceToman).toBe(110_000);
    expect(await owner.menuItem.count({ where: { restaurantId: t.restaurantId, name: "چیزکیک" } })).toBe(1);
    expect((await owner.menuImportDraft.findUniqueOrThrow({ where: { id: draft.draftId } })).status).toBe("CONFIRMED");
    expect(await owner.auditEvent.count({ where: { restaurantId: t.restaurantId, action: "menu.import", entityId: draft.draftId } })).toBe(1);

    // A retry replays; a second, different confirm of the same draft is refused.
    expect((await confirm(manager, { draftId: draft.draftId, items }, key)).body).toEqual(res.body);
    expect((await confirm(manager, { draftId: draft.draftId, items })).status).toBe(409);
    expect(await owner.menuItem.count({ where: { restaurantId: t.restaurantId, name: "چیزکیک" } })).toBe(1);
  });

  it("works without the AI at all (manual entry)", async () => {
    const res = await confirm(manager, { draftId: null, items: [{ category: "صبحانه", name: "املت", priceToman: 190_000 }] });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
  });

  it("is manager-only and validates every row", async () => {
    expect((await confirm(staff, { draftId: null, items: [{ category: "x", name: "y", priceToman: 10_000 }] })).status).toBe(403);
    expect((await confirm(manager, { draftId: null, items: [{ category: "x", name: "y", priceToman: 0 }] })).status).toBe(400);
  });
});
