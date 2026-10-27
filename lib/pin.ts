import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

// PIN hashing: HMAC-SHA256 with a server-side pepper, then scrypt.
//
// Why the pepper: a 4–6 digit PIN has at most 1,000,000 values, so scrypt
// alone falls to an offline brute force in minutes once the database leaks
// (backup, dump, SQL injection). The pepper (PIN_PEPPER) lives only in the
// app's environment, never in the database, so a leaked pin_hash column is
// useless without it. Online guessing is handled by the login rate limit.
//
// Stored format: scrypt-hmac$N$r$p$<salt base64>$<hash base64>. Parameters
// travel with the hash so they can be raised later. Changing PIN_PEPPER
// invalidates every stored PIN (staff must be given new PINs).
//
// Imports only node: modules so plain Node scripts (the seed) can use it; the
// caller passes the pepper (getEnv().PIN_PEPPER in the app).

const SCHEME = "scrypt-hmac";
const N = 2 ** 15; // 32 MiB per hash (128 * N * r bytes)
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

export const PIN_PATTERN = /^\d{4,6}$/;

function pepper(pin: string, key: string): Buffer {
  // Fail closed: an empty pepper would silently degrade to plain scrypt.
  if (!key) throw new Error("PIN pepper is not configured");
  return createHmac("sha256", key).update(pin).digest();
}

function derive(input: Buffer, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(input, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPin(pin: string, pinPepper: string): Promise<string> {
  if (!PIN_PATTERN.test(pin)) throw new Error("PIN must be 4–6 digits");
  const salt = randomBytes(16);
  const key = await derive(pepper(pin, pinPepper), salt, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return `${SCHEME}$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Constant-time comparison. A malformed stored hash verifies as false, never throws. */
export async function verifyPin(pin: string, stored: string, pinPepper: string): Promise<boolean> {
  const peppered = pepper(pin, pinPepper);
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (!n || !r || !p) return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (expected.length === 0) return false;

  const actual = await derive(peppered, salt, { N: n, r, p, maxmem: MAX_MEMORY });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
