/** @jest-environment node */

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openOperationQueue,
  type IncidentSnapshot,
  type NewPendingOperation,
} from '../../src/infrastructure/storage/OperationQueueStorage';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

type SQLiteValue = string | number | null;

type SqlExecutor = Readonly<{
  execAsync: (source: string) => Promise<void>;
  runAsync: (source: string, params?: SQLiteValue[]) => Promise<unknown>;
  getFirstAsync: <T>(source: string, params?: SQLiteValue[]) => Promise<T | null>;
  getAllAsync: <T>(source: string, params?: SQLiteValue[]) => Promise<T[]>;
}>;

class NodeSQLiteDatabase implements SqlExecutor {
  private readonly connection: DatabaseSync;
  private closed = false;

  constructor(path: string) {
    this.connection = new DatabaseSync(path);
  }

  async execAsync(source: string): Promise<void> {
    this.connection.exec(source);
  }

  async runAsync(source: string, params: SQLiteValue[] = []): Promise<unknown> {
    return this.connection.prepare(source).run(...params);
  }

  async getFirstAsync<T>(source: string, params: SQLiteValue[] = []): Promise<T | null> {
    const result = this.connection.prepare(source).get(...params);
    return result === undefined ? null : result as T;
  }

  async getAllAsync<T>(source: string, params: SQLiteValue[] = []): Promise<T[]> {
    return this.connection.prepare(source).all(...params) as T[];
  }

  async closeAsync(): Promise<void> {
    if (this.closed) return;
    this.connection.close();
    this.closed = true;
  }

  async withExclusiveTransactionAsync(
    task: (transaction: SqlExecutor) => Promise<void>,
  ): Promise<void> {
    this.connection.exec('BEGIN EXCLUSIVE');
    try {
      await task(this);
      this.connection.exec('COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
}

class FailingMigrationDatabase extends NodeSQLiteDatabase {
  private failOnQueueColumn = true;

  override async execAsync(source: string): Promise<void> {
    if (this.failOnQueueColumn && source.includes('ALTER TABLE operation_queue')) {
      this.failOnQueueColumn = false;
      throw new Error('injected migration failure');
    }
    await super.execAsync(source);
  }
}

const pendingOperation: NewPendingOperation = {
  operationId: 'offline-start-001',
  incidentId: 'campus-inc-001',
  author: 'technician-1',
  payload: { status: 'in_progress', notes: 'Started offline' },
  baseVersion: 7,
};

let temporaryDirectory: string;
let openDatabases: NodeSQLiteDatabase[];

function createDatabase(fileName = 'campusops.db'): NodeSQLiteDatabase {
  const database = new NodeSQLiteDatabase(join(temporaryDirectory, fileName));
  openDatabases.push(database);
  return database;
}

async function seedVersionOne(database: NodeSQLiteDatabase): Promise<void> {
  await database.execAsync(`
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
    INSERT INTO incident_snapshots (incident_id, server_version, snapshot_json)
      VALUES ('campus-inc-001', 7, '{"status":"assigned"}');
    INSERT INTO operation_queue
      (operation_id, incident_id, author, payload_json, base_version)
      VALUES ('offline-start-001', 'campus-inc-001', 'technician-1',
              '{"status":"in_progress","notes":"Started offline"}', 7);
    PRAGMA user_version = 1;
  `);
}

async function getSchemaVersion(database: NodeSQLiteDatabase): Promise<number> {
  const result = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (!result) throw new Error('SQLite did not return user_version');
  return result.user_version;
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'campusops-week08-'));
  openDatabases = [];
});

afterEach(async () => {
  await Promise.all(openDatabases.map((database) => database.closeAsync()));
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('migrates schema v1 to v2 and preserves snapshots and queued operations', async () => {
  const database = createDatabase();
  await seedVersionOne(database);

  const queue = await openOperationQueue(database);
  const operations = await queue.getPendingOperations();
  const snapshot = await queue.getIncidentSnapshot('campus-inc-001');

  expect(await getSchemaVersion(database)).toBe(2);
  expect(operations).toHaveLength(1);
  expect(operations[0]).toMatchObject(pendingOperation);
  expect(operations[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(snapshot).toMatchObject({
    incidentId: 'campus-inc-001',
    version: 7,
    snapshot: { status: 'assigned' },
  });
  expect(snapshot?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('rolls back a failed migration, retains v1 data, and succeeds on retry', async () => {
  const failingDatabase = new FailingMigrationDatabase(join(temporaryDirectory, 'failure.db'));
  openDatabases.push(failingDatabase);
  await seedVersionOne(failingDatabase);

  await expect(openOperationQueue(failingDatabase)).rejects.toThrow('injected migration failure');
  expect(await getSchemaVersion(failingDatabase)).toBe(1);
  const columns = await failingDatabase.getAllAsync<{ name: string }>(
    'PRAGMA table_info(incident_snapshots)',
  );
  expect(columns.map(({ name }) => name)).not.toContain('updated_at');
  const oldOperation = await failingDatabase.getFirstAsync<{ operation_id: string }>(
    'SELECT operation_id FROM operation_queue',
  );
  expect(oldOperation).toEqual({ operation_id: 'offline-start-001' });

  const recoveredQueue = await openOperationQueue(failingDatabase);
  expect(await getSchemaVersion(failingDatabase)).toBe(2);
  expect(await recoveredQueue.getPendingOperations()).toHaveLength(1);
});

test('restores the same operation after closing and reopening the SQLite database', async () => {
  const path = join(temporaryDirectory, 'restart.db');
  const firstConnection = new NodeSQLiteDatabase(path);
  openDatabases.push(firstConnection);
  const firstQueue = await openOperationQueue(firstConnection);
  const saved = await firstQueue.enqueue(pendingOperation);
  await firstQueue.saveIncidentSnapshot({
    incidentId: 'campus-inc-001',
    version: 7,
    snapshot: { status: 'assigned', priority: 'high' },
  });
  await firstQueue.close();

  const reopenedConnection = new NodeSQLiteDatabase(path);
  openDatabases.push(reopenedConnection);
  const reopenedQueue = await openOperationQueue(reopenedConnection);

  expect(await reopenedQueue.getPendingOperations()).toEqual([saved]);
  expect(await reopenedQueue.getIncidentSnapshot('campus-inc-001')).toMatchObject({
    version: 7,
    snapshot: { status: 'assigned', priority: 'high' },
  } satisfies Partial<IncidentSnapshot>);
});

test('keeps the first persisted operation when an operationId is replayed', async () => {
  const database = createDatabase();
  const queue = await openOperationQueue(database);
  const first = await queue.enqueue(pendingOperation);
  const duplicate = await queue.enqueue({
    ...pendingOperation,
    payload: { status: 'resolved' },
    baseVersion: 8,
  });

  expect(duplicate).toEqual(first);
  expect(await queue.getPendingOperations()).toEqual([first]);
});

test('rejects invalid queue entries without storing them', async () => {
  const database = createDatabase();
  const queue = await openOperationQueue(database);

  await expect(queue.enqueue({ ...pendingOperation, operationId: '  ' })).rejects.toThrow(
    'operationId must be a non-empty string',
  );
  await expect(queue.enqueue({ ...pendingOperation, baseVersion: -1 })).rejects.toThrow(
    'Version must be a non-negative safe integer',
  );
  expect(await queue.getPendingOperations()).toEqual([]);
});
