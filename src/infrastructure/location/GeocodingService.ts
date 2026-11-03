/**
 * GeocodingService — Adaptador resiliente de geocodificación con caché en memoria.
 *
 * Implementa la integración con el servicio de geocodificación (GET /v1/geocoding?q=...)
 * y proporciona:
 * 1. Caché en memoria por consulta normalizada para mitigar consumo de cuota y errores 429.
 * 2. Evaluación determinista mediante selectIncidentLocation.
 * 3. Fallback a ubicación manual ante timeout, desconexión, 429 o respuestas inválidas,
 *    sin inventar coordenadas.
 * 4. Métodos para inspección y limpieza de caché requeridos en pruebas.
 *
 * @module infrastructure/location/GeocodingService
 */

import type {
  IncidentLocationSelection,
  ProviderIncidentLocation,
} from '../../domain/location/types';
import { selectIncidentLocation } from '../../course-evaluation';
import { logSafeTelemetry } from '../../telemetry/safeTelemetry';

export const DEFAULT_GEOCODING_TIMEOUT_MS = 3000;
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export type GeocodingServiceOptions = Readonly<{
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  scenario?: string;
  accessToken?: string;
  actorId?: string;
}>;

type CacheEntry = Readonly<{
  result: ProviderIncidentLocation;
  cachedAt: number;
}>;

export class GeocodingService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly scenario: string | undefined;
  private readonly accessToken?: string;
  private readonly actorId?: string;

  /**
   * Caché en memoria indexada por consulta normalizada.
   * Sólo almacena resultados exitosos con source === 'provider'.
   * Las respuestas de error, 429 o fallbacks manuales NUNCA se almacenan como válidos.
   */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: GeocodingServiceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_GEOCODING_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.scenario = options.scenario;
    this.accessToken = options.accessToken ?? 'course-valid-token';
    this.actorId = options.actorId ?? 'reporter-1';
  }

  /**
   * Normaliza la consulta textual para indexación en caché.
   * Elimina espacios sobrantes y convierte a minúsculas.
   */
  public normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  /**
   * Consulta la ubicación geográfica para una referencia textual.
   *
   * Flujo de resiliencia:
   * 1. Si la consulta está vacía o sólo espacios, retorna fallback manual inmediato.
   * 2. Si existe un resultado vigente en caché (y !skipCache), lo retorna sin invocar la red.
   * 3. Si la red falla (timeout, 429, 500, desconexión) o devuelve datos inválidos:
   *    - Si hay un resultado previo en caché, se utiliza como contingencia.
   *    - Si no hay caché previa, selectIncidentLocation devuelve source: 'manual'.
   * 4. Si el proveedor responde con coordenadas válidas, se almacena en caché.
   */
  public async geocode(
    rawQuery: string,
    options?: Readonly<{ skipCache?: boolean; scenario?: string }>,
  ): Promise<IncidentLocationSelection> {
    const trimmed = rawQuery.trim();
    if (trimmed.length === 0) {
      return { source: 'manual', label: rawQuery };
    }

    const normalized = this.normalizeQuery(trimmed);
    const now = Date.now();

    // 1. Verificación de caché en memoria
    if (!options?.skipCache) {
      const cached = this.cache.get(normalized);
      if (cached && now - cached.cachedAt < this.cacheTtlMs) {
        logSafeTelemetry('geocoding_cache_hit', {
          queryLength: trimmed.length,
          source: 'cache',
        });
        return cached.result;
      }
    }

    // 2. Consulta de red hacia el proveedor / simulador
    const startedAt = Date.now();
    const effectiveScenario = options?.scenario ?? this.scenario;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl}/v1/geocoding?q=${encodeURIComponent(trimmed)}`;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-Course-Actor': this.actorId ?? 'reporter-1',
      };
      if (effectiveScenario) {
        headers['X-Course-Scenario'] = effectiveScenario;
      }

      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        // En caso de 429, 500, etc., si tenemos un valor previo expirado en caché lo rescatamos
        const fallbackCached = this.cache.get(normalized);
        if (fallbackCached) {
          logSafeTelemetry('geocoding_stale_cache_used', {
            status: response.status,
            queryLength: trimmed.length,
          });
          return fallbackCached.result;
        }

        // Si no hay caché, evaluamos con selectIncidentLocation pasando el código o null
        return selectIncidentLocation({ status: response.status }, trimmed);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      // Evaluar la respuesta con el contrato evaluable selectIncidentLocation
      const selection = selectIncidentLocation(payload, trimmed);

      // Sólo se almacena en caché si la ubicación fue resuelta por el proveedor
      if (selection.source === 'provider') {
        this.cache.set(normalized, {
          result: selection,
          cachedAt: Date.now(),
        });
      }

      logSafeTelemetry('geocoding_completed', {
        source: selection.source,
        durationMs: Date.now() - startedAt,
      });

      return selection;
    } catch {
      // TimeoutError o NetworkError: fallback a caché previa si existe, o manual
      const fallbackCached = this.cache.get(normalized);
      if (fallbackCached) {
        return fallbackCached.result;
      }

      logSafeTelemetry('geocoding_failed_fallback_manual', {
        durationMs: Date.now() - startedAt,
      });
      return selectIncidentLocation(null, trimmed);
    } finally {
      clearTimeout(timer);
    }
  }

  // ────────────────────────── Helpers de Inspección de Caché ──────────────────────────

  public clearCache(): void {
    this.cache.clear();
  }

  public getCached(query: string): IncidentLocationSelection | undefined {
    const entry = this.cache.get(this.normalizeQuery(query));
    return entry?.result;
  }

  public hasCached(query: string): boolean {
    return this.cache.has(this.normalizeQuery(query));
  }

  public getCacheSize(): number {
    return this.cache.size;
  }
}
