import { readFile } from 'node:fs/promises';
import path from 'node:path';

type QueryableClient = {
  query: {
    (sql: string): Promise<[unknown[], unknown]>;
    (sql: string, values: readonly unknown[]): Promise<[unknown[], unknown]>;
  };
};

type SchemaEnsureDb = {
  $client?: unknown;
};

type ColumnSpec = {
  tableName: string;
  columnName: string;
  definition: string;
};

type InformationSchemaRow = {
  tableName?: string;
  columnName?: string;
};

type DatabaseNameRow = {
  databaseName?: string | null;
};

const baseSchemaSqlPath = path.resolve(__dirname, '../../drizzle/0000_groovy_forgotten_one.sql');

const schemaColumns: readonly ColumnSpec[] = [
  { tableName: 'users', columnName: 'preferences', definition: 'text NULL' },
  { tableName: 'users', columnName: 'wecom_user_id', definition: 'varchar(64) NULL' },
  { tableName: 'users', columnName: 'session_version', definition: 'int NOT NULL DEFAULT 0' },
  { tableName: 'departments', columnName: 'wecom_dept_id', definition: 'varchar(64) NULL' },
  { tableName: 'items', columnName: 'issuer_id', definition: 'varchar(36) NULL' },
  { tableName: 'items', columnName: 'issuer_name', definition: 'varchar(50) NULL' },
  { tableName: 'items', columnName: 'issuer_account', definition: 'varchar(50) NULL' },
  { tableName: 'items', columnName: 'sub_tasks', definition: 'text NULL' },
  { tableName: 'items', columnName: 'shared_with', definition: 'text NULL' },
  { tableName: 'items', columnName: 'attachments', definition: 'text NULL' },
  { tableName: 'items', columnName: 'original_status', definition: 'varchar(20) NULL' },
  { tableName: 'items', columnName: 'deleted_at', definition: 'datetime NULL' },
  { tableName: 'items', columnName: 'deleted_by_id', definition: 'varchar(36) NULL' },
  { tableName: 'items', columnName: 'change_history', definition: 'json NULL' },
  { tableName: 'timeline_nodes', columnName: 'attachments', definition: 'text NULL' },
  { tableName: 'timeline_nodes', columnName: 'actor_user_id', definition: 'varchar(36) NULL' },
  { tableName: 'urge_records', columnName: 'content', definition: 'text NULL' },
  { tableName: 'urge_records', columnName: 'batch_id', definition: 'varchar(36) NULL' },
  { tableName: 'urge_records', columnName: 'sub_task_id', definition: 'varchar(128) NULL' },
  { tableName: 'urge_records', columnName: 'idempotency_key', definition: 'varchar(64) NULL' },
  { tableName: 'urge_records', columnName: 'scope', definition: "varchar(20) NOT NULL DEFAULT 'SINGLE_ASSIGNEE'" },
  { tableName: 'urge_records', columnName: 'source', definition: "varchar(20) NOT NULL DEFAULT 'MANUAL'" },
  { tableName: 'urge_records', columnName: 'result', definition: "varchar(20) NOT NULL DEFAULT 'SUCCESS'" },
  { tableName: 'audit_records', columnName: 'rating', definition: 'int NULL' },
  { tableName: 'audit_records', columnName: 'evaluation', definition: 'text NULL' },
  { tableName: 'templates', columnName: 'description', definition: 'text NULL' },
  { tableName: 'templates', columnName: 'default_deadline_days', definition: 'int NULL DEFAULT 7' },
  { tableName: 'templates', columnName: 'default_follower_id', definition: 'varchar(36) NULL' },
  { tableName: 'templates', columnName: 'default_follower_name', definition: 'varchar(50) NULL' },
  { tableName: 'templates', columnName: 'rules', definition: 'text NULL' },
  { tableName: 'roles', columnName: 'owner_custom_user_ids', definition: 'text NULL' },
  { tableName: 'roles', columnName: 'follower_custom_user_ids', definition: 'text NULL' },
  { tableName: 'roles', columnName: 'allowed_page_actions', definition: 'text NULL' },
  { tableName: 'global_rules', columnName: 'wecom_agent_id', definition: 'varchar(50) NULL' },
  { tableName: 'global_rules', columnName: 'wecom_token', definition: 'varchar(100) NULL' },
  { tableName: 'global_rules', columnName: 'wecom_encoding_aes_key', definition: 'varchar(100) NULL' },
  { tableName: 'global_rules', columnName: 'wecom_callback_url', definition: 'varchar(300) NULL' },
  { tableName: 'global_rules', columnName: 'wecom_templates', definition: 'text NULL' },
  { tableName: 'global_rules', columnName: 'yellow_light_days', definition: 'int NULL DEFAULT 3' },
  { tableName: 'global_rules', columnName: 'red_light_hours', definition: 'int NULL DEFAULT 24' },
  { tableName: 'global_rules', columnName: 'auto_urge_frequency', definition: 'int NULL DEFAULT 1' },
  { tableName: 'global_rules', columnName: 'urge_channels', definition: 'text NULL' },
  { tableName: 'global_rules', columnName: 'serial_rule', definition: 'text NULL' },
  { tableName: 'global_rules', columnName: 'notif_templates', definition: 'text NULL' },
  { tableName: 'global_rules', columnName: 'audit_flow', definition: 'text NULL' },
];

