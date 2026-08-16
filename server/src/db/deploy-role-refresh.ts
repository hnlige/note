import { BUILT_IN_ROLES, type BuiltInRoleDefinition } from './built-in-roles';
import {
  getDatabaseTargetId as calculateDatabaseTargetId,
  UNCONFIGURED_DATABASE_TARGET_ID,
} from '../health';
import { closeDb, getDb } from './index';
import { ensureDatabaseSchema } from './schema.ensure';

export type DeployRoleDefinition = BuiltInRoleDefinition & {
  allowedPageActions?: Record<string, string[]>;
};

export type RoleRefreshConnection = {
  beginTransaction(): Promise<void>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
};

export type DeployRoleRefreshDatabase = {
  $client?: unknown;
};

type EnsureSchema = (db: DeployRoleRefreshDatabase) => Promise<void>;

type RunDeployRoleRefreshOptions = {
  db: DeployRoleRefreshDatabase;
  roles?: readonly DeployRoleDefinition[];
  ensureSchema?: EnsureSchema;
};

type ExecuteDeployRoleRefreshOptions = {
  getDatabase?: () => Promise<DeployRoleRefreshDatabase>;
  closeDatabase?: () => Promise<void>;
  roles?: readonly DeployRoleDefinition[];
  ensureSchema?: EnsureSchema;
  databaseUrl?: string;
  expectedDatabaseTargetId?: string;
  getDatabaseTargetId?: (databaseUrl: string | undefined) => string;
  runtimeId?: string;
  expectedRuntimeId?: string;
};

const insertRoleSql = `
  INSERT INTO roles (
    id,
    name,
    description,
    permissions,
    data_scope,
    follower_data_scope,
    allowed_actions,
    allowed_page_actions,
    org_ids,
    owner_custom_user_ids,
    follower_custom_user_ids,
    custom_user_ids,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  ON DUPLICATE KEY UPDATE
    -- name/description 是管理员可自定义的展示身份，刷新时禁止覆盖已有值，
    -- 否则对内置角色（如 r6「责任人」）的重命名会在每次部署后被还原。
    permissions = VALUES(permissions),
    allowed_actions = VALUES(allowed_actions),
    data_scope = VALUES(data_scope),
    follower_data_scope = VALUES(follower_data_scope),
    allowed_page_actions = VALUES(allowed_page_actions)
`.trim();

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isObjectLike(value) && typeof Reflect.get(value, 'then') === 'function';
}

function isRoleRefreshConnection(value: unknown): value is RoleRefreshConnection {
  return isObjectLike(value)
    && ['beginTransaction', 'execute', 'commit', 'rollback', 'release'].every(
      (method) => typeof Reflect.get(value, method) === 'function',
    );
}

async function getRoleRefreshConnection(db: DeployRoleRefreshDatabase): Promise<RoleRefreshConnection> {
  const drizzleClient = db.$client;
  if (!isObjectLike(drizzleClient)) {
    throw new Error('Deployment database does not expose a mysql2 connection pool');
  }

  const promiseFactory = Reflect.get(drizzleClient, 'promise');
  const promiseClient = typeof promiseFactory === 'function'
    ? Reflect.apply(promiseFactory, drizzleClient, [])
    : drizzleClient;
  if (!isObjectLike(promiseClient)) {
    throw new Error('Deployment database does not expose a mysql2 promise pool');
  }

  const getConnection = Reflect.get(promiseClient, 'getConnection');
  if (typeof getConnection !== 'function') {
    throw new Error('Deployment database does not expose a mysql2 promise pool');
  }

  const connectionPromise = Reflect.apply(getConnection, promiseClient, []);
  if (!isPromiseLike(connectionPromise)) {
    throw new Error('Deployment database getConnection did not return a promise');
  }

  const connection = await connectionPromise;
  if (!isRoleRefreshConnection(connection)) {
    throw new Error('Deployment database returned an invalid transaction connection');
  }

  return connection;
}

export function assertBuiltInRoles(roles: unknown): asserts roles is readonly DeployRoleDefinition[] {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error('BUILT_IN_ROLES must be a non-empty array');
  }
}

