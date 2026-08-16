import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  executeDeployRoleRefresh,
  productionDeployRoleRefreshBindings,
  runDeployRoleRefresh,
  type DeployRoleDefinition,
  type RoleRefreshConnection,
} from './deploy-role-refresh';
import { closeDb, getDb } from './index';
import { ensureDatabaseSchema } from './schema.ensure';

const productionBindingTypeCheck: NonNullable<Parameters<typeof executeDeployRoleRefresh>[0]> = {
  getDatabase: getDb,
  closeDatabase: closeDb,
  ensureSchema: ensureDatabaseSchema,
};

const baseRole: DeployRoleDefinition = {
  id: 'r3',
  name: '部门管理员',
  description: '部门负责人角色',
  permissions: ['MENU_WORKBENCH'],
  dataScope: 'DEPT',
  followerDataScope: 'DEPT',
  allowedActions: ['READ'],
};

function createDatabaseHarness(failure?: Error) {
  const events: string[] = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let executeCount = 0;

  const connection: RoleRefreshConnection = {
    async beginTransaction() {
      events.push('begin');
    },
    async execute(sql, params = []) {
      events.push(`execute:${executeCount}`);
      queries.push({ sql, params });
      executeCount += 1;
      if (failure && executeCount === 4) throw failure;
      return [];
    },
    async commit() {
      events.push('commit');
    },
    async rollback() {
      events.push('rollback');
    },
    release() {
      events.push('release');
    },
  };

  return {
    db: {
      $client: {
        async getConnection() {
          events.push('getConnection');
          return connection;
        },
      },
    },
    events,
    queries,
  };
}