const schemaFixStatements: readonly string[] = [
  'CREATE INDEX items_created_at_id_idx ON items (created_at, id)',
  'CREATE INDEX items_owner_created_at_idx ON items (owner_id, created_at)',
  'CREATE INDEX items_follower_created_at_idx ON items (follower_id, created_at)',
  'CREATE INDEX messages_receiver_timestamp_id_idx ON messages (receiver_id, timestamp, id)',
  'CREATE INDEX messages_timestamp_id_idx ON messages (timestamp, id)',
  'CREATE INDEX activities_timestamp_id_idx ON activities (timestamp, id)',
  'CREATE INDEX audit_records_submitted_at_id_idx ON audit_records (submitted_at, id)',
  'CREATE INDEX operation_logs_timestamp_id_idx ON operation_logs (timestamp, id)',
  'CREATE INDEX timeline_nodes_item_timestamp_idx ON timeline_nodes (item_id, timestamp, id)',
  'CREATE INDEX urge_records_auto_lookup_idx ON urge_records (item_id, receiver_id, sender_id, timestamp)',
  'CREATE INDEX urge_records_batch_item_receiver_idx ON urge_records (batch_id, item_id, receiver_id, sub_task_id)',
  'CREATE UNIQUE INDEX urge_records_idempotency_key_unique ON urge_records (idempotency_key)',
  'CREATE INDEX urge_records_scope_source_idx ON urge_records (scope, source, timestamp)',
  'CREATE TABLE IF NOT EXISTS message_user_states (\n' +
  '    message_id varchar(36) NOT NULL,\n' +
  '    user_id varchar(36) NOT NULL,\n' +
  '    `read` boolean NOT NULL DEFAULT false,\n' +
  '    deleted boolean NOT NULL DEFAULT false,\n' +
  '    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,\n' +
  '    PRIMARY KEY (message_id, user_id)\n' +
  '  )',
  // 事项可见性关联表：行级权限的索引化形态（与 items JSON 列人员关系双写，读路径可切换走索引）
  'CREATE TABLE IF NOT EXISTS item_access (\n' +
  '    item_id varchar(36) NOT NULL,\n' +
  '    user_id varchar(36) NOT NULL,\n' +
  '    relation varchar(20) NOT NULL,\n' +
  '    PRIMARY KEY (item_id, user_id, relation)\n' +
  '  )',
  'CREATE INDEX item_access_user_relation_idx ON item_access (user_id, relation, item_id)',
  'ALTER TABLE operation_logs MODIFY COLUMN timestamp datetime NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'ALTER TABLE global_rules MODIFY COLUMN wecom_corp_secret varchar(512) NULL',
  // 历史数据存在 `${itemId}-${assigneeId}` 形态的复合子任务 ID（可达 74 字符），varchar(36) 会直接插入失败。
  'ALTER TABLE urge_records MODIFY COLUMN sub_task_id varchar(128) NULL',
];

let ensureDatabaseSchemaPromise: Promise<void> | null = null;

export function resetDatabaseSchemaEnsureForTest(): void {
  ensureDatabaseSchemaPromise = null;
}

export function getDatabaseSchemaAlterStatements(): string[] {
  return schemaColumns.map(
    ({ tableName, columnName, definition }) =>
      `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${definition}`,
  );
}