export async function refreshBuiltInRoles(
  db: DeployRoleRefreshDatabase,
  roles: readonly DeployRoleDefinition[],
): Promise<void> {
  assertBuiltInRoles(roles);

  const connection = await getRoleRefreshConnection(db);
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    await connection.execute('UPDATE users SET role_id = ? WHERE role_id = ?', ['r3', 'r4']);
    await connection.execute('UPDATE users SET role_id = ? WHERE role_id = ?', ['r6', 'rjqslf5z']);
    await connection.execute('DELETE FROM roles WHERE id IN (?, ?)', ['r4', 'rjqslf5z']);

    for (const role of roles) {
      await connection.execute(insertRoleSql, [
        role.id,
        role.name,
        role.description,
        JSON.stringify(role.permissions ?? []),
        role.dataScope || 'SELF',
        role.followerDataScope ?? null,
        JSON.stringify(role.allowedActions ?? []),
        JSON.stringify(role.allowedPageActions ?? {}),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
      ]);
    }

    await connection.commit();
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Role refresh and rollback both failed');
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function runDeployRoleRefresh({
  db,
  roles = BUILT_IN_ROLES,
  ensureSchema = ensureDatabaseSchema as EnsureSchema,
}: RunDeployRoleRefreshOptions): Promise<void> {
  assertBuiltInRoles(roles);
  await ensureSchema(db);
  await refreshBuiltInRoles(db, roles);
}

export const productionDeployRoleRefreshBindings = {
  getDatabase: getDb,
  closeDatabase: closeDb,
  ensureSchema: ensureDatabaseSchema,
} satisfies Pick<
  Required<ExecuteDeployRoleRefreshOptions>,
  'getDatabase' | 'closeDatabase' | 'ensureSchema'
>;

function assertExpectedDatabaseTarget(
  databaseUrl: string | undefined,
  expectedDatabaseTargetId: string | undefined,
  getDatabaseTargetId: (value: string | undefined) => string,
): void {
  if (!expectedDatabaseTargetId) {
    throw new Error('Expected database target identity is required for deployment refresh');
  }

  const actualDatabaseTargetId = getDatabaseTargetId(databaseUrl);
  if (
    actualDatabaseTargetId === UNCONFIGURED_DATABASE_TARGET_ID
    || actualDatabaseTargetId !== expectedDatabaseTargetId
  ) {
    throw new Error('Deployment database target does not match the selected runtime');
  }
}

function assertExpectedRuntime(runtimeId: string | undefined, expectedRuntimeId: string | undefined): void {
  if (!runtimeId || !expectedRuntimeId || runtimeId !== expectedRuntimeId) {
    throw new Error('Deployment runtime identity does not match the selected public runtime');
  }
}

export async function executeDeployRoleRefresh({
  getDatabase = productionDeployRoleRefreshBindings.getDatabase,
  closeDatabase = productionDeployRoleRefreshBindings.closeDatabase,
  roles = BUILT_IN_ROLES,
  ensureSchema = productionDeployRoleRefreshBindings.ensureSchema,
  databaseUrl = process.env.DATABASE_URL,
  expectedDatabaseTargetId = process.env.EXPECTED_DATABASE_TARGET_ID,
  getDatabaseTargetId = calculateDatabaseTargetId,
  runtimeId = process.env.DEPLOY_RUNTIME_ID,
  expectedRuntimeId = process.env.EXPECTED_RUNTIME_ID,
}: ExecuteDeployRoleRefreshOptions = {}): Promise<void> {
  let primaryError: unknown;
  let hasPrimaryError = false;

  try {
    assertExpectedRuntime(runtimeId, expectedRuntimeId);
    assertExpectedDatabaseTarget(databaseUrl, expectedDatabaseTargetId, getDatabaseTargetId);
    const db = await getDatabase();
    await runDeployRoleRefresh({ db, roles, ensureSchema });
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
  }

  try {
    await closeDatabase();
  } catch (closeError) {
    if (hasPrimaryError) {
      throw new AggregateError(
        [primaryError, closeError],
        'Deployment role refresh and database close both failed',
      );
    }
    throw closeError;
  }

  if (hasPrimaryError) throw primaryError;
}

if (require.main === module) {
  executeDeployRoleRefresh().catch((error) => {
    console.error('[deploy] Built-in role refresh failed:', error);
    process.exitCode = 1;
  });
}
