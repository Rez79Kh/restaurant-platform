import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadEnv() {
  const { getEnv } = await import("./env");
  return getEnv();
}

describe("getEnv()", () => {
  it("fails fast naming the bad variable without echoing its value", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://secret-user:secret-pass@host/db");
    await expect(loadEnv()).rejects.toThrow(/DATABASE_URL/);
    await expect(loadEnv()).rejects.not.toThrow(/secret-pass/);
  });

  it("requires a PIN pepper of at least 32 characters", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
    vi.stubEnv("PIN_PEPPER", "too-short-secret");
    await expect(loadEnv()).rejects.toThrow(/PIN_PEPPER/);
    await expect(loadEnv()).rejects.not.toThrow(/too-short-secret/);
  });

  it("treats empty optional variables as unset", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
    vi.stubEnv("PIN_PEPPER", "x".repeat(32));
    vi.stubEnv("AI_BASE_URL", "");
    const env = await loadEnv();
    expect(env.AI_BASE_URL).toBeUndefined();
  });
});
