import pino from "pino";

/**
 * Structured JSON logs to stdout (Vercel and Docker collect stdout).
 *
 * Redaction is a safety net, not the policy: call sites must not pass PINs,
 * session tokens, full phone numbers or API keys in the first place. Use
 * maskPhone() when a phone number genuinely helps debugging.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "restaurant-platform" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      "pin",
      "*.pin",
      "token",
      "*.token",
      "sessionToken",
      "*.sessionToken",
      "phone",
      "*.phone",
      "apiKey",
      "*.apiKey",
      "password",
      "*.password",
      "headers.cookie",
      "headers.authorization",
    ],
    censor: "[REDACTED]",
  },
});

export type Logger = pino.Logger;

/** 09123456789 → 0912***6789 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}
