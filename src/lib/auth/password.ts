import { randomBytes, scrypt as scryptCb, scryptSync, timingSafeEqual } from "node:crypto";

function scrypt(password: string, salt: Buffer, keyLength: number, options: { N: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

const KEY_LENGTH = 64;
const SCRYPT_COST = 16384; // N
const PREFIX = "scrypt";

/** Hashes a password as `scrypt$N$<salt>$<hash>` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_COST });
  return [PREFIX, SCRYPT_COST, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

/** Constant-time comparison of a password against a stored hash. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [prefix, costRaw, saltRaw, hashRaw] = stored.split("$");
  if (prefix !== PREFIX || !costRaw || !saltRaw || !hashRaw) return false;
  const cost = Number.parseInt(costRaw, 10);
  if (!Number.isFinite(cost) || cost <= 0) return false;
  const expected = Buffer.from(hashRaw, "base64url");
  const derived = await scrypt(password, Buffer.from(saltRaw, "base64url"), expected.length, { N: cost });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Synchronous variant for seeding and demo fixtures at module load. */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST });
  return [PREFIX, SCRYPT_COST, salt.toString("base64url"), derived.toString("base64url")].join("$");
}
