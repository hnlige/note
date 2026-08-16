import { NextFunction, Request, Response } from 'express';
import { AuthSessionUser, createAuthToken, parseAuthTokenSession } from './auth.session';
import { getDb } from '../db';

export const RENEWED_AUTH_TOKEN_HEADER = 'X-Duban-Auth-Token';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthSessionUser;
}

export function getRequestUserFromAuthHeader(header?: string | string[]): AuthSessionUser | null {
  return getRequestAuthSessionFromAuthHeader(header)?.user || null;
}

export function getRequestAuthSessionFromAuthHeader(header?: string | string[]) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return parseAuthTokenSession(token);
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const authSession = getRequestAuthSessionFromAuthHeader(req.headers.authorization);

    if (!authSession) {
      res.status(401).json({ error: '请先登录' });
      return;
    }

    if (!process.env.DATABASE_URL) {
      if (authSession.shouldRenew) res.setHeader(RENEWED_AUTH_TOKEN_HEADER, createAuthToken(authSession.user));
      req.authUser = authSession.user;
      next();
      return;
    }
    void (async () => {
      const db = await getDb();
      const { users: usersTable } = await import('../db/schema');
      const { eq } = await import('drizzle-orm');
      const [currentUser] = await db.select({ status: usersTable.status, sessionVersion: usersTable.sessionVersion })
        .from(usersTable).where(eq(usersTable.id, authSession.user.id)).limit(1);
      if (!currentUser || currentUser.status !== 'ACTIVE' || (currentUser.sessionVersion ?? 0) !== (authSession.user.sessionVersion ?? 0)) {
        res.status(401).json({ error: '登录凭证已失效，请重新登录' });
        return;
      }
      if (authSession.shouldRenew) res.setHeader(RENEWED_AUTH_TOKEN_HEADER, createAuthToken({ ...authSession.user, sessionVersion: currentUser.sessionVersion ?? 0 }));
      req.authUser = authSession.user;
      next();
    })().catch((error) => {
      console.error('requireAuth error:', error);
      res.status(401).json({ error: '登录凭证无效，请重新登录' });
    });
  } catch (error) {
    console.error('requireAuth error:', error);
    res.status(401).json({ error: '登录凭证无效，请重新登录' });
  }
}
