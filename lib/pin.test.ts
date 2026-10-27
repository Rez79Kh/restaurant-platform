import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./pin";

const PEPPER = "test-pepper-0123456789abcdef0123456789";

describe("PIN hashing", () => {
  it("verifies the right PIN and rejects a wrong one", async () => {
    const stored = await hashPin("4821", PEPPER);
    expect(stored).toMatch(/^scrypt-hmac\$32768\$8\$1\$/);
    expect(stored).not.toContain("4821");
    expect(await verifyPin("4821", stored, PEPPER)).toBe(true);
    expect(await verifyPin("4822", stored, PEPPER)).toBe(false);
  });

  it("rejects the right PIN under a different pepper (a leaked hash alone is not enough)", async () => {
    const stored = await hashPin("4821", PEPPER);
    expect(await verifyPin("4821", stored, "another-pepper-0123456789abcdef0123")).toBe(false);
  });

  it("refuses to hash or verify without a pepper", async () => {
    await expect(hashPin("4821", "")).rejects.toThrow(/pepper/);
    await expect(verifyPin("4821", "scrypt-hmac$32768$8$1$a$b", "")).rejects.toThrow(/pepper/);
  });

  it("salts every hash", async () => {
    expect(await hashPin("123456", PEPPER)).not.toBe(await hashPin("123456", PEPPER));
  });

  it("refuses to hash a PIN that is not 4–6 digits", async () => {
    for (const bad of ["123", "1234567", "12a4", ""]) {
      await expect(hashPin(bad, PEPPER)).rejects.toThrow();
    }
  });

  it("treats a malformed or unpeppered stored hash as a failed match", async () => {
    for (const bad of ["", "plain-text", "scrypt-hmac$x$8$1$abc$def", "scrypt$32768$8$1$abc$def"]) {
      expect(await verifyPin("1234", bad, PEPPER)).toBe(false);
    }
  });
});
