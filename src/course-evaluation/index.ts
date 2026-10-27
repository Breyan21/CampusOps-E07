import type {
  AuthEvent,
  JsonObject,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
  SyncRecord,
} from './contracts';
import type { IncidentLocation } from '../campusops/contracts';
import { parseRemoteResource as parseIncidentEnvelope } from '../infrastructure/api/remoteResource';

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

export function redactForTelemetry(input: unknown): unknown {
  const sensitiveKeys = new Set(['authorization', 'password', 'token', 'accesstoken', 'refreshtoken', 'email', 'displayname', 'name', 'userid', 'reporterid', 'technicianid', 'assignedtechnicianid', 'location', 'latitude', 'longitude', 'photos', 'evidence', 'internalcomments', 'assignmenthistory']);
  const redact = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(redact);
    const copy: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      copy[key] = sensitiveKeys.has(key.replace(/[-_]/g, '').toLowerCase())
        ? '[REDACTED]'
        : redact(nestedValue);
    }
    return copy;
  };
  return redact(input);
}

// Adaptador: delega en el mismo parser que usa HttpIncidentRepository.
export function parseRemoteResource(input: unknown): ParseResult {
  return parseIncidentEnvelope(input);
}

// Single-flight: los 401 concurrentes comparten una sola renovación y cada solicitud se reintenta una vez.
export function coordinateRefresh(events: readonly AuthEvent[]): Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}> {
  let status: 'anonymous' | 'authenticated' = 'authenticated';
  let activeGeneration: number | null = 0;
  let refreshCalls = 0;
  const retriedRequestIds: string[] = [];
  let persistedToken: string | null = null;
  let isRefreshing = false;

  for (const event of events) {
    if (event.type === 'request401') {
      if (!isRefreshing) {
        isRefreshing = true;
        refreshCalls++;
      }
      if (event.requestId !== undefined && !retriedRequestIds.includes(event.requestId)) {
        retriedRequestIds.push(event.requestId);
      }
    } else if (event.type === 'refreshSucceeded') {
      isRefreshing = false;
      activeGeneration = event.generation ?? activeGeneration;
      persistedToken = event.token ?? null;
      status = 'authenticated';
    } else {
      // refreshFailed o logout: la sesión se descarta por completo.
      isRefreshing = false;
      activeGeneration = null;
      persistedToken = null;
      status = 'anonymous';
    }
  }

  return { status, activeGeneration, refreshCalls, retriedRequestIds, persistedToken };
}

export function resolveSync(
  base: SyncRecord,
  local: SyncRecord,
  remote: SyncRecord,
): Readonly<{ kind: 'merged'; fields: JsonObject } | { kind: 'conflict'; fields: readonly string[] }> {
  const fieldNames = [...new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ])].sort();
  const conflicts: string[] = [];
  const mergedEntries: [string, unknown][] = [];

  for (const field of fieldNames) {
    const baseHasField = Object.prototype.hasOwnProperty.call(base.fields, field);
    const localHasField = Object.prototype.hasOwnProperty.call(local.fields, field);
    const remoteHasField = Object.prototype.hasOwnProperty.call(remote.fields, field);
    const localChanged = !sameFieldValue(
      baseHasField,
      base.fields[field],
      localHasField,
      local.fields[field],
    );
    const remoteChanged = !sameFieldValue(
      baseHasField,
      base.fields[field],
      remoteHasField,
      remote.fields[field],
    );

    if (
      localChanged
      && remoteChanged
      && !sameFieldValue(localHasField, local.fields[field], remoteHasField, remote.fields[field])
    ) {
      conflicts.push(field);
      continue;
    }

    const useLocal = localChanged;
    const hasMergedField = useLocal ? localHasField : remoteHasField;
    if (hasMergedField) {
      mergedEntries.push([field, useLocal ? local.fields[field] : remote.fields[field]]);
    }
  }

  return conflicts.length > 0
    ? { kind: 'conflict', fields: conflicts }
    : { kind: 'merged', fields: Object.fromEntries(mergedEntries) };
}

export function deduplicateOperations<T extends Readonly<{ operationId: string }>>(
  operations: readonly T[],
): readonly T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const operation of operations) {
    if (!seen.has(operation.operationId)) {
      seen.add(operation.operationId);
      unique.push(operation);
    }
  }

  return unique;
}

function sameFieldValue(
  leftExists: boolean,
  left: unknown,
  rightExists: boolean,
  right: unknown,
): boolean {
  return leftExists === rightExists && (!leftExists || areJsonValuesEqual(left, right));
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areJsonValuesEqual(value, right[index]));
  }
  if (
    left === null
    || right === null
    || typeof left !== 'object'
    || typeof right !== 'object'
  ) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(right, key)
      && areJsonValuesEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      )
    ));
}

export function planRetry(_input: Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>): Readonly<{ retry: boolean; delayMs: number; requiresStableIdempotencyKey: boolean }> {
  return pending('planRetry');
}

export function reduceRemoteResponses(_input: Readonly<{
  activeRequestId: string;
  responses: readonly RemoteResponse[];
}>): Readonly<{ state: 'success' | 'error' | 'loading'; value?: unknown; error?: string }> {
  return pending('reduceRemoteResponses');
}

export function reducePermissionLifecycle(
  _events: readonly PermissionEvent[],
): Readonly<{ status: 'available' | 'denied' | 'blocked'; resourceActive: boolean }> {
  return pending('reducePermissionLifecycle');
}

/** Week 09: see docs/CAMPUSOPS_API.md; this is not a completed solution. */
export function selectIncidentLocation(_provider: unknown, _manualLabel: string): IncidentLocation {
  return pending('selectIncidentLocation');
}
