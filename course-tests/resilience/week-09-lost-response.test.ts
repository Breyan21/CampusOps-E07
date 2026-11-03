/**
 * @jest-environment node
 */
import { HttpIncidentRepository } from '../../src/infrastructure/api/HttpIncidentRepository';
import { GeocodingService } from '../../src/infrastructure/location/GeocodingService';
import { IncidentApiError } from '../../src/infrastructure/api/IncidentApiError';

describe('Semana 09 - Integrante 3 (MigueleArt): Calidad, Resiliencia y Respuesta Perdida', () => {
  describe('Escenario de Respuesta Perdida (Lost Response) e Idempotencia', () => {
    it('persiste un único efecto cuando la respuesta se pierde tras el guardado y el reintento usa la misma clave', async () => {
      let networkCallCount = 0;
      const capturedKeys: string[] = [];
      const historyLog: { operationId: string; version: number; action: string }[] = [];
      let incidentVersion = 1;
      let incidentStatus = 'assigned';

      // Doble controlado fiable que simula el estado persistente del servidor
      const mockFetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        networkCallCount++;
        const headers = init?.headers as Record<string, string> | undefined;
        const key = headers?.['Idempotency-Key'] ?? '';
        capturedKeys.push(key);

        const body = JSON.parse((init?.body as string) || '{}') as { action: string; diagnosis?: string };

        if (networkCallCount === 1) {
          // 1. EL SERVIDOR PERSISTE EL CAMBIO EN SU BASE DE DATOS:
          incidentVersion += 1;
          incidentStatus = 'resolved';
          historyLog.push({ operationId: key, version: incidentVersion, action: body.action });

          // 2. PERO LA RESPUESTA SE PIERDE ANTES DE LLEGAR AL CLIENTE (Timeout de red):
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        // 3. REINTENTO: El servidor detecta la clave de idempotencia ya ejecutada
        const isDuplicate = historyLog.some((entry) => entry.operationId === key);
        if (!isDuplicate) {
          incidentVersion += 1;
          historyLog.push({ operationId: key, version: incidentVersion, action: body.action });
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            incident: {
              id: 'campus-inc-001',
              version: incidentVersion,
              status: incidentStatus,
              payload: { diagnosis: body.diagnosis ?? 'Solucionado' },
            },
            operationId: key,
            duplicate: isDuplicate,
          }),
        };
      });

      const repo = new HttpIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310',
        accessToken: 'course-valid-token',
        actorId: 'technician-1',
        timeoutMs: 1500,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const stableIdempotencyKey = 'resolve-op-lost-resp-007';
      const actionPayload = { action: 'resolve', diagnosis: 'Reemplazo de fusible térmico', baseVersion: 1 };

      const response = await repo.executeAction('campus-inc-001', actionPayload, stableIdempotencyKey);

      // Criterio 1 & 2: Hubo reintento con la misma clave estable
      expect(networkCallCount).toBe(2);
      expect(capturedKeys).toHaveLength(2);
      expect(capturedKeys[0]).toBe(stableIdempotencyKey);
      expect(capturedKeys[1]).toBe(stableIdempotencyKey);

      // Criterio 3: Respuesta recibida como duplicado controlado
      expect(response.duplicate).toBe(true);
      expect(response.operationId).toBe(stableIdempotencyKey);
      expect(response.incident.id).toBe('campus-inc-001');
      expect(response.incident.version).toBe(2);
      expect(response.incident.status).toBe('resolved');

      // Criterio 4: Cero duplicados en el estado persistido del servidor
      expect(historyLog).toHaveLength(1);
      expect(historyLog[0]).toEqual({
        operationId: stableIdempotencyKey,
        version: 2,
        action: 'resolve',
      });
      expect(incidentVersion).toBe(2);
    });

    it('respeta el límite estricto de 4 intentos como máximo (sin quinto intento)', async () => {
      let networkCallCount = 0;

      const mockFetch = jest.fn().mockImplementation(async () => {
        networkCallCount++;
        return {
          ok: false,
          status: 503,
          headers: new Headers(),
          json: async () => ({ code: 'service_unavailable' }),
        };
      });

      const repo = new HttpIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310',
        accessToken: 'course-valid-token',
        actorId: 'reporter-1',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      await expect(repo.getAll()).rejects.toThrow(IncidentApiError);

      // Intento 1 + reintentos 2, 3, 4 = exactamente 4 intentos. Nunca un 5to intento.
      expect(networkCallCount).toBe(4);
    });

    it('respeta el encabezado Retry-After en segundos según el estándar HTTP RFC 7231', async () => {
      let networkCallCount = 0;
      let firstCallTime = 0;
      let secondCallTime = 0;

      const mockFetch = jest.fn().mockImplementation(async () => {
        networkCallCount++;
        if (networkCallCount === 1) {
          firstCallTime = Date.now();
          // Retry-After usa delay-seconds enteros conforme a HTTP.
          return {
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '1' }),
            json: async () => ({ code: 'rate_limited' }),
          };
        }

        secondCallTime = Date.now();
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ items: [] }),
        };
      });

      const repo = new HttpIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310',
        accessToken: 'course-valid-token',
        actorId: 'reporter-1',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const result = await repo.getAll();
      expect(result.items).toEqual([]);
      expect(networkCallCount).toBe(2);
      expect(secondCallTime - firstCallTime).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('GeocodingService: Caché y Fallback Manual Resiliente', () => {
    it('evita una segunda llamada de red gracias a la caché por consulta normalizada', async () => {
      let networkRequests = 0;

      const mockFetch = jest.fn().mockImplementation(async () => {
        networkRequests++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            label: 'Biblioteca Central',
            latitude: 19.3315,
            longitude: -99.1873,
          }),
        };
      });

      const geoService = new GeocodingService({
        baseUrl: 'http://127.0.0.1:4310',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      const res1 = await geoService.geocode('Biblioteca Central');
      expect(res1).toEqual({
        source: 'provider',
        label: 'Biblioteca Central',
        latitude: 19.3315,
        longitude: -99.1873,
      });
      expect(networkRequests).toBe(1);

      // Consulta idéntica con variación de mayúsculas y espacios: debe responder desde caché
      const res2 = await geoService.geocode('  biblioteca central  ');
      expect(res2).toEqual(res1);
      expect(networkRequests).toBe(1); // La red NO fue consultada por segunda vez
    });

    it('aplica fallback a manual sin inventar coordenadas ante 429, timeout, desconexión y datos inválidos', async () => {
      let scenario = '429';

      const mockFetch = jest.fn().mockImplementation(async () => {
        if (scenario === '429') {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '1' }),
            json: async () => ({ code: 'rate_limited' }),
          };
        }
        if (scenario === 'timeout') {
          const timeoutErr = new Error('The operation was aborted');
          timeoutErr.name = 'AbortError';
          throw timeoutErr;
        }
        if (scenario === 'network_error') {
          throw new Error('Connection refused');
        }
        if (scenario === 'invalid_data') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              label: 'Coordenadas Fuera de Rango',
              latitude: 1000,
              longitude: null,
            }),
          };
        }
        return { ok: false, status: 500 };
      });

      const geoService = new GeocodingService({
        baseUrl: 'http://127.0.0.1:4310',
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      // 1. Caso HTTP 429
      scenario = '429';
      const r429 = await geoService.geocode('Zona Cafetería');
      expect(r429).toEqual({ source: 'manual', label: 'Zona Cafetería' });
      expect((r429 as { latitude?: number }).latitude).toBeUndefined();
      expect((r429 as { longitude?: number }).longitude).toBeUndefined();

      // 2. Caso Timeout
      scenario = 'timeout';
      const rTimeout = await geoService.geocode('Edificio Posgrado');
      expect(rTimeout).toEqual({ source: 'manual', label: 'Edificio Posgrado' });
      expect((rTimeout as { latitude?: number }).latitude).toBeUndefined();

      // 3. Caso Desconexión de Red
      scenario = 'network_error';
      const rNet = await geoService.geocode('Auditorio Principal');
      expect(rNet).toEqual({ source: 'manual', label: 'Auditorio Principal' });
      expect((rNet as { latitude?: number }).latitude).toBeUndefined();

      // 4. Caso Datos Inválidos del proveedor
      scenario = 'invalid_data';
      const rInv = await geoService.geocode('Laboratorio de Física');
      expect(rInv).toEqual({ source: 'manual', label: 'Laboratorio de Física' });
      expect((rInv as { latitude?: number }).latitude).toBeUndefined();

      // Verificación estricta: NINGÚN error fue guardado en la caché
      expect(geoService.hasCached('Zona Cafetería')).toBe(false);
      expect(geoService.hasCached('Edificio Posgrado')).toBe(false);
      expect(geoService.hasCached('Auditorio Principal')).toBe(false);
      expect(geoService.hasCached('Laboratorio de Física')).toBe(false);
      expect(geoService.getCacheSize()).toBe(0);
    });
  });
});