describe('deploy role refresh', () => {
  test('executable defaults remain bound to the production database lifecycle', () => {
    assert.equal(productionDeployRoleRefreshBindings.getDatabase, productionBindingTypeCheck.getDatabase);
    assert.equal(productionDeployRoleRefreshBindings.ensureSchema, productionBindingTypeCheck.ensureSchema);
    assert.equal(productionDeployRoleRefreshBindings.closeDatabase, productionBindingTypeCheck.closeDatabase);
  });

  test('rejects an empty role baseline before schema or transactional work', async () => {
    const harness = createDatabaseHarness();

    await assert.rejects(
      runDeployRoleRefresh({
        db: harness.db,
        roles: [],
        ensureSchema: async () => {
          harness.events.push('ensureSchema');
        },
      }),
      /non-empty array/,
    );

    assert.deepEqual(harness.events, []);
    assert.deepEqual(harness.queries, []);
  });

  test('rejects a wrong database target before opening the database or ensuring schema', async () => {
    const events: string[] = [];

    await assert.rejects(
      executeDeployRoleRefresh({
        getDatabase: async () => {
          events.push('getDatabase');
          return createDatabaseHarness().db;
        },
        closeDatabase: async () => {
          events.push('closeDatabase');
        },
        roles: [baseRole],
        ensureSchema: async () => {
          events.push('ensureSchema');
        },
        databaseUrl: 'mysql://user:secret@db.example.com/duban_wrong',
        expectedDatabaseTargetId: 'expected-target-id',
        runtimeId: 'runtime-host',
        expectedRuntimeId: 'runtime-host',
      }),
      /database target/i,
    );

    assert.deepEqual(events, ['closeDatabase']);
  });

  test('rejects a wrong runtime identity before opening the database or ensuring schema', async () => {
    const events: string[] = [];

    await assert.rejects(
      executeDeployRoleRefresh({
        getDatabase: async () => {
          events.push('getDatabase');
          return createDatabaseHarness().db;
        },
        closeDatabase: async () => {
          events.push('closeDatabase');
        },
        roles: [baseRole],
        ensureSchema: async () => {
          events.push('ensureSchema');
        },
        databaseUrl: 'mysql://user:secret@db.example.com/duban',
        expectedDatabaseTargetId: 'matching-target-id',
        getDatabaseTargetId: () => 'matching-target-id',
        runtimeId: 'runtime-host',
        expectedRuntimeId: 'runtime-container',
      }),
      /runtime identity/i,
    );

    assert.deepEqual(events, ['closeDatabase']);
  });

  test('ensures schema then performs parameterized alias migrations, safe delete, and role inserts in one transaction', async () => {
    const harness = createDatabaseHarness();
    const roles: DeployRoleDefinition[] = [
      baseRole,
      {
        ...baseRole,
        id: 'r4dtsn6m',
        name: '督办管理员',
        description: '督办业务管理员',
        dataScope: 'ALL',
        followerDataScope: 'ALL',
        allowedPageActions: { MENU_ITEMS: ['EXPORT'] },
      },
    ];

    await runDeployRoleRefresh({
      db: harness.db,
      roles,
      ensureSchema: async () => {
        harness.events.push('ensureSchema');
      },
    });

    assert.deepEqual(harness.events, [
      'ensureSchema',
      'getConnection',
      'begin',
      'execute:0',
      'execute:1',
      'execute:2',
      'execute:3',
      'execute:4',
      'commit',
      'release',
    ]);

    assert.deepEqual(harness.queries[0].params, ['r3', 'r4']);
    assert.deepEqual(harness.queries[1].params, ['r6', 'rjqslf5z']);
    assert.deepEqual(harness.queries[2].params, ['r4', 'rjqslf5z']);
    assert.match(harness.queries[0].sql, /UPDATE users SET role_id = \? WHERE role_id = \?/);
    assert.match(harness.queries[2].sql, /DELETE FROM roles WHERE id IN \(\?, \?\)/);
    assert.doesNotMatch(harness.queries[2].sql, /r4dtsn6m/);
    assert.ok(harness.queries.every(({ params }) => params.length > 0));
    assert.ok(harness.queries.slice(0, 3).every(({ params }) => !params.includes('r4dtsn6m')));
    assert.ok(
      harness.queries.every(({ sql, params }) => params.every((param) => !sql.includes(String(param)))),
    );

    const firstInsert = harness.queries[3];
    const secondInsert = harness.queries[4];
    assert.match(firstInsert.sql, /INSERT INTO roles/);
    assert.equal(firstInsert.params[7], '{}');
    assert.equal(secondInsert.params[7], JSON.stringify({ MENU_ITEMS: ['EXPORT'] }));

    const duplicateUpdate = firstInsert.sql.slice(firstInsert.sql.indexOf('ON DUPLICATE KEY UPDATE'));
    // 内置角色在重复键时仅同步「系统托管」字段（菜单/操作/数据范围/按钮级权限），
    // name/description 属于管理员可自定义的展示身份，禁止在刷新时被代码种子值覆盖，
    // 否则管理员对内置角色（如 r6 责任人）的重命名会在每次部署后被还原。
    assert.doesNotMatch(duplicateUpdate, /name = VALUES\(name\)/);
    assert.doesNotMatch(duplicateUpdate, /description = VALUES\(description\)/);
    assert.match(duplicateUpdate, /permissions = VALUES\(permissions\)/);
    assert.match(duplicateUpdate, /allowed_actions = VALUES\(allowed_actions\)/);
    assert.match(duplicateUpdate, /data_scope = VALUES\(data_scope\)/);
    assert.match(duplicateUpdate, /follower_data_scope = VALUES\(follower_data_scope\)/);
    assert.match(duplicateUpdate, /allowed_page_actions = VALUES\(allowed_page_actions\)/);
    assert.doesNotMatch(
      duplicateUpdate,
      /org_ids|custom_user_ids/,
    );
  });

  test('rolls back, releases the connection, and propagates query failures', async () => {
    const failure = new Error('insert failed');
    const harness = createDatabaseHarness(failure);

    await assert.rejects(
      runDeployRoleRefresh({
        db: harness.db,
        roles: [baseRole],
        ensureSchema: async () => {
          harness.events.push('ensureSchema');
        },
      }),
      failure,
    );

    assert.ok(harness.events.includes('rollback'));
    assert.ok(harness.events.includes('release'));
    assert.ok(!harness.events.includes('commit'));
  });

  test('executable wrapper closes the database in finally when refresh fails', async () => {
    const failure = new Error('insert failed');
    const harness = createDatabaseHarness(failure);
    let closed = false;

    await assert.rejects(
      executeDeployRoleRefresh({
        getDatabase: async () => harness.db,
        closeDatabase: async () => {
          closed = true;
        },
        roles: [baseRole],
        ensureSchema: async () => undefined,
        databaseUrl: 'mysql://user:secret@db.example.com/duban',
        expectedDatabaseTargetId: 'matching-target-id',
        getDatabaseTargetId: () => 'matching-target-id',
        runtimeId: 'runtime-host',
        expectedRuntimeId: 'runtime-host',
      }),
      failure,
    );

    assert.equal(closed, true);
  });

  test('preserves refresh and close failures with the refresh error first', async () => {
    const refreshFailure = new Error('insert failed');
    const closeFailure = new Error('close failed');
    const harness = createDatabaseHarness(refreshFailure);

    await assert.rejects(
      executeDeployRoleRefresh({
        getDatabase: async () => harness.db,
        closeDatabase: async () => {
          throw closeFailure;
        },
        roles: [baseRole],
        ensureSchema: async () => undefined,
        databaseUrl: 'mysql://user:secret@db.example.com/duban',
        expectedDatabaseTargetId: 'matching-target-id',
        getDatabaseTargetId: () => 'matching-target-id',
        runtimeId: 'runtime-host',
        expectedRuntimeId: 'runtime-host',
      }),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [refreshFailure, closeFailure]);
        return true;
      },
    );
  });

  test('preserves refresh rollback and close failures in causal order', async () => {
    const refreshFailure = new Error('insert failed');
    const rollbackFailure = new Error('rollback failed');
    const closeFailure = new Error('close failed');
    const harness = createDatabaseHarness(refreshFailure);
    harness.db.$client.getConnection = async () => ({
      ...(await createDatabaseHarness(refreshFailure).db.$client.getConnection()),
      async rollback() {
        throw rollbackFailure;
      },
    });

    await assert.rejects(
      executeDeployRoleRefresh({
        getDatabase: async () => harness.db,
        closeDatabase: async () => {
          throw closeFailure;
        },
        roles: [baseRole],
        ensureSchema: async () => undefined,
        databaseUrl: 'mysql://user:secret@db.example.com/duban',
        expectedDatabaseTargetId: 'matching-target-id',
        getDatabaseTargetId: () => 'matching-target-id',
        runtimeId: 'runtime-host',
        expectedRuntimeId: 'runtime-host',
      }),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.ok(error.errors[0] instanceof AggregateError);
        assert.deepEqual(error.errors[0].errors, [refreshFailure, rollbackFailure]);
        assert.equal(error.errors[1], closeFailure);
        return true;
      },
    );
  });

  test('propagates a close-only failure directly', async () => {
    const closeFailure = new Error('close failed');
    const harness = createDatabaseHarness();

    await assert.rejects(
      executeDeployRoleRefresh({
        getDatabase: async () => harness.db,
        closeDatabase: async () => {
          throw closeFailure;
        },
        roles: [baseRole],
        ensureSchema: async () => undefined,
        databaseUrl: 'mysql://user:secret@db.example.com/duban',
        expectedDatabaseTargetId: 'matching-target-id',
        getDatabaseTargetId: () => 'matching-target-id',
        runtimeId: 'runtime-host',
        expectedRuntimeId: 'runtime-host',
      }),
      closeFailure,
    );
  });
});
