import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureNotificationIdentityColumns,
  getNotificationIdentityAlterStatements,
  resetNotificationIdentityColumnsEnsureForTest,
} from './notification.schema';

test('getNotificationIdentityAlterStatements returns alter statements for message and urge identity columns', () => {
  assert.deepEqual(getNotificationIdentityAlterStatements(), [
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_id varchar(36) NULL",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id varchar(36) NULL",
    "ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS receiver_id varchar(36) NULL",
    "ALTER TABLE urge_records ADD COLUMN IF NOT EXISTS sender_id varchar(36) NULL",
  ]);
});

test('ensureNotificationIdentityColumns executes alter statements through db client', async () => {
  resetNotificationIdentityColumnsEnsureForTest();
  const executed: string[] = [];
  const db = {
    $client: {
      query: async (sql: string) => {
        executed.push(sql);
        return [[]];
      },
    },
  };

  await ensureNotificationIdentityColumns(db);

  assert.deepEqual(executed, getNotificationIdentityAlterStatements());
});

test('ensureNotificationIdentityColumns falls back to metadata checks when IF NOT EXISTS is unsupported', async () => {
  resetNotificationIdentityColumnsEnsureForTest();
  const executed: string[] = [];
  let firstAlter = true;
  const db = {
    $client: {
      query: async (sql: string, values?: unknown[]) => {
        executed.push(sql);

        if (sql.startsWith('ALTER TABLE') && sql.includes('IF NOT EXISTS') && firstAlter) {
          firstAlter = false;
          const error = new Error("You have an error in your SQL syntax near 'IF NOT EXISTS'");
          (error as Error & { sqlMessage?: string }).sqlMessage = "You have an error in your SQL syntax near 'IF NOT EXISTS'";
          throw error;
        }

        if (sql === 'SELECT DATABASE() AS databaseName') {
          return [[{ databaseName: 'duban' }]];
        }

        if (sql.includes('FROM information_schema.columns')) {
          assert.deepEqual(values, [
            'duban',
            'messages',
            'receiver_id',
            'messages',
            'sender_id',
            'urge_records',
            'receiver_id',
            'urge_records',
            'sender_id',
          ]);
          return [[
            { tableName: 'messages', columnName: 'receiver_id' },
            { tableName: 'urge_records', columnName: 'sender_id' },
          ]];
        }

        return [[]];
      },
    },
  };

  await ensureNotificationIdentityColumns(db);

  assert.deepEqual(executed, [
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS receiver_id varchar(36) NULL",
    'SELECT DATABASE() AS databaseName',
    [
      'SELECT table_name AS tableName, column_name AS columnName',
      '      FROM information_schema.columns',
      '      WHERE table_schema = ?',
      '        AND (table_name, column_name) IN ((?, ?), (?, ?), (?, ?), (?, ?))',
    ].join('\n'),
    "ALTER TABLE messages ADD COLUMN sender_id varchar(36) NULL",
    "ALTER TABLE urge_records ADD COLUMN receiver_id varchar(36) NULL",
  ]);
});
