import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'campusops.db';
export const LOCAL_SCHEMA_VERSION = 2;

type SQLiteValue = string | number | null;

type SqlExecutor = Readonly<{
  execAsync: (source: string) => Promise<void>;
  runAsync: (source: string, params: SQLiteValue[]) => Promise<unknown>;
  getFirstAsync: <T>(source: string, params: SQLiteValue[]) => Promise<T | null>;
  getAllAsync: <T>(source: string, params: SQLiteValue[]) => Promise<T[]>;
}>;

type QueueDatabase = SqlExecutor & Readonly<{
  withExclusiveTransactionAsync: (
    task: (transaction: SqlExecutor) => Promise<void>,
  ) => Promise<void>;
  closeAsync: () => Promise<void>;
}>;

export type OperationPayload = Readonly<Record<string, unknown>>;

export type PendingOperation = Readonly<{
  operationId: string;
  incidentId: string;
  author: string;
  payload: OperationPayload;
  baseVersion: number;
  createdAt: string;
}>;

export type NewPendingOperation = Omit<PendingOperation, 'createdAt'>;

export type IncidentSnapshot = Readonly<{
  incidentId: string;
  version: number;
  snapshot: OperationPayload;
  updatedAt: string;
}>;

type StoredOperation = Readonly<{
  operationId: string;
  incidentId: string;
  author: string;
  payloadJson: string;
  baseVersion: number;
  createdAt: string;
}>;

type StoredSnapshot = Readonly<{
  incidentId: string;
  version: number;
  snapshotJson: string;
  updatedAt: string;
}>;

export async function migrateLocalDatabase(database: QueueDatabase): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
      [],
    );
    let version = result?.user_version ?? 0;

    if (!Number.isInteger(version) || version < 0) {
      throw new Error(`Invalid local database schema version: ${String(version)}`);
    }
    if (version > LOCAL_SCHEMA_VERSION) {
      throw new Error(
        `Local database schema ${version} is newer than supported schema ${LOCAL_SCHEMA_VERSION}`,
      );
    }

    if (version < 1) {
      await transaction.execAsync(`
        CREATE TABLE incident_snapshots (
          incident_id TEXT PRIMARY KEY NOT NULL,
          server_version INTEGER NOT NULL CHECK (server_version >= 0),
          snapshot_json TEXT NOT NULL
        );
        CREATE TABLE operation_queue (
          operation_id TEXT PRIMARY KEY NOT NULL,
          incident_id TEXT NOT NULL,
          author TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          base_version INTEGER NOT NULL CHECK (base_version >= 0)
        );
        PRAGMA user_version = 1;
      `);
      version = 1;
    }

    if (version < 2) {
      await transaction.execAsync(
        "ALTER TABLE incident_snapshots ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';",
      );
      await transaction.execAsync(
        "ALTER TABLE operation_queue ADD COLUMN created_at TEXT NOT NULL DEFAULT '';",
      );
      await transaction.runAsync(
        "UPDATE incident_snapshots SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at = '';",
        [],
      );
      await transaction.runAsync(
        "UPDATE operation_queue SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE created_at = '';",
        [],
      );
      await transaction.execAsync(`
        CREATE INDEX operation_queue_incident_id_idx
          ON operation_queue (incident_id, created_at);
        PRAGMA user_version = 2;
      `);
    }
  });
}

export async function openOperationQueue(
  existingDatabase?: QueueDatabase,
): Promise<OperationQueueStorage> {
  const database = existingDatabase
    ?? await SQLite.openDatabaseAsync(DATABASE_NAME);
  await migrateLocalDatabase(database);
  return new OperationQueueStorage(database);
}

export class OperationQueueStorage {
  constructor(private readonly database: QueueDatabase) {}

