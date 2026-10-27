import { defineConfig } from "vitest/config";
import {
  TEST_APP_DB_PASSWORD,
  TEST_DATABASE_URL,
  TEST_DIRECT_URL,
  TEST_PIN_PEPPER,
} from "./tests/integration/test-env.ts";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["lib/**/*.test.ts"],
        },
      },
      {
        // Needs the compose Postgres: docker compose up -d db
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // Files share one database; run them one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
          env: {
            DATABASE_URL: TEST_DATABASE_URL,
            DIRECT_URL: TEST_DIRECT_URL,
            APP_DB_PASSWORD: TEST_APP_DB_PASSWORD,
            PIN_PEPPER: TEST_PIN_PEPPER,
          },
        },
      },
    ],
  },
});
