-- Integrity rules that Prisma's schema language cannot express.
-- The database refuses impossible states even if application code has a bug.

-- Rates, money and quantities -------------------------------------------------

ALTER TABLE "restaurants"
  ADD CONSTRAINT "restaurants_vat_rate_bp_check" CHECK ("vat_rate_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "restaurants_service_charge_bp_check" CHECK ("service_charge_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "restaurants_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_price_toman_check" CHECK ("price_toman" > 0);

ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_seats_check" CHECK ("seats" > 0);

ALTER TABLE "order_lines"
  ADD CONSTRAINT "order_lines_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_lines_unit_price_check" CHECK ("unit_price_snapshot_toman" >= 0),
  -- A voided line always records who voided it (the audit event records why).
  ADD CONSTRAINT "order_lines_void_check" CHECK ("status" <> 'VOID' OR "voided_by_id" IS NOT NULL);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_toman_check" CHECK ("amount_toman" > 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_version_check" CHECK ("version" >= 1),
  -- Discount: type and value together, a reason always, percent at most 100%.
  ADD CONSTRAINT "orders_discount_check" CHECK (
    ("discount_type" IS NULL AND "discount_value" IS NULL)
    OR (
      "discount_type" IS NOT NULL
      AND "discount_value" > 0
      AND ("discount_type" <> 'PERCENT' OR "discount_value" <= 10000)
      AND length(btrim(coalesce("discount_reason", ''))) > 0
    )
  ),
  -- A settled order always carries its totals snapshot and who settled it.
  ADD CONSTRAINT "orders_settled_check" CHECK (
    "status" <> 'SETTLED'
    OR (
      "subtotal_toman" IS NOT NULL AND "discount_toman" IS NOT NULL
      AND "service_charge_toman" IS NOT NULL AND "vat_toman" IS NOT NULL
      AND "total_toman" IS NOT NULL
      AND "settled_at" IS NOT NULL AND "settled_by_id" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "orders_totals_check" CHECK (
    coalesce("subtotal_toman", 0) >= 0 AND coalesce("discount_toman", 0) >= 0
    AND coalesce("service_charge_toman", 0) >= 0 AND coalesce("vat_toman", 0) >= 0
    AND coalesce("total_toman", 0) >= 0
  );

-- One open check per table ----------------------------------------------------
-- Two waiters opening the same table at the same moment: exactly one INSERT
-- succeeds, the other gets a unique violation (→ 409 with the existing order).

CREATE UNIQUE INDEX "orders_one_open_per_table"
  ON "orders" ("restaurant_id", "table_id")
  WHERE "status" = 'OPEN' AND "table_id" IS NOT NULL;

-- updated_at maintained by the database --------------------------------------
-- The "changes since" polling endpoint relies on updated_at, and status
-- changes are raw conditional UPDATEs, so this cannot depend on the ORM.
-- Known limit: a transaction can commit after a later one with an earlier
-- timestamp; the polling endpoint must use an overlap window (Phase 6).

CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" := clock_timestamp();
  RETURN NEW;
END
$$;

CREATE TRIGGER "orders_set_updated_at" BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "order_lines_set_updated_at" BEFORE UPDATE ON "order_lines"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "menu_items_set_updated_at" BEFORE UPDATE ON "menu_items"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
CREATE TRIGGER "menu_import_drafts_set_updated_at" BEFORE UPDATE ON "menu_import_drafts"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
