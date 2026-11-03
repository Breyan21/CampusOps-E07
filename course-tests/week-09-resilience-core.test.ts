/**
 * @jest-environment node
 */
import { GeocodingService } from '../src/infrastructure/location/GeocodingService';
import { HttpIncidentRepository } from '../src/infrastructure/api/HttpIncidentRepository';
import { IncidentApiError } from '../src/infrastructure/api/IncidentApiError';

describe('Semana 09 - Integrante 2: Core de Resiliencia, Caché y Reintentos', () => {
  describe('GeocodingService (Adaptador con Caché en Memoria)', () => {
    it('resuelve ubicación válida del proveedor y la almacena en caché', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          label: 'Laboratorio Central de Cómputo',
          latitude: 19.4326,
          longitude: -99.1332,
        }),
      });

      const service = new GeocodingService({
        baseUrl: 'http://127.0.0.1:4310',
        fetchImpl: mockFetch as any,
      });

      const result1 = await service.geocode('Laboratorio Central');
      expect(result1).toEqual({
        source: 'provider',
        label: 'Laboratorio Central de Cómputo',
        latitude: 19.4326,
        longitude: -99.1332,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(service.hasCached('Laboratorio Central')).toBe(true);

      // Segunda consulta idéntica (con variaciones de mayúsculas y espacios): debe responder desde caché
      const result2 = await service.geocode('  laboratorio central  ');
      expect(result2).toEqual(result1);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No hace una segunda llamada de red
    });

    it('aplica fallback a manual ante respuesta 429 sin inventar coordenadas ni guardar en caché', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
        json: async () => ({ code: 'rate_limited' }),
      });

      const service = new GeocodingService({
        baseUrl: 'http://127.0.0.1:4310',
        fetchImpl: mockFetch as any,
      });

      const result = await service.geocode('Edificio B');
      expect(result).toEqual({
        source: 'manual',
        label: 'Edificio B',
      });
      // No debe inventar latitude ni longitude
      expect((result as any).latitude).toBeUndefined();
      expect((result as any).longitude).toBeUndefined();
      // No debe cachear un resultado manual como exitoso
      expect(service.hasCached('Edificio B')).toBe(false);
    });

    it('aplica fallback a manual ante coordenadas corruptas o fuera de rango', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          label: 'Lugar Inválido',
          latitude: 999, // Latitud fuera de [-90, 90]
          longitude: null,
        }),
      });

      const service = new GeocodingService({
        baseUrl: 'http://127.0.0.1:4310',
        fetchImpl: mockFetch as any,
      });

      const result = await service.geocode('Zona Desconocida');
      expect(result).toEqual({
        source: 'manual',
        label: 'Zona Desconocida',
      });
      expect(service.hasCached('Zona Desconocida')).toBe(false);
    });

    it('aplica fallback a manual ante desconexión o timeout de red sin lanzar excepción', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network disconnected'));

      const service = new GeocodingService({
        baseUrl: 'http://127.0.0.1:4310',
        fetchImpl: mockFetch as any,
      });

      const result = await service.geocode('Sótano de Ingeniería');
      expect(result).toEqual({
        source: 'manual',
        label: 'Sótano de Ingeniería',
      });
    });

    it('permite limpiar la caché en memoria', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ label: 'Zona A', latitude: 10, longitude: 20 }),
      });

      const service = new GeocodingService({
        baseUrl: 'http://127.0.0.1:4310',
        fetchImpl: mockFetch as any,
      });

      await service.geocode('Zona A');
      expect(service.getCacheSize()).toBe(1);

      service.clearCache();
      expect(service.getCacheSize()).toBe(0);
      expect(service.hasCached('Zona A')).toBe(false);
    });
  });

  describe('HttpIncidentRepository (Reintentos Resilientes e Idempotentes)', () => {
    it('reintenta automáticamente ante un error 429 respetando Retry-After', async () => {
      let callCount = 0;
      const mockFetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '1' }), // delay-seconds HTTP válido: 1 segundo
            json: async () => ({ code: 'rate_limited' }),
          };
        }
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
        fetchImpl: mockFetch as any,
      });

      const result = await repo.getAll();
      expect(result).toEqual({ items: [] });
      expect(callCount).toBe(2);
    });

    it('en operaciones POST reintenta conservando exactamente la misma Idempotency-Key ante timeout', async () => {
      let callCount = 0;
      const capturedKeys: string[] = [];

      const mockFetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        callCount++;
        const headers = init?.headers as Record<string, string>;
        if (headers?.['Idempotency-Key']) {
          capturedKeys.push(headers['Idempotency-Key']);
        }

        if (callCount === 1) {
          // Simula que la primera solicitud sufre un timeout
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        // En el reintento, el servidor responde con el resultado idempotente cumpliendo el DTO
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            incident: {
              id: 'campus-inc-001',
              version: 2,
              status: 'resolved',
              payload: { diagnosis: 'Falla corregida' },
            },
            operationId: idempotencyKey,
            duplicate: true,
          }),
        };
      });

      const repo = new HttpIncidentRepository({
        baseUrl: 'http://127.0.0.1:4310',
        accessToken: 'course-valid-token',
        actorId: 'technician-1',
        timeoutMs: 100,
        fetchImpl: mockFetch as any,
      });

      const idempotencyKey = 'resolve-campus-inc-001-op-99';
      const actionResult = await repo.executeAction(
        'campus-inc-001',
        { action: 'resolve', diagnosis: 'Falla corregida', baseVersion: 1 },
        idempotencyKey,
      );

      expect(callCount).toBe(2);
      expect(capturedKeys).toHaveLength(2);
      // Garantía de idempotencia: ambas llamadas usan la MISMA clave estable
      expect(capturedKeys[0]).toBe(idempotencyKey);
      expect(capturedKeys[1]).toBe(idempotencyKey);
      expect(actionResult.incident.id).toBe('campus-inc-001');
      expect(actionResult.incident.status).toBe('resolved');
      expect(actionResult.duplicate).toBe(true);
    });

    it('no reintenta solicitudes que exceden el límite de 3 reintentos (intento 4 aborta)', async () => {
      let callCount = 0;
      const mockFetch = jest.fn().mockImplementation(async () => {
        callCount++;
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
        fetchImpl: mockFetch as any,
      });

      await expect(repo.getAll()).rejects.toThrow(IncidentApiError);
      // Intento 1 + reintentos 2, 3, 4 (intento 4 aborta sin intentar un 5to)
      expect(callCount).toBe(4);
    });
  });
});

