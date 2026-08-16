type QueryableClient = {
  query: {
    (sql: string): Promise<[unknown[], unknown]>;
    (sql: string, values: readonly unknown[]): Promise<[unknown[], unknown]>;
  };
};

type NotificationSchemaDb = {
  $client?: unknown;
};

type InformationSchemaRow = {
  tableName?: string;
  columnName?: string;
};

type DatabaseNameRow = {
  databaseName?: string | null;
};

type NotificationIdentityColumn = {
  tableName: 'messages' | 'urge_records';
  columnName: 'receiver_id' | 'sender_id';
};

const notificationIdentityColumns: readonly NotificationIdentityColumn[] = [
  { tableName: 'messages', columnName: 'receiver_id' },
  { tableName: 'messages', columnName: 'sender_id' },
  { tableName: 'urge_records', columnName: 'receiver_id' },
  { tableName: 'urge_records', columnName: 'sender_id' },
];

let ensureNotificationIdentityColumnsPromise: Promise<void> | null = null;

export function resetNotificationIdentityColumnsEnsureForTest(): void {
  ensureNotificationIdentityColumnsPromise = null;
}

export function getNotificationIdentityAlterStatements(): string[] {
  return notificationIdentityColumns.map(
    ({ tableName, columnName }) =>
      `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} varchar(36) NULL`,
  );
}

export async function ensureNotificationIdentityColumns(db: NotificationSchemaDb): Promise<void> {
  if (ensureNotificationIdentityColumnsPromise) {
    return ensureNotificationIdentityColumnsPromise;
  }

  ensureNotificationIdentityColumnsPromise = runEnsureNotificationIdentityColumns(db).catch((error) => {
    ensureNotificationIdentityColumnsPromise = null;
    throw error;
  });

  return ensureNotificationIdentityColumnsPromise;
}

async function runEnsureNotificationIdentityColumns(db: NotificationSchemaDb): Promise<void> {
  const client = getQueryableClient(db?.$client);
  if (!client) {
    return;
  }

  try {
    for (const statement of getNotificationIdentityAlterStatements()) {
      await client.query(statement);
    }
  } catch (error) {
    if (!isIfNotExistsSyntaxError(error)) {
      if (isDuplicateColumnError(error)) return;
      throw error;
    }

    await ensureNotificationIdentityColumnsWithMetadata(client);
  }
}

async function ensureNotificationIdentityColumnsWithMetadata(client: QueryableClient): Promise<void> {
  const databaseName = await getCurrentDatabaseName(client);
  if (!databaseName) {
    return;
  }

  const placeholders = notificationIdentityColumns.map(() => '(?, ?)').join(', ');
  const values = notificationIdentityColumns.flatMap(({ tableName, columnName }) => [tableName, columnName]);
  const [rows] = await client.query(
    `
      SELECT table_name AS tableName, column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = ?
        AND (table_name, column_name) IN (${placeholders})
    `.trim(),
    [databaseName, ...values],
  );
  const typedRows = rows as InformationSchemaRow[];

  const existingColumns = new Set(
    typedRows.map((row) => `${row.tableName || ''}.${row.columnName || ''}`),
  );

  for (const { tableName, columnName } of notificationIdentityColumns) {
    if (existingColumns.has(`${tableName}.${columnName}`)) {
      continue;
    }

    try {
      await client.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} varchar(36) NULL`);
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error;
      }
    }
  }
}

async function getCurrentDatabaseName(client: QueryableClient): Promise<string | null> {
  const [rows] = await client.query('SELECT DATABASE() AS databaseName');
  return (rows as DatabaseNameRow[])[0]?.databaseName || null;
}

function isDuplicateColumnError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ER_DUP_FIELDNAME';
}

function isIfNotExistsSyntaxError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const message = String((error as { sqlMessage?: string; message?: string }).sqlMessage || (error as { message?: string }).message || '');
  return message.includes('IF NOT EXISTS');
}

function getQueryableClient(value: unknown): QueryableClient | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const query = (value as { query?: unknown }).query;
  if (typeof query !== 'function') {
    return null;
  }

  return value as QueryableClient;
}
