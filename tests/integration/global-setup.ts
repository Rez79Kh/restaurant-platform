import { execSync } from "node:child_process";
import pg from "pg";
import { TEST_APP_DB_PASSWORD, TEST_DIRECT_URL, TEST_SUPERUSER_URL } from "./test-env";

// Brings restaurant_test to the latest migration and empties it, once per run.
export default async function setup() {
  const env = {
    ...process.env,
    DIRECT_URL: TEST_DIRECT_URL,
    APP_DB_PASSWORD: TEST_APP_DB_PASSWORD,
  };
  try {
    execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
    execSync("node scripts/set-app-db-password.mts", { env, stdio: "pipe" });
  } catch (err) {
    const output = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    throw new Error(
      `Integration test setup failed. Is Postgres running? (docker compose up -d db)\n` +
        `If role "migrator" does not exist, the volume predates it: docker compose down -v\n${output}`,
    );
  }

  const client = new pg.Client({ connectionString: TEST_SUPERUSER_URL });
  await client.connect();
  try {
    await client.query("TRUNCATE restaurants, login_attempts CASCADE");
  } finally {
    await client.end();
  }
}
