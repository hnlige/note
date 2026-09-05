import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureDatabaseSchema,
  getDatabaseSchemaAlterStatements,
  getDatabaseSchemaFixStatements,
  resetDatabaseSchemaEnsureForTest,
} from './schema.ensure';

test('getDatabaseSchemaAlterStatements includes the persisted sub task column', () => {
  const statements = getDatabaseSchemaAlterStatements();
  assert.ok(statements.includes('ALTER TABLE items ADD COLUMN IF NOT EXISTS sub_tasks text NULL'));
  assert.ok(statements.includes('ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS content text NULL'));
  assert.ok(statements.includes('ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS batch_id varchar(36) NULL'));
  assert.ok(statements.includes('ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS sub_task_id varchar(128) NULL'));
  assert.ok(statements.includes('ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS idempotency_key varchar(64) NULL'));
  assert.ok(statements.includes("ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS scope varchar(20) NOT NULL DEFAULT 'SINGLE_ASSIGNEE'"));
  assert.ok(statements.includes("ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'MANUAL'"));
  assert.ok(statements.includes("ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS result varchar(20) NOT NULL DEFAULT 'SUCCESS'"));
  assert.ok(statements.includes('ALTER TABLE global_rules ADD COLUMN IF NOT EXISTS audit_flow text NULL'));
  assert.ok(statements.includes('ALTER TABLE global_rules ADD COLUMN IF NOT EXISTS wecom_contact_secret varchar(512) NULL'));
  assert.ok(statements.includes("ALTER TABLE global_rules ADD COLUMN IF NOT EXISTS wecom_sync_mode varchar(20) NULL DEFAULT 'legacy'"));
  assert.ok(statements.includes('ALTER TABLE global_rules ADD COLUMN IF NOT EXISTS wecom_private_info_enabled tinyint(1) NULL DEFAULT 0'));
});

test('getDatabaseSchemaFixStatements includes list and automatic-engine indexes', () => {
  const statements = getDatabaseSchemaFixStatements();
  assert.ok(statements.includes('CREATE INDEX items_created_at_id_idx ON items (created_at, id)'));
  assert.ok(statements.includes('CREATE INDEX messages_receiver_timestamp_id_idx ON messages (receiver_id, timestamp, id)'));
  assert.ok(statements.includes('CREATE INDEX activities_timestamp_id_idx ON activities (timestamp, id)'));
  assert.ok(statements.includes('CREATE INDEX audit_records_submitted_at_id_idx ON audit_records (submitted_at, id)'));
  assert.ok(statements.includes('CREATE INDEX operation_logs_timestamp_id_idx ON operation_logs (timestamp, id)'));
  assert.ok(statements.includes('CREATE INDEX timeline_nodes_item_timestamp_idx ON timeline_nodes (item_id, timestamp, id)'));
  assert.ok(statements.includes('CREATE INDEX urge_records_auto_lookup_idx ON urge_records (item_id, receiver_id, sender_id, timestamp)'));
  assert.ok(statements.includes('CREATE INDEX urge_records_batch_item_receiver_idx ON urge_records (batch_id, item_id, receiver_id, sub_task_id)'));
  assert.ok(statements.includes('CREATE UNIQUE INDEX urge_records_idempotency_key_unique ON urge_records (idempotency_key)'));
  assert.ok(statements.includes('CREATE INDEX urge_records_scope_source_idx ON urge_records (scope, source, timestamp)'));
  assert.ok(statements.includes('ALTER TABLE urge_records MODIFY COLUMN sub_task_id varchar(128) NULL'));
});

test('ensureDatabaseSchema executes alter and fix statements when base schema already exists', async () => {
  resetDatabaseSchemaEnsureForTest();
  const executed: string[] = [];
  const db = {
    $client: {
      query: async (sql: string, values?: unknown[]) => {
        executed.push(sql);
        if (sql === 'SELECT DATABASE() AS databaseName') {
          return [[{ databaseName: 'duban' }]];
        }
        if (sql.includes('FROM information_schema.tables')) {
          assert.deepEqual(values, ['duban', 'users']);
          return [[{ 1: 1 }], undefined] as unknown as [unknown[], unknown];
        }
        return [[]];
      },
    },
  };

  await ensureDatabaseSchema(db);

  assert.equal(executed[0], 'SELECT DATABASE() AS databaseName');
  assert.match(executed[1]!, /SELECT 1\s+FROM information_schema\.tables/);
  assert.deepEqual(executed.slice(2), [
    ...getDatabaseSchemaAlterStatements(),
    ...getDatabaseSchemaFixStatements(),
  ]);
});

