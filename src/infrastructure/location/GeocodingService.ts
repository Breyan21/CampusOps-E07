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
import { planRetry, selectIncidentLocation } from '../../course-evaluation';
import { logSafeTelemetry } from '../../telemetry/safeTelemetry';

export const DEFAULT_GEOCODING_TIMEOUT_MS = 3000;
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export type GeocodingServiceOptions = Readonly<{
  baseUrl: string;
  provider?: 'course' | 'nominatim';
  courseBaseUrl?: string;
  nominatimBaseUrl?: string;
  appIdentifier?: string;
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
  private baseUrl: string;
  private readonly providerBaseUrls: Readonly<Record<'course' | 'nominatim', string>>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly scenario: string | undefined;
  private readonly accessToken?: string;
  private readonly actorId?: string;
  private provider: 'course' | 'nominatim';
  private readonly appIdentifier: string;
  private nextRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

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
    this.provider = options.provider ?? 'course';
    this.appIdentifier = options.appIdentifier ?? 'CampusOps-E07/1.0 (academic demo)';
    this.providerBaseUrls = {
      course: (options.courseBaseUrl ?? (this.provider === 'course' ? options.baseUrl : 'http://127.0.0.1:4310')).replace(/\/+$/, ''),
      nominatim: (options.nominatimBaseUrl ?? (this.provider === 'nominatim' ? options.baseUrl : 'https://nominatim.openstreetmap.org')).replace(/\/+$/, ''),
    };
    this.baseUrl = this.providerBaseUrls[this.provider];
  }

  /**
   * Normaliza la consulta textual para indexación en caché.
   * Elimina espacios sobrantes y convierte a minúsculas.
   */
  public normalizeQuery(query: string): string {
    return query.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  public get attribution(): string | null {
    return this.provider === 'nominatim' ? '© OpenStreetMap contributors' : null;
  }

  public get currentProvider(): 'course' | 'nominatim' {
    return this.provider;
  }

  public setProvider(provider: 'course' | 'nominatim'): void {
    if (this.provider === provider) return;
    this.provider = provider;
    this.baseUrl = this.providerBaseUrls[provider];
    this.clearCache();
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

    const provider = this.provider;
    const baseUrl = this.baseUrl;
    const normalized = `${provider}:${this.normalizeQuery(trimmed)}`;
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

    // 2. Consulta bajo demanda al proveedor / simulador. Nominatim público
    // requiere como máximo 1 solicitud por segundo y no permite autocompletar.
    const startedAt = Date.now();
    const effectiveScenario = options?.scenario ?? this.scenario;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const url = this.buildRequestUrl(trimmed, provider, baseUrl);
        const response = await this.fetchAtAllowedRate(url, {
          method: 'GET',
          headers: this.requestHeaders(effectiveScenario, provider),
          signal: controller.signal,
        }, provider);

        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
          const decision = planRetry({
            method: 'GET', status: response.status, attempt,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          });
          if (decision.retry && attempt < 4) {
            logSafeTelemetry('geocoding_retrying', {
              provider, status: response.status, attempt,
              nextAttempt: attempt + 1, delayMs: decision.delayMs,
            });
            await delay(decision.delayMs);
            continue;
          }
          return this.useCachedOrManual(normalized, trimmed, response.status);
        }

        const rawPayload: unknown = await response.json().catch(() => null);
        const payload = provider === 'nominatim' ? fromNominatim(rawPayload) : rawPayload;
        const selection = selectIncidentLocation(payload, trimmed);
        if (selection.source === 'provider') {
          this.cache.set(normalized, { result: selection, cachedAt: Date.now() });
        }
        logSafeTelemetry('geocoding_completed', {
          provider, source: selection.source,
          durationMs: Date.now() - startedAt, attempt,
        });
        return selection;
      } catch {
        const decision = planRetry({ method: 'GET', status: 'timeout', attempt });
        if (decision.retry && attempt < 4) {
          logSafeTelemetry('geocoding_retrying', {
            provider, status: 'network_or_timeout', attempt,
            nextAttempt: attempt + 1, delayMs: decision.delayMs,
          });
          await delay(decision.delayMs);
          continue;
        }
        logSafeTelemetry('geocoding_failed_fallback_manual', {
          provider, durationMs: Date.now() - startedAt,
          attempts: attempt,
        });
        return this.useCachedOrManual(normalized, trimmed, null);
      } finally {
        clearTimeout(timer);
      }
    }
    return this.useCachedOrManual(normalized, trimmed, null);
  }

  private buildRequestUrl(query: string, provider: 'course' | 'nominatim', baseUrl: string): string {
    if (provider === 'nominatim') {
      const url = new URL('/search', baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      url.searchParams.set('accept-language', 'es');
      return url.toString();
    }
    return `${baseUrl}/v1/geocoding?q=${encodeURIComponent(query)}`;
  }

  private requestHeaders(scenario: string | undefined, provider: 'course' | 'nominatim'): Record<string, string> {
    if (provider === 'nominatim') {
      return { Accept: 'application/json', 'User-Agent': this.appIdentifier };
    }
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
      'X-Course-Actor': this.actorId ?? 'reporter-1',
      ...(scenario ? { 'X-Course-Scenario': scenario } : {}),
    };
  }

  private async fetchAtAllowedRate(url: string, init: RequestInit, provider: 'course' | 'nominatim'): Promise<Response> {
    if (provider !== 'nominatim') return this.fetchImpl(url, init);
    const previous = this.requestQueue;
    let release!: () => void;
    this.requestQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, this.nextRequestAt - Date.now());
      if (waitMs > 0) await delay(waitMs);
      this.nextRequestAt = Date.now() + 1000;
      return await this.fetchImpl(url, init);
    } finally {
      release();
    }
  }

  private useCachedOrManual(
    normalized: string,
    manualLabel: string,
    status: number | null,
  ): IncidentLocationSelection {
    const cached = this.cache.get(normalized);
    if (cached) {
      logSafeTelemetry('geocoding_stale_cache_used', {
        provider: normalized.split(':', 1)[0], status, queryLength: manualLabel.length,
        staleMs: Date.now() - cached.cachedAt,
      });
      return cached.result;
    }
    return selectIncidentLocation(null, manualLabel);
  }

  // ────────────────────────── Helpers de Inspección de Caché ──────────────────────────

  public clearCache(): void {
    this.cache.clear();
  }

  public getCached(query: string): IncidentLocationSelection | undefined {
    const entry = this.cache.get(`${this.provider}:${this.normalizeQuery(query)}`);
    return entry?.result;
  }

  public hasCached(query: string): boolean {
    return this.cache.has(`${this.provider}:${this.normalizeQuery(query)}`);
  }

  public getCacheSize(): number {
    return this.cache.size;
  }
}

function fromNominatim(input: unknown): unknown {
  if (!Array.isArray(input) || input.length === 0) return null;
  const first: unknown = input[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return null;
  const record = first as Record<string, unknown>;
  const latitude = parseCoordinate(record.lat);
  const longitude = parseCoordinate(record.lon);
  return {
    label: record.display_name,
    latitude,
    longitude,
  };
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }
  if (!isHttpDate(value)) return undefined;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

function parseCoordinate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim().length > 0 ? Number(value) : Number.NaN;
}

function isHttpDate(value: string): boolean {
  return /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/.test(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
