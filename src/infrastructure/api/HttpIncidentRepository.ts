import { logSafeTelemetry } from '../../telemetry/safeTelemetry';
import { IncidentApiError, isIncidentApiError } from './IncidentApiError';
import {
  type CreateIncidentRequestDto,
  type CreateIncidentResponseDto,
  type IncidentListResponseDto,
  type IncidentResourceDto,
  parseCreateIncidentResponse,
  parseIncidentList,
  parseIncidentResource,
} from './incidentDtos';

export const DEFAULT_TIMEOUT_MS = 5000;

export type HttpIncidentRepositoryOptions = Readonly<{
  baseUrl: string;
  // Sesión sintética del backend didáctico (fixtures públicos, no credenciales reales).
  accessToken: string;
  actorId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  // Sólo para pruebas: selecciona una variante pública del simulador (X-Course-Scenario).
  scenario?: string;
}>;

type Operation = 'list' | 'detail' | 'create';

const NOT_FOUND = Symbol('not_found');

/**
 * Cliente HTTP de incidencias. Devuelve únicamente DTOs con el sobre ya validado y
 * representa cada falla como IncidentApiError; nunca deja escapar la excepción original.
 */
export class HttpIncidentRepository {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpIncidentRepositoryOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  async getAll(): Promise<IncidentListResponseDto> {
    return this.request('list', '/v1/incidents', { method: 'GET' }, parseIncidentList);
  }

  // 404 se representa como null ("no encontrada"), no como error.
  async getById(id: string): Promise<IncidentResourceDto | null> {
    const path = `/v1/incidents/${encodeURIComponent(id)}`;
    return this.request<IncidentResourceDto | null>('detail', path, { method: 'GET' }, parseIncidentResource, () => null);
  }

  // La clave la provee quien invoca y debe ser estable al repetir el mismo envío.
  async create(body: CreateIncidentRequestDto, idempotencyKey: string): Promise<CreateIncidentResponseDto> {
    return this.request('create', '/v1/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }, parseCreateIncidentResponse);
  }

  private async request<T>(
    operation: Operation,
    path: string,
    init: RequestInit,
    parse: (body: unknown) => T,
    onNotFound?: () => T,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const body = await this.send(path, init, onNotFound !== undefined);
      return body === NOT_FOUND && onNotFound ? onNotFound() : parse(body);
    } catch (error) {
      // Cualquier excepción no prevista (p. ej. un parser) se reduce a una violación de contrato.
      const failure = isIncidentApiError(error) ? error : new IncidentApiError('ContractViolationError');
      logSafeTelemetry('incident_api_failed', {
        operation,
        kind: failure.kind,
        status: failure.status ?? null,
        durationMs: Date.now() - startedAt,
      });
      throw failure;
    }
  }

  private async send(path: string, init: RequestInit, notFoundAsNull: boolean): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
          ...init,
          headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
          signal: controller.signal,
        });
      } catch {
        // Se descarta la causa original: trae host, puerto y stack.
        throw new IncidentApiError(controller.signal.aborted ? 'TimeoutError' : 'NetworkError');
      }
      // Sin código HTTP (status 0 o ausente) la respuesta no llegó del servidor: es falla de red.
      if (typeof response.status !== 'number' || response.status === 0) throw new IncidentApiError('NetworkError');
      if (notFoundAsNull && response.status === 404) return NOT_FOUND;
      if (!response.ok) throw failureForStatus(response.status);
      try {
        return await response.json();
      } catch {
        throw new IncidentApiError(controller.signal.aborted ? 'TimeoutError' : 'ContractViolationError');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.options.accessToken}`,
      'X-Course-Actor': this.options.actorId,
      ...(this.options.scenario ? { 'X-Course-Scenario': this.options.scenario } : {}),
    };
  }
}

function failureForStatus(status: number): IncidentApiError {
  if (status === 401 || status === 403) return new IncidentApiError('UnauthorizedError', status);
  if (status === 429) return new IncidentApiError('RateLimitedError', status);
  if (status >= 500) return new IncidentApiError('ServerError', status);
  return new IncidentApiError('RejectedError', status);
}
