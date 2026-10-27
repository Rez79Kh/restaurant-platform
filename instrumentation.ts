// Runs once when a server instance starts: fail fast on bad configuration
// instead of on the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./lib/env");
    getEnv();
    const { assertSafeRuntimeRole } = await import("./lib/runtime-role");
    await assertSafeRuntimeRole();
  }
}
