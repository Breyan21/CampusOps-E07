import * as SecureStore from 'expo-secure-store';
import type { JsonObject } from '../../course-evaluation/contracts';
import { deduplicateOperations } from '../../course-evaluation';
import type { OperationQueueStore, OperationStatus, QueuedOperation } from '../../domain/sync/types';

const QUEUE_STORAGE_KEY = 'campusops.offline.queue';
const SCHEMA_VERSION_KEY = 'campusops.offline.schemaVersion';
export const CURRENT_SCHEMA_VERSION = 2;

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class SecureStoreQueueStore implements OperationQueueStore {
  async saveAll(operations: readonly QueuedOperation[]): Promise<boolean> {
    try {
      const data = JSON.stringify(operations);
      await SecureStore.setItemAsync(QUEUE_STORAGE_KEY, data, STORE_OPTIONS);
      await SecureStore.setItemAsync(SCHEMA_VERSION_KEY, String(CURRENT_SCHEMA_VERSION), STORE_OPTIONS);
      return true;
    } catch {
      return false;
    }
  }

  async loadAll(): Promise<readonly QueuedOperation[]> {
    try {
      const raw = await SecureStore.getItemAsync(QUEUE_STORAGE_KEY, STORE_OPTIONS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async clear(): Promise<boolean> {
    try {
      await SecureStore.deleteItemAsync(QUEUE_STORAGE_KEY, STORE_OPTIONS);
      return true;
    } catch {
      return false;
    }
  }
}

export class InMemoryQueueStore implements OperationQueueStore {
  private items: QueuedOperation[] = [];

  async saveAll(operations: readonly QueuedOperation[]): Promise<boolean> {
    this.items = [...operations];
    return true;
  }

  async loadAll(): Promise<readonly QueuedOperation[]> {
    return [...this.items];
  }

  async clear(): Promise<boolean> {
    this.items = [];
    return true;
  }
}

export class PersistentOperationQueue {
  private queue: QueuedOperation[] = [];
  private readonly store: OperationQueueStore;
  private initialized = false;

  constructor(store?: OperationQueueStore) {
    this.store = store ?? new SecureStoreQueueStore();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const loaded = await this.store.loadAll();
    this.queue = deduplicateOperations(loaded) as QueuedOperation[];
    this.initialized = true;
  }

  async enqueue(params: {
    incidentId: string;
    author: string;
    action: string;
    payload: JsonObject;
    baseVersion: number;
    operationId?: string;
  }): Promise<QueuedOperation> {
    await this.initialize();
    const operation: QueuedOperation = {
      operationId: params.operationId ?? `op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      incidentId: params.incidentId,
      author: params.author,
      action: params.action,
      payload: params.payload,
      baseVersion: params.baseVersion,
      createdAt: new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
    };

    // Deduplicar: si ya existe la operacion con ese operationId, conservamos la primera
    const existing = this.queue.find((op) => op.operationId === operation.operationId);
    if (!existing) {
      this.queue.push(operation);
      await this.store.saveAll(this.queue);
      return operation;
    }

    return existing;
  }

  async getPending(): Promise<readonly QueuedOperation[]> {
    await this.initialize();
    return this.queue.filter((op) => op.status === 'pending');
  }

  async getAll(): Promise<readonly QueuedOperation[]> {
    await this.initialize();
    return [...this.queue];
  }

  async markStatus(operationId: string, status: OperationStatus): Promise<boolean> {
    await this.initialize();
    const op = this.queue.find((item) => item.operationId === operationId);
    if (!op) return false;
    const updated: QueuedOperation = { ...op, status };
    this.queue = this.queue.map((item) => (item.operationId === operationId ? updated : item));
    await this.store.saveAll(this.queue);
    return true;
  }

  async remove(operationId: string): Promise<boolean> {
    await this.initialize();
    const initialLength = this.queue.length;
    this.queue = this.queue.filter((op) => op.operationId !== operationId);
    if (this.queue.length !== initialLength) {
      await this.store.saveAll(this.queue);
      return true;
    }
    return false;
  }

  async clear(): Promise<boolean> {
    this.queue = [];
    return await this.store.clear();
  }
}
