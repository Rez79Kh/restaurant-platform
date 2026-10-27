// Connection settings for integration tests: a separate database
// (restaurant_test) on the compose Postgres, so tests never touch dev data.
// Override with TEST_DATABASE_URL / TEST_DIRECT_URL (e.g. in CI).
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://app_user:app_user_local@localhost:5433/restaurant_test";

// Migrations run as the non-superuser owner, like Neon's, so a migration that
// needs superuser powers fails here instead of in production.
export const TEST_DIRECT_URL =
  process.env.TEST_DIRECT_URL ?? "postgresql://migrator:migrator_local@localhost:5433/restaurant_test";

// Superuser, for arranging fixtures across tenants (RLS does not apply).
export const TEST_SUPERUSER_URL =
  process.env.TEST_SUPERUSER_URL ?? "postgresql://postgres:postgres@localhost:5433/restaurant_test";

export const TEST_APP_DB_PASSWORD = process.env.TEST_APP_DB_PASSWORD ?? "app_user_local";

export const TEST_PIN_PEPPER =
  process.env.TEST_PIN_PEPPER ?? "test-pin-pepper-0123456789abcdef0123456789";
