import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { conflict, notFound } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { parseBody } from "@/lib/http/validate";
import { idempotencyKey, idempotent, idempotentResponse } from "@/lib/idempotency";
import { withTenant } from "@/lib/tenant";

const Body = z.object({
  // The reviewed draft, or null for items typed in by hand (no AI involved).
  draftId: z.uuid().nullable(),
  items: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(60),
        name: z.string().trim().min(1).max(80),
        priceToman: z.number().int().min(1_000).max(100_000_000),
      }),
    )
    .min(1)
    .max(300),
});

// The only path from an import to the menu: the manager's reviewed rows.
// Existing items (same category + name) get the new price, which is the
// common case with high inflation; everything else is created. The draft is
// marked CONFIRMED with exactly what was saved, and the import is audited.
export const POST = route(async ({ req, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER");
  const key = idempotencyKey(req);
  const body = await parseBody(req, Body);
  const { draftId } = body;
  // The same row twice (category + name): the last one wins.
  const items = [...new Map(body.items.map((i) => [`${i.category}|${i.name}`, i])).values()];

  const result = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    idempotent(tx, restaurantId, key, "POST /api/menu-imports/confirm", async () => {
      if (draftId) {
        const [draft] = await tx.$queryRaw<{ status: string }[]>`
          SELECT status FROM menu_import_drafts
          WHERE restaurant_id = ${restaurantId}::uuid AND id = ${draftId}::uuid
          FOR UPDATE`;
        if (!draft) throw notFound("پیش‌نویس پیدا نشد.");
        if (draft.status !== "READY") throw conflict("این پیش‌نویس قبلاً ثبت یا کنار گذاشته شده است.", { status: draft.status });
      }

      const names = [...new Set(items.map((i) => i.category))];
      const existing = await tx.menuCategory.findMany({ where: { restaurantId, name: { in: names } } });
      const categoryId = new Map(existing.map((c) => [c.name, c.id]));
      const last = await tx.menuCategory.aggregate({ where: { restaurantId }, _max: { sortOrder: true } });
      const newCategories = names
        .filter((n) => !categoryId.has(n))
        .map((name, i) => ({ id: randomUUID(), restaurantId, name, sortOrder: (last._max.sortOrder ?? 0) + i + 1 }));
      await tx.menuCategory.createMany({ data: newCategories });
      for (const c of newCategories) categoryId.set(c.name, c.id);

      const current = await tx.menuItem.findMany({
        where: { restaurantId, categoryId: { in: [...categoryId.values()] } },
        select: { id: true, categoryId: true, name: true, priceToman: true },
      });
      const byKey = new Map(current.map((m) => [`${m.categoryId}|${m.name}`, m]));
      const toCreate = [];
      let updated = 0;
      for (const item of items) {
        const catId = categoryId.get(item.category)!;
        const match = byKey.get(`${catId}|${item.name}`);
        if (match) {
          await tx.menuItem.update({ where: { id: match.id }, data: { priceToman: item.priceToman, isAvailable: true } });
          updated++;
        } else {
          toCreate.push({ id: randomUUID(), restaurantId, categoryId: catId, name: item.name, priceToman: item.priceToman });
        }
      }
      await tx.menuItem.createMany({ data: toCreate });

      if (draftId) {
        await tx.menuImportDraft.update({ where: { id: draftId }, data: { status: "CONFIRMED", items } });
      }
      const summary = { created: toCreate.length, updated, categoriesCreated: newCategories.length };
      await tx.auditEvent.create({
        data: {
          restaurantId,
          actorId: auth.staffId,
          action: "menu.import",
          entity: "menu_import_draft",
          entityId: draftId,
          data: { source: draftId ? "photo" : "manual", ...summary },
        },
      });
      log.info({ draft_id: draftId, ...summary }, "menu import confirmed");
      return { status: 200, body: summary };
    }),
  );
  return idempotentResponse(result);
});
