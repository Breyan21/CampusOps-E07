import type { JsonObject, ParseResult } from '../../course-evaluation/contracts';

const CONTRACT_ERROR: ParseResult = { ok: false, error: 'contract' };

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Valida el sobre de transporte `{ id, version, status, payload }` publicado en docs/CAMPUSOPS_API.md.
 * Sólo copia los campos conocidos: los campos futuros del sobre se ignoran sin fallar.
 * No valida el contenido del payload; eso corresponde al mapeo DTO → dominio.
 */
export function parseRemoteResource(input: unknown): ParseResult {
  if (!isPlainObject(input)) return CONTRACT_ERROR;
  const { id, version, status, payload } = input;
  if (!isNonEmptyString(id) || !isNonEmptyString(status)) return CONTRACT_ERROR;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return CONTRACT_ERROR;
  if (payload !== null && !isPlainObject(payload)) return CONTRACT_ERROR;
  return { ok: true, value: { id, version, status, payload } };
}
