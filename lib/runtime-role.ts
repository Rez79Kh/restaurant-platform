import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Fail closed at startup if the runtime connection could bypass Row-Level
 * Security: a superuser or a BYPASSRLS role ignores every policy, even with
 * FORCE. A misconfigured DATABASE_URL (the owner's instead of app_user's)
 * would otherwise switch tenant isolation off silently.
 *
 * Unreachable database: logged, not fatal (the health check reports it).
 */
export async function assertSafeRuntimeRole(client: PrismaClient = db()): Promise<void> {
  let row: { db_user: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
  try {
    [row] = await client.$queryRaw<typeof row[]>`
      SELECT current_user AS db_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  } catch (err) {
    logger.warn({ err }, "startup: could not verify the database role");
    return;
  }
  if (row && (row.rolsuper || row.rolbypassrls)) {
    logger.fatal({ db_user: row.db_user }, "startup: DATABASE_URL role bypasses row-level security; refusing to serve");
    throw new Error(`DATABASE_URL connects as "${row.db_user}", which bypasses row-level security. Use app_user.`);
  }
}
