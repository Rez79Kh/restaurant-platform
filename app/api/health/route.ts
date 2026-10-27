import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";

// Liveness + database reachability, for the Docker healthcheck and uptime checks.
export const GET = route(async ({ log }) => {
  try {
    await db().$queryRaw`SELECT 1`;
  } catch (err) {
    log.error({ err }, "health check: database unreachable");
    throw new AppError(503, "DB_UNAVAILABLE", "پایگاه داده در دسترس نیست.");
  }
  return Response.json({ status: "ok" });
});
