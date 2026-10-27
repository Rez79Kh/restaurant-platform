import { z } from "zod";

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

// `KEY=""` in a .env file means "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Runtime connection. Production: Neon pooled URL as app_user (see NOTES.md).
  DATABASE_URL: postgresUrl,
  // HMAC key applied to PINs before scrypt (lib/pin.ts). Never stored in the
  // database. Must match the value the seed ran with, or demo logins fail.
  PIN_PEPPER: z.string().min(32, "must be at least 32 characters (openssl rand -base64 32)"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Menu import (Phase 10). Optional: the AI is never needed to run a shift,
  // so a missing key disables the import, not the app.
  AI_BASE_URL: optional(z.url()),
  AI_API_KEY: optional(z.string()),
  AI_MODEL: optional(z.string()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parsed, validated environment. Lazy so that `next build` (which has no
 * runtime secrets) does not need it; instrumentation.ts calls it once at
 * server start so a bad config fails before the first request.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Names and reasons only — never echo values, they may be secrets.
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = result.data;
  return cached;
}
