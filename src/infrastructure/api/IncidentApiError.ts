/**
 * Fallos distinguibles del cliente HTTP de incidencias. El mensaje es fijo: nunca lleva
 * la URL, el cuerpo de la respuesta ni la excepción original.
 */
export type IncidentApiErrorKind =
  | 'NetworkError'
  | 'TimeoutError'
  | 'ContractViolationError'
  | 'UnauthorizedError'
  | 'RateLimitedError'
  | 'ServerError'
  | 'RejectedError';

export class IncidentApiError extends Error {
  readonly kind: IncidentApiErrorKind;
  readonly status: number | undefined;

  constructor(kind: IncidentApiErrorKind, status?: number) {
    super(`incident_api_${kind}`);
    this.name = 'IncidentApiError';
    this.kind = kind;
    this.status = status;
  }
}

export function isIncidentApiError(value: unknown): value is IncidentApiError {
  return value instanceof IncidentApiError;
}
