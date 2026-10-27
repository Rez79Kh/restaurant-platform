// Sets the app_user password from APP_DB_PASSWORD, connecting as the owner
// (DIRECT_URL). Idempotent; run after migrations. Kept out of the migration so
// no password is ever committed.
//
//   node scripts/set-app-db-password.mts
import { existsSync } from "node:fs";
import pg from "pg";

if (existsSync(".env")) process.loadEnvFile(".env");

const directUrl = process.env.DIRECT_URL;
const password = process.env.APP_DB_PASSWORD;

if (!password) {
  console.log("APP_DB_PASSWORD not set; leaving the app_user password unchanged.");
  process.exit(0);
}
if (!directUrl) {
  console.error("DIRECT_URL is required to set the app_user password.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: directUrl });
await client.connect();
try {
  // Utility statements can't take bind parameters; escapeLiteral quotes safely.
  await client.query(`ALTER ROLE app_user WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
  console.log("app_user password set.");
} finally {
  await client.end();
}
