import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Locally the CLI reads .env; in Docker and on Vercel the variables come from
// the environment. loadEnvFile never overrides variables that are already set.
if (existsSync(".env")) process.loadEnvFile(".env");

// The Prisma CLI only runs migrations, so it uses the DIRECT (unpooled, owner)
// connection. The app's runtime connection (DATABASE_URL, pooled, app_user) is
// passed to the driver adapter in lib/db.ts and never used here.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
