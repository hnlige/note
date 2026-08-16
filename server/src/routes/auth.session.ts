import crypto from 'node:crypto';

export interface AuthSessionUser {
  id: string;
  username: string;
  name: string;
  role: string;
  roleId?: string | null;
  roleIds?: string[] | null;
  deptId?: string | null;
  orgId?: string | null;
  sessionVersion?: number;
}

interface AuthTokenPayload extends AuthSessionUser {
  iat: number;
  exp: number;
}

interface CreateAuthTokenOptions {
  expiresInSeconds?: number;
}

const DEFAULT_AUTH_SECRET = 'duban-dev-auth-secret';
export const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
export const AUTH_TOKEN_RENEWAL_THRESHOLD_SECONDS = 60 * 60 * 24;
export const AUTH_TOKEN_RENEWAL_GRACE_SECONDS = DEFAULT_TOKEN_TTL_SECONDS;
export const LEGACY_TOKEN_TTL_SECONDS = 60 * 60 * 8;
export const LEGACY_TOKEN_MIGRATION_DEADLINE_SECONDS = Date.parse('2026-08-22T23:59:59+08:00') / 1000;

export interface AuthTokenSession {
  user: AuthSessionUser;
  expired: boolean;
  shouldRenew: boolean;
  iat: number;
  exp: number;
}

export function getAuthTokenSecret(env: Partial<Pick<NodeJS.ProcessEnv, 'AUTH_TOKEN_SECRET' | 'NODE_ENV'>> = process.env): string {
  if (env.AUTH_TOKEN_SECRET) return env.AUTH_TOKEN_SECRET;
  if (env.NODE_ENV === 'production') {
    throw new Error('AUTH_TOKEN_SECRET must be configured in production');
  }
  return DEFAULT_AUTH_SECRET;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getAuthTokenSecret()).update(payload).digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createAuthToken(user: AuthSessionUser, options: CreateAuthTokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    ...user,
    iat: now,
    exp: now + (options.expiresInSeconds ?? DEFAULT_TOKEN_TTL_SECONDS),
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function parseAuthToken(token: string): AuthSessionUser | null {
  const session = parseAuthTokenSession(token);
  return session && !session.expired ? session.user : null;
}

export function parseAuthTokenSession(token: string, now = Math.floor(Date.now() / 1000)): AuthTokenSession | null {
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!signaturesMatch(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as Partial<AuthTokenPayload>;
    if (!parsed.id || !parsed.username || !parsed.name || !parsed.role) return null;
    if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number') return null;

    const expired = parsed.exp <= now;
    const withinRenewalGrace = parsed.exp + AUTH_TOKEN_RENEWAL_GRACE_SECONDS > now;
    const isLegacyEightHourToken = parsed.exp - parsed.iat === LEGACY_TOKEN_TTL_SECONDS;
    const withinLegacyMigration = isLegacyEightHourToken && now < LEGACY_TOKEN_MIGRATION_DEADLINE_SECONDS;
    if (expired && !withinRenewalGrace && !withinLegacyMigration) return null;

    const user = {
      id: parsed.id,
      username: parsed.username,
      name: parsed.name,
      role: parsed.role,
      roleId: parsed.roleId || null,
      roleIds: parsed.roleIds || null,
      deptId: parsed.deptId || null,
      orgId: parsed.orgId || null,
      ...(typeof parsed.sessionVersion === 'number' ? { sessionVersion: parsed.sessionVersion } : {}),
    };
    return {
      user,
      expired,
      shouldRenew: expired || parsed.exp - now <= AUTH_TOKEN_RENEWAL_THRESHOLD_SECONDS,
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}
