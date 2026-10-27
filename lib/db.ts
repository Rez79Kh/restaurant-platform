import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

// Reused across hot reloads in dev so we don't open a new pool per edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The runtime Prisma client (DATABASE_URL: pooled, app_user in production).
 *
 * Lazy so that importing a route module during `next build` needs no database.
 * Tenant data must go through withTenant() (Phase 3), never through this
 * client directly.
 */
export function db(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}
