-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('MANAGER', 'STAFF', 'KITCHEN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "OrderLineStatus" AS ENUM ('SENT', 'PREPARING', 'READY', 'SERVED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD_READER', 'CASH', 'CARD_TRANSFER');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('AMOUNT', 'PERCENT');

-- CreateEnum
CREATE TYPE "MenuImportStatus" AS ENUM ('READY', 'FAILED', 'CONFIRMED', 'DISCARDED');

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "vat_rate_bp" INTEGER NOT NULL DEFAULT 1000,
    "service_charge_bp" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "staff_member_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_toman" INTEGER NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "table_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "discount_type" "DiscountType",
    "discount_value" INTEGER,
    "discount_reason" TEXT,
    "subtotal_toman" INTEGER,
    "discount_toman" INTEGER,
    "service_charge_toman" INTEGER,
    "vat_toman" INTEGER,
    "total_toman" INTEGER,
    "opened_by_id" UUID NOT NULL,
    "settled_by_id" UUID,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "unit_price_snapshot_toman" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "status" "OrderLineStatus" NOT NULL DEFAULT 'SENT',
    "created_by_id" UUID NOT NULL,
    "void_reason" TEXT,
    "voided_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_toman" INTEGER NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "ip" TEXT NOT NULL,
    "restaurant_slug" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_import_drafts" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "status" "MenuImportStatus" NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_import_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_slug_key" ON "restaurants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "branches_restaurant_id_id_key" ON "branches"("restaurant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_restaurant_id_id_key" ON "staff_members"("restaurant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_restaurant_id_phone_key" ON "staff_members"("restaurant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_restaurant_id_staff_member_id_idx" ON "sessions"("restaurant_id", "staff_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_restaurant_id_id_key" ON "menu_categories"("restaurant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_restaurant_id_name_key" ON "menu_categories"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "menu_items_restaurant_id_category_id_idx" ON "menu_items"("restaurant_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_restaurant_id_id_key" ON "menu_items"("restaurant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_restaurant_id_id_key" ON "dining_tables"("restaurant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_restaurant_id_branch_id_label_key" ON "dining_tables"("restaurant_id", "branch_id", "label");

-- CreateIndex
CREATE INDEX "orders_restaurant_id_branch_id_status_idx" ON "orders"("restaurant_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "orders_restaurant_id_branch_id_updated_at_idx" ON "orders"("restaurant_id", "branch_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_restaurant_id_id_key" ON "orders"("restaurant_id", "id");

-- CreateIndex
CREATE INDEX "order_lines_restaurant_id_order_id_idx" ON "order_lines"("restaurant_id", "order_id");

-- CreateIndex
CREATE INDEX "order_lines_restaurant_id_status_idx" ON "order_lines"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "order_lines_restaurant_id_updated_at_idx" ON "order_lines"("restaurant_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_restaurant_id_id_key" ON "order_lines"("restaurant_id", "id");

-- CreateIndex
CREATE INDEX "payments_restaurant_id_order_id_idx" ON "payments"("restaurant_id", "order_id");

-- CreateIndex
CREATE INDEX "audit_events_restaurant_id_created_at_idx" ON "audit_events"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_restaurant_id_entity_entity_id_idx" ON "audit_events"("restaurant_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_restaurant_slug_phone_hash_created_at_idx" ON "login_attempts"("restaurant_slug", "phone_hash", "created_at");

-- CreateIndex
CREATE INDEX "menu_import_drafts_restaurant_id_created_at_idx" ON "menu_import_drafts"("restaurant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_restaurant_id_key_key" ON "idempotency_records"("restaurant_id", "key");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_restaurant_id_branch_id_fkey" FOREIGN KEY ("restaurant_id", "branch_id") REFERENCES "branches"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_restaurant_id_staff_member_id_fkey" FOREIGN KEY ("restaurant_id", "staff_member_id") REFERENCES "staff_members"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_category_id_fkey" FOREIGN KEY ("restaurant_id", "category_id") REFERENCES "menu_categories"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_restaurant_id_branch_id_fkey" FOREIGN KEY ("restaurant_id", "branch_id") REFERENCES "branches"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_branch_id_fkey" FOREIGN KEY ("restaurant_id", "branch_id") REFERENCES "branches"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_table_id_fkey" FOREIGN KEY ("restaurant_id", "table_id") REFERENCES "dining_tables"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_opened_by_id_fkey" FOREIGN KEY ("restaurant_id", "opened_by_id") REFERENCES "staff_members"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_settled_by_id_fkey" FOREIGN KEY ("restaurant_id", "settled_by_id") REFERENCES "staff_members"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_restaurant_id_order_id_fkey" FOREIGN KEY ("restaurant_id", "order_id") REFERENCES "orders"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_restaurant_id_menu_item_id_fkey" FOREIGN KEY ("restaurant_id", "menu_item_id") REFERENCES "menu_items"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_restaurant_id_created_by_id_fkey" FOREIGN KEY ("restaurant_id", "created_by_id") REFERENCES "staff_members"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_restaurant_id_voided_by_id_fkey" FOREIGN KEY ("restaurant_id", "voided_by_id") REFERENCES "staff_members"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurant_id_order_id_fkey" FOREIGN KEY ("restaurant_id", "order_id") REFERENCES "orders"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurant_id_recorded_by_id_fkey" FOREIGN KEY ("restaurant_id", "recorded_by_id") REFERENCES "staff_members"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_restaurant_id_actor_id_fkey" FOREIGN KEY ("restaurant_id", "actor_id") REFERENCES "staff_members"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_import_drafts" ADD CONSTRAINT "menu_import_drafts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_import_drafts" ADD CONSTRAINT "menu_import_drafts_restaurant_id_created_by_id_fkey" FOREIGN KEY ("restaurant_id", "created_by_id") REFERENCES "staff_members"("restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
