import type { JsonObject } from '../../course-evaluation/contracts';

export type OperationStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';

export interface QueuedOperation {
  readonly operationId: string;
  readonly incidentId: string;
  readonly author: string;
  readonly action: string;
  readonly payload: JsonObject;
  readonly baseVersion: number;
  readonly createdAt: string;
  readonly status: OperationStatus;
  readonly retryCount: number;
}

export interface OperationQueueStore {
  saveAll(operations: readonly QueuedOperation[]): Promise<boolean>;
  loadAll(): Promise<readonly QueuedOperation[]>;
  clear(): Promise<boolean>;
}
