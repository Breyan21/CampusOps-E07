import type { JsonObject } from '../../course-evaluation/contracts';
import { IncidentApiError } from './IncidentApiError';
import { parseRemoteResource } from './remoteResource';

/** DTOs: forma exacta del transporte publicado en docs/CAMPUSOPS_API.md. */
export type IncidentCategoryDto =
  | 'electrical' | 'laboratory' | 'water' | 'connectivity'
  | 'equipment' | 'safety' | 'maintenance';

export type CreateIncidentRequestDto = Readonly<{
  category: IncidentCategoryDto;
  description: string;
  location: string;
}>;

export type IncidentResourceDto = Readonly<{
  id: string;
  version: number;
  status: string;
  payload: JsonObject | null;
}>;

export type IncidentListResponseDto = Readonly<{ items: readonly IncidentResourceDto[] }>;

export type CreateIncidentResponseDto = Readonly<{
  incident: IncidentResourceDto;
  operationId: string;
  duplicate: boolean;
}>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Valida el sobre; un sobre inválido es violación de contrato. Payload null es válido. */
export function parseIncidentResource(input: unknown): IncidentResourceDto {
  const parsed = parseRemoteResource(input);
  if (!parsed.ok) throw new IncidentApiError('ContractViolationError');
  return parsed.value;
}

/** `GET /v1/incidents` → `{ items: [...] }`; cada elemento debe cumplir el sobre. */
export function parseIncidentList(input: unknown): IncidentListResponseDto {
  if (!isPlainObject(input) || !Array.isArray(input.items)) throw new IncidentApiError('ContractViolationError');
  return { items: input.items.map(parseIncidentResource) };
}

/** `POST /v1/incidents` → `{ incident, operationId, duplicate }`. */
export function parseCreateIncidentResponse(input: unknown): CreateIncidentResponseDto {
  if (!isPlainObject(input) || typeof input.operationId !== 'string' || typeof input.duplicate !== 'boolean') {
    throw new IncidentApiError('ContractViolationError');
  }
  return { incident: parseIncidentResource(input.incident), operationId: input.operationId, duplicate: input.duplicate };
}
