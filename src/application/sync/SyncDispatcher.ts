import type { JsonObject, SyncRecord } from '../../course-evaluation/contracts';
import { resolveSync } from '../../course-evaluation';
import type { OperationQueueStorage, PendingOperation } from '../../infrastructure/storage/OperationQueueStorage';

export type SyncResult =
  | Readonly<{ status: 'confirmed'; operationId: string; incidentId: string }>
  | Readonly<{ status: 'conflict'; operationId: string; incidentId: string; conflictFields: readonly string[] }>
  | Readonly<{ status: 'network_error'; operationId: string; incidentId: string; error: string }>;

export type SyncSummary = Readonly<{
  total: number;
  confirmed: number;
  conflicts: number;
  errors: number;
  results: readonly SyncResult[];
}>;

export type RemoteIncidentFetcher = (incidentId: string) => Promise<SyncRecord | null>;
export type ActionSender = (params: {
  incidentId: string;
  operationId: string;
  action: string;
  baseVersion: number;
  author: string;
  payload: JsonObject;
}) => Promise<{ ok: boolean; status: number; version?: number; fields?: JsonObject; error?: string }>;

export class SyncDispatcher {
  constructor(
    private readonly queueStorage: OperationQueueStorage,
    private readonly fetchRemote: RemoteIncidentFetcher,
    private readonly sendAction: ActionSender,
  ) {}

  async dispatchAll(): Promise<SyncSummary> {
    const pending = await this.queueStorage.getPendingOperations();
    const results: SyncResult[] = [];

    let confirmedCount = 0;
    let conflictCount = 0;
    let errorCount = 0;

    for (const op of pending) {
      const result = await this.dispatchOperation(op);
      results.push(result);

      if (result.status === 'confirmed') {
        confirmedCount++;
      } else if (result.status === 'conflict') {
        conflictCount++;
      } else {
        errorCount++;
      }
    }

    return {
      total: pending.length,
      confirmed: confirmedCount,
      conflicts: conflictCount,
      errors: errorCount,
      results,
    };
  }

  private async dispatchOperation(op: PendingOperation): Promise<SyncResult> {
    try {
      // 1. Obtener snapshot base almacenado localmente
      const localSnapshot = await this.queueStorage.getIncidentSnapshot(op.incidentId);
      const baseFields: JsonObject = localSnapshot?.snapshot ?? {};
      const baseRecord: SyncRecord = {
        id: op.incidentId,
        version: localSnapshot?.version ?? op.baseVersion,
        fields: baseFields,
      };

      // 2. Obtener estado remoto actual
      const remoteRecord = await this.fetchRemote(op.incidentId);

      // Si existe estado remoto y su version difiere de la base, evaluamos con resolveSync antes de enviar
      if (remoteRecord && remoteRecord.version > op.baseVersion) {
        const localRecord: SyncRecord = {
          id: op.incidentId,
          version: op.baseVersion,
          fields: {
            ...baseFields,
            ...op.payload,
          },
        };

        const syncResolution = resolveSync(baseRecord, localRecord, remoteRecord);
        if (syncResolution.kind === 'conflict') {
          // CONFLICTO DETECTADO: NO se retira de la cola; se conserva intacta
          return {
            status: 'conflict',
            operationId: op.operationId,
            incidentId: op.incidentId,
            conflictFields: syncResolution.fields,
          };
        }
      }

      // 3. Enviar al backend con Idempotency-Key
      const response = await this.sendAction({
        incidentId: op.incidentId,
        operationId: op.operationId,
        action: String(op.payload['action'] ?? 'update'),
        baseVersion: op.baseVersion,
        author: op.author,
        payload: op.payload,
      });

      if (response.ok && response.status >= 200 && response.status < 300) {
        // CONFIRMADO: SOLO en este caso se retira de la cola
        await this.queueStorage.removeOperation(op.operationId);

        if (response.version !== undefined && response.fields) {
          await this.queueStorage.saveIncidentSnapshot({
            incidentId: op.incidentId,
            version: response.version,
            snapshot: response.fields,
          });
        }

        return {
          status: 'confirmed',
          operationId: op.operationId,
          incidentId: op.incidentId,
        };
      }

      if (response.status === 409) {
        // Conflicto de versión reportado por el backend: NO se retira de la cola
        return {
          status: 'conflict',
          operationId: op.operationId,
          incidentId: op.incidentId,
          conflictFields: ['work'],
        };
      }

      // Error 5xx o timeout: NO se retira de la cola
      return {
        status: 'network_error',
        operationId: op.operationId,
        incidentId: op.incidentId,
        error: response.error ?? `HTTP ${response.status}`,
      };
    } catch (err: unknown) {
      // Error de red no controlado: la operacion PERMANECE en cola
      return {
        status: 'network_error',
        operationId: op.operationId,
        incidentId: op.incidentId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
