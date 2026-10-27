/** @jest-environment node */

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openOperationQueue, type OperationQueueStorage } from '../src/infrastructure/storage/OperationQueueStorage';
import { SyncDispatcher } from '../src/application/sync/SyncDispatcher';

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

describe('SyncDispatcher (Semana 08)', () => {
  let tempDir: string;
  let dbPath: string;
  let database: NodeSQLiteDatabase;
  let queueStorage: OperationQueueStorage;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'campusops-sync-'));
    dbPath = join(tempDir, 'test.db');
    database = new NodeSQLiteDatabase(dbPath);
    queueStorage = await openOperationQueue(database);
  });

  afterEach(async () => {
    await queueStorage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('sincronizacion confirmada retira la operacion de la cola y actualiza el snapshot', async () => {
    // 1. Guardar snapshot base
    await queueStorage.saveIncidentSnapshot({
      incidentId: 'campus-inc-001',
      version: 1,
      snapshot: { status: 'assigned', assignedTechnicianId: 'technician-1' },
    });

    // 2. Encolar operacion offline
    await queueStorage.enqueue({
      operationId: 'op-start-1',
      incidentId: 'campus-inc-001',
      author: 'technician-1',
      payload: { action: 'start', status: 'in_progress' },
      baseVersion: 1,
    });

    const pendingBefore = await queueStorage.getPendingOperations();
    expect(pendingBefore.length).toBe(1);

    // Mock fetcher (servidor en version 1, sin cambios remotos previos)
    const fetchRemote = jest.fn().mockResolvedValue({
      id: 'campus-inc-001',
      version: 1,
      fields: { status: 'assigned', assignedTechnicianId: 'technician-1' },
    });

    // Mock sender (servidor confirma con 200 y devuelve version 2)
    const sendAction = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      version: 2,
      fields: { status: 'in_progress', assignedTechnicianId: 'technician-1' },
    });

    const dispatcher = new SyncDispatcher(queueStorage, fetchRemote, sendAction);
    const summary = await dispatcher.dispatchAll();

    expect(summary.total).toBe(1);
    expect(summary.confirmed).toBe(1);
    expect(summary.conflicts).toBe(0);

    // Verificamos que se retiro de la cola
    const pendingAfter = await queueStorage.getPendingOperations();
    expect(pendingAfter.length).toBe(0);

    // Verificamos que se actualizo el snapshot
    const updatedSnapshot = await queueStorage.getIncidentSnapshot('campus-inc-001');
    expect(updatedSnapshot?.version).toBe(2);
    expect(updatedSnapshot?.snapshot['status']).toBe('in_progress');
  });

  test('conflicto por reasignacion remota conserva la operacion en la cola sin descartarla', async () => {
    // 1. Snapshot base comun: version 1, assigned a technician-1
    await queueStorage.saveIncidentSnapshot({
      incidentId: 'campus-inc-001',
      version: 1,
      snapshot: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' } },
    });

    // 2. Tecnico inicia atencion localmente (in_progress)
    await queueStorage.enqueue({
      operationId: 'op-start-conflict',
      incidentId: 'campus-inc-001',
      author: 'technician-1',
      payload: { action: 'start', work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } },
      baseVersion: 1,
    });

    // 3. Remoto ya esta en version 2 (coordinacion reasigno a technician-2)
    const fetchRemote = jest.fn().mockResolvedValue({
      id: 'campus-inc-001',
      version: 2,
      fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' } },
    });

    const sendAction = jest.fn();

    const dispatcher = new SyncDispatcher(queueStorage, fetchRemote, sendAction);
    const summary = await dispatcher.dispatchAll();

    expect(summary.conflicts).toBe(1);
    expect(summary.confirmed).toBe(0);
    expect(summary.results[0]?.status).toBe('conflict');

    // Regla de oro: NO enviar ni descartar de la cola si hay conflicto detectado
    expect(sendAction).not.toHaveBeenCalled();
    const pendingAfter = await queueStorage.getPendingOperations();
    expect(pendingAfter.length).toBe(1);
    expect(pendingAfter[0]?.operationId).toBe('op-start-conflict');
  });

  test('error de red o 500 no descarta la operacion de la cola', async () => {
    await queueStorage.enqueue({
      operationId: 'op-offline-retry',
      incidentId: 'campus-inc-002',
      author: 'technician-1',
      payload: { action: 'start', status: 'in_progress' },
      baseVersion: 1,
    });

    const fetchRemote = jest.fn().mockResolvedValue(null);
    const sendAction = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      error: 'Service Unavailable',
    });

    const dispatcher = new SyncDispatcher(queueStorage, fetchRemote, sendAction);
    const summary = await dispatcher.dispatchAll();

    expect(summary.errors).toBe(1);
    expect(summary.confirmed).toBe(0);

    // La operacion PERMANECE en cola
    const pendingAfter = await queueStorage.getPendingOperations();
    expect(pendingAfter.length).toBe(1);
  });
});
