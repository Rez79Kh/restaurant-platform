-- Runs once, when the compose volume is first created.
--
-- Migrations run as `migrator`, not as the `postgres` superuser, to match
-- production: Neon's database owner is NOT a superuser, and superusers skip
-- permission checks (a migration that only works as superuser once reached
-- Neon this way). Like Neon's owner: owns the databases, can create roles and
-- databases (Prisma's shadow DB), no superuser, no BYPASSRLS.
-- `postgres` stays a superuser for test fixtures that must write across tenants.
CREATE ROLE migrator LOGIN PASSWORD 'migrator_local'
  NOSUPERUSER CREATEDB CREATEROLE NOBYPASSRLS;
ALTER DATABASE restaurant OWNER TO migrator;

-- Integration tests use their own database so they never touch dev data.
CREATE DATABASE restaurant_test OWNER migrator;