test('ensureDatabaseSchema ignores duplicate index errors while applying schema fixes', async () => {
  resetDatabaseSchemaEnsureForTest();
  const db = {
    $client: {
      query: async (sql: string) => {
        if (sql === 'SELECT DATABASE() AS databaseName') return [[{ databaseName: 'duban' }]];
        if (sql.includes('FROM information_schema.tables')) return [[{ 1: 1 }]];
        if (sql.startsWith('CREATE INDEX')) {
          const error = new Error('Duplicate key name');
          (error as Error & { errno?: number; code?: string }).errno = 1061;
          (error as Error & { errno?: number; code?: string }).code = 'ER_DUP_KEYNAME';
          throw error;
        }
        return [[]];
      },
    },
  };

  await assert.doesNotReject(() => ensureDatabaseSchema(db));
});

test('ensureDatabaseSchema bootstraps base schema when users table is missing', async () => {
  resetDatabaseSchemaEnsureForTest();
  const executed: string[] = [];
  const db = {
    $client: {
      query: async (sql: string, values?: unknown[]) => {
        executed.push(sql);
        if (sql === 'SELECT DATABASE() AS databaseName') {
          return [[{ databaseName: 'duban' }]];
        }
        if (sql.includes('FROM information_schema.tables')) {
          assert.deepEqual(values, ['duban', 'users']);
          return [[]];
        }
        return [[]];
      },
    },
  };

  await ensureDatabaseSchema(db);

  assert.equal(executed[0], 'SELECT DATABASE() AS databaseName');
  assert.match(executed[1]!, /SELECT 1\s+FROM information_schema\.tables/);
  assert.match(executed[2]!, /CREATE TABLE `activities`/);
  assert.ok(executed.some((sql) => sql.includes('CREATE TABLE `users`')));
  assert.ok(executed.some((sql) => sql === 'ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences text NULL'));
  assert.ok(executed.includes('ALTER TABLE global_rules MODIFY COLUMN wecom_corp_secret varchar(512) NULL'));
});

test('ensureDatabaseSchema falls back to metadata when IF NOT EXISTS is unsupported', async () => {
  resetDatabaseSchemaEnsureForTest();
  const executed: string[] = [];
  const db = {
    $client: {
      query: async (sql: string, values?: unknown[]) => {
        executed.push(sql);
        if (sql.startsWith('ALTER TABLE') && sql.includes('IF NOT EXISTS')) {
          const error = new Error("You have an error near 'IF NOT EXISTS'");
          (error as Error & { sqlMessage?: string }).sqlMessage = "You have an error near 'IF NOT EXISTS'";
          throw error;
        }
        if (sql === 'SELECT DATABASE() AS databaseName') {
          return [[{ databaseName: 'duban' }]];
        }
        if (sql.includes('FROM information_schema.tables')) {
          assert.deepEqual(values, ['duban', 'users']);
          return [[{ 1: 1 }], undefined] as unknown as [unknown[], unknown];
        }
        if (sql.includes('FROM information_schema.columns')) {
          const expectedPairs = getDatabaseSchemaAlterStatements().flatMap((statement) => {
            const match = statement.match(/^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/);
            return match ? [match[1], match[2]] : [];
          });
          assert.deepEqual(values, ['duban', ...expectedPairs]);
          return [[]];
        }
        return [[]];
      },
    },
  };

  await ensureDatabaseSchema(db);

  assert.equal(executed[0], 'SELECT DATABASE() AS databaseName');
  assert.match(executed[1]!, /SELECT 1\s+FROM information_schema\.tables/);
  assert.equal(executed[2], 'ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences text NULL');
  assert.equal(executed[3], 'SELECT DATABASE() AS databaseName');
  assert.match(executed[4]!, /FROM information_schema\.columns/);
  assert.deepEqual(executed.slice(5), [
    ...getDatabaseSchemaAlterStatements().map((statement) => statement.replace(' ADD COLUMN IF NOT EXISTS ', ' ADD COLUMN ')),
    ...getDatabaseSchemaFixStatements(),
  ]);
});