  async enqueue(operation: NewPendingOperation): Promise<PendingOperation> {
    assertNonEmpty('operationId', operation.operationId);
    assertNonEmpty('incidentId', operation.incidentId);
    assertNonEmpty('author', operation.author);
    assertVersion(operation.baseVersion);
    const payloadJson = serializeObject(operation.payload, 'payload');

    await this.database.runAsync(
      `INSERT INTO operation_queue
        (operation_id, incident_id, author, payload_json, base_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(operation_id) DO NOTHING`,
      [
        operation.operationId,
        operation.incidentId,
        operation.author,
        payloadJson,
        operation.baseVersion,
        new Date().toISOString(),
      ],
    );

    const stored = await this.database.getFirstAsync<StoredOperation>(
      `SELECT operation_id AS operationId,
              incident_id AS incidentId,
              author,
              payload_json AS payloadJson,
              base_version AS baseVersion,
              created_at AS createdAt
       FROM operation_queue
       WHERE operation_id = ?`,
      [operation.operationId],
    );
    if (!stored) {
      throw new Error(`Operation ${operation.operationId} was not persisted`);
    }
    return decodeOperation(stored);
  }

  async getPendingOperations(): Promise<readonly PendingOperation[]> {
    const rows = await this.database.getAllAsync<StoredOperation>(
      `SELECT operation_id AS operationId,
              incident_id AS incidentId,
              author,
              payload_json AS payloadJson,
              base_version AS baseVersion,
              created_at AS createdAt
       FROM operation_queue
       ORDER BY created_at ASC, rowid ASC`,
      [],
    );
    return rows.map(decodeOperation);
  }

  async saveIncidentSnapshot(
    input: Readonly<{ incidentId: string; version: number; snapshot: OperationPayload }>,
  ): Promise<void> {
    assertNonEmpty('incidentId', input.incidentId);
    assertVersion(input.version);
    const snapshotJson = serializeObject(input.snapshot, 'snapshot');

    await this.database.runAsync(
      `INSERT INTO incident_snapshots
        (incident_id, server_version, snapshot_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(incident_id) DO UPDATE SET
         server_version = excluded.server_version,
         snapshot_json = excluded.snapshot_json,
         updated_at = excluded.updated_at
       WHERE excluded.server_version >= incident_snapshots.server_version`,
      [input.incidentId, input.version, snapshotJson, new Date().toISOString()],
    );
  }

  async getIncidentSnapshot(incidentId: string): Promise<IncidentSnapshot | null> {
    const stored = await this.database.getFirstAsync<StoredSnapshot>(
      `SELECT incident_id AS incidentId,
              server_version AS version,
              snapshot_json AS snapshotJson,
              updated_at AS updatedAt
       FROM incident_snapshots
       WHERE incident_id = ?`,
      [incidentId],
    );
    if (!stored) return null;

    return {
      incidentId: stored.incidentId,
      version: stored.version,
      snapshot: parseObject(stored.snapshotJson, 'incident snapshot'),
      updatedAt: stored.updatedAt,
    };
  }

  async removeOperation(operationId: string): Promise<boolean> {
    assertNonEmpty('operationId', operationId);
    await this.database.runAsync(
      'DELETE FROM operation_queue WHERE operation_id = ?',
      [operationId],
    );
    return true;
  }

  async close(): Promise<void> {
    await this.database.closeAsync();
  }
}

function assertNonEmpty(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new TypeError('Version must be a non-negative safe integer');
  }
}

function serializeObject(value: OperationPayload, name: string): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be a JSON object`);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError(`${name} must be JSON serializable`);
  }
  parseObject(serialized, name);
  return serialized;
}

function parseObject(serialized: string, name: string): OperationPayload {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Stored ${name} is not valid JSON`, { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Stored ${name} must be a JSON object`);
  }
  return value as OperationPayload;
}

function decodeOperation(stored: StoredOperation): PendingOperation {
  return {
    operationId: stored.operationId,
    incidentId: stored.incidentId,
    author: stored.author,
    payload: parseObject(stored.payloadJson, 'operation payload'),
    baseVersion: stored.baseVersion,
    createdAt: stored.createdAt,
  };
}