export function getDatabaseSchemaFixStatements(): string[] {
  return [...schemaFixStatements];
}

export async function ensureDatabaseSchema(db: SchemaEnsureDb): Promise<void> {
  if (ensureDatabaseSchemaPromise) return ensureDatabaseSchemaPromise;

  ensureDatabaseSchemaPromise = runEnsureDatabaseSchema(db).catch((error) => {
    ensureDatabaseSchemaPromise = null;
    throw error;
  });

  return ensureDatabaseSchemaPromise;
}

async function runEnsureDatabaseSchema(db: SchemaEnsureDb): Promise<void> {
  const client = getQueryableClient(db?.$client);
  if (!client) return;

  await ensureBaseSchemaIfMissing(client);

  try {
    for (const statement of getDatabaseSchemaAlterStatements()) {
      await client.query(statement);
    }
  } catch (error) {
    if (!isIfNotExistsSyntaxError(error)) {
      if (isDuplicateColumnError(error)) return;
      throw error;
    }

    await ensureDatabaseSchemaWithMetadata(client);
  }

  await applyDatabaseSchemaFixes(client);
}

async function ensureBaseSchemaIfMissing(client: QueryableClient): Promise<void> {
  if (await tableExists(client, 'users')) return;

  const migrationSql = await readFile(baseSchemaSqlPath, 'utf8');
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await client.query(statement);
  }
}

async function ensureDatabaseSchemaWithMetadata(client: QueryableClient): Promise<void> {
  const databaseName = await getCurrentDatabaseName(client);
  if (!databaseName) return;

  const placeholders = schemaColumns.map(() => '(?, ?)').join(', ');
  const values = schemaColumns.flatMap(({ tableName, columnName }) => [tableName, columnName]);
  const [rows] = await client.query(
    `
      SELECT table_name AS tableName, column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = ?
        AND (table_name, column_name) IN (${placeholders})
    `.trim(),
    [databaseName, ...values],
  );

  const existingColumns = new Set(
    (rows as InformationSchemaRow[]).map((row) => `${row.tableName || ''}.${row.columnName || ''}`),
  );

  for (const { tableName, columnName, definition } of schemaColumns) {
    if (existingColumns.has(`${tableName}.${columnName}`)) continue;

    try {
      await client.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
  }
}

async function applyDatabaseSchemaFixes(client: QueryableClient): Promise<void> {
  for (const statement of getDatabaseSchemaFixStatements()) {
    try {
      await client.query(statement);
    } catch (error) {
      if (isDuplicateIndexError(error)) continue;
      throw error;
    }
  }
}

async function tableExists(client: QueryableClient, tableName: string): Promise<boolean> {
  const databaseName = await getCurrentDatabaseName(client);
  if (!databaseName) return false;

  const [rows] = await client.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ? AND table_name = ?
      LIMIT 1
    `.trim(),
    [databaseName, tableName],
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function getCurrentDatabaseName(client: QueryableClient): Promise<string | null> {
  const [rows] = await client.query('SELECT DATABASE() AS databaseName');
  return (rows as DatabaseNameRow[])[0]?.databaseName || null;
}

function getQueryableClient(client: unknown): QueryableClient | null {
  if (
    client &&
    typeof client === 'object' &&
    'query' in client &&
    typeof (client as { query?: unknown }).query === 'function'
  ) {
    return client as QueryableClient;
  }
  return null;
}

function isIfNotExistsSyntaxError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('IF NOT EXISTS') || message.includes('syntax');
}

function isDuplicateColumnError(error: unknown): boolean {
  const err = error as { errno?: number; code?: string; sqlMessage?: string; message?: string };
  const message = getErrorMessage(error).toLowerCase();
  return err?.errno === 1060 || err?.code === 'ER_DUP_FIELDNAME' || message.includes('duplicate column');
}

function isDuplicateIndexError(error: unknown): boolean {
  const err = error as { errno?: number; code?: string; sqlMessage?: string; message?: string };
  const message = getErrorMessage(error).toLowerCase();
  return err?.errno === 1061 || err?.code === 'ER_DUP_KEYNAME' || message.includes('duplicate key name');
}

function getErrorMessage(error: unknown): string {
  const err = error as { sqlMessage?: string; message?: string };
  return `${err?.sqlMessage || ''} ${err?.message || ''}`;
}
