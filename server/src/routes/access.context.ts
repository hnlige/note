import { getValidRoleForUser } from './access.policy';

// 用户/角色/部门是低频变更数据，加 TTL 缓存避免每次请求全表加载三张表。
// TTL 与 index.ts 的 cacheMiddleware 一致：开发 2s（快速反馈），生产 60s。
let accessTablesCache: { users: any[]; roles: any[]; departments: any[]; fetchedAt: number } | null = null;
const ACCESS_CACHE_TTL = process.env.NODE_ENV === 'production' ? 60000 : 2000;

async function loadAccessTables(db: any) {
  const now = Date.now();
  if (accessTablesCache && now - accessTablesCache.fetchedAt < ACCESS_CACHE_TTL) {
    return accessTablesCache;
  }
  const { users: usersTable, roles: rolesTable, departments: departmentsTable } = await import('../db/schema');
  const users = await db.select().from(usersTable);
  const roles = await db.select().from(rolesTable);
  const departments = await db.select().from(departmentsTable);
  accessTablesCache = { users, roles, departments, fetchedAt: now };
  return accessTablesCache;
}

export async function getCurrentAccessContext(db: any, authUserId?: string) {
  if (!authUserId) return null;
  const { users, roles, departments } = await loadAccessTables(db);
  const currentUser = users.find((user: { id: string }) => user.id === authUserId) || null;
  if (!currentUser) return null;
  const currentRole = getValidRoleForUser(currentUser, roles);
  return { currentUser, currentRole, users, roles, departments };
}

/** 用户/角色/部门变更后主动失效缓存 */
export function invalidateAccessContextCache() {
  accessTablesCache = null;
}
