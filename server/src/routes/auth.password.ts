import crypto from 'node:crypto';

const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;

export function isPasswordHash(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${HASH_PREFIX}$`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derivedKey = await scrypt(password, salt);
  return `${HASH_PREFIX}$${salt}$${derivedKey.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedPassword: string): Promise<boolean> {
  if (!isPasswordHash(storedPassword)) {
    return storedPassword === password;
  }

  const [, salt, hash] = storedPassword.split('$');
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, salt);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
