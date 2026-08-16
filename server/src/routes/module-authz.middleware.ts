import { NextFunction, Response } from 'express';
import { getDb } from '../db';
import { AuthenticatedRequest } from './auth.middleware';
import { getCurrentAccessContext } from './access.context';

type RolePredicate = (role: unknown) => boolean;

export function requireModuleAccess(predicate: RolePredicate, errorMessage: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const db = await getDb();
      const accessContext = await getCurrentAccessContext(db, req.authUser?.id);
      if (!accessContext?.currentRole || !predicate(accessContext.currentRole)) {
        res.status(403).json({ error: errorMessage });
        return;
      }
      next();
    } catch (error) {
      console.error('Check module permission error:', error);
      res.status(500).json({ error: '校验模块权限失败' });
    }
  };
}
