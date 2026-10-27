-- Tenant isolation, layer 2: Postgres Row-Level Security.
--
-- The app connects as app_user: not a superuser, not the table owner, no
-- BYPASSRLS. Superusers ignore RLS even with FORCE, which is why the runtime
-- must never use the owner/superuser connection. Migrations run as the owner.
--
-- Every statement is idempotent: the role is cluster-wide (shared by the dev,
-- test and Prisma shadow databases), and the file is safe to run twice.

-- Runtime role ----------------------------------------------------------------
-- No password here: it is set out of band (scripts/set-app-db-password.mts
-- locally, the Neon console or the same script in production).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
-- Tables created by later migrations get the same grants. They do NOT get RLS
-- automatically: tests/integration/isolation.test.ts fails if any table with
-- a restaurant_id column lacks ENABLE + FORCE ROW LEVEL SECURITY.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- Conditional: Prisma's shadow database replays migrations without this table.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM app_user;
  END IF;
END
$$;
-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE ON "audit_events" FROM app_user;

-- Tenant context ----------------------------------------------------------------
-- withTenant() sets app.restaurant_id with set_config(..., true), i.e.
-- transaction-local, so it cannot leak to another request through the pooler.
-- Unset or empty → NULL → every policy comparison is false → zero rows.
-- A malformed value fails the uuid cast → the query errors. Fail closed.

CREATE OR REPLACE FUNCTION app_current_restaurant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.restaurant_id', true), '')::uuid
$$;

ALTER TABLE "restaurants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "restaurants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "restaurants";
CREATE POLICY tenant_isolation ON "restaurants"
  USING ("id" = app_current_restaurant_id())
  WITH CHECK ("id" = app_current_restaurant_id());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'staff_members', 'sessions', 'menu_categories', 'menu_items',
    'dining_tables', 'orders', 'order_lines', 'payments', 'audit_events',
    'menu_import_drafts', 'idempotency_records'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (restaurant_id = app_current_restaurant_id())
         WITH CHECK (restaurant_id = app_current_restaurant_id())',
      t
    );
  END LOOP;
END
$$;

-- login_attempts is deliberately not tenant-owned (see schema.prisma) and has
-- no RLS: it holds no tenant data and must be readable before a tenant is known.
