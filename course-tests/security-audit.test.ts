import { getBackendHealth } from '../src/api/courseBackend';
import { redactForTelemetry } from '../src/course-evaluation';

describe('Auditoría de Seguridad y Privacidad - Semana 4', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.EXPO_PUBLIC_BACKEND_API_KEY;
  });

  describe('Hallazgo 1: Manejo seguro de credenciales mediante variables de entorno', () => {
    it('inyecta cabecera de autorización a partir de process.env.EXPO_PUBLIC_BACKEND_API_KEY', async () => {
      process.env.EXPO_PUBLIC_BACKEND_API_KEY = 'demo_env_token_456';

      let capturedHeaders: Record<string, string> | undefined;
      global.fetch = jest.fn().mockImplementation((_url, options) => {
        capturedHeaders = options?.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, service: 'dmi-controlled-backend', contractVersion: 1 }),
        });
      });

      const result = await getBackendHealth('http://127.0.0.1:4310');
      expect(result.ok).toBe(true);
      expect(capturedHeaders?.Authorization).toBe('Bearer demo_env_token_456');
    });

    it('no expone claves estáticas en el código fuente de curso backend', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, service: 'dmi-controlled-backend', contractVersion: 1 }),
      });

      // Sin variable de entorno, no se inyecta cabecera Authorization arbitraria ni estática
      let capturedHeaders: Record<string, string> | undefined;
      global.fetch = jest.fn().mockImplementation((_url, options) => {
        capturedHeaders = options?.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, service: 'dmi-controlled-backend', contractVersion: 1 }),
        });
      });

      await getBackendHealth('http://127.0.0.1:4310');
      expect(capturedHeaders?.Authorization).toBeUndefined();
    });
  });

  describe('Hallazgo 2: Sanitización de datos sensibles y PII en registros y telemetría', () => {
    it('redacta credenciales, datos personales y detalles sensibles de incidentes', () => {
      const sensitivePayload = {
        authorization: 'Bearer secret_token_xyz',
        password: 'super_secret_password_123',
        profile: {
          email: 'estudiante@campusops.ficticio',
          displayName: 'Juan Ficticio',
        },
        location: {
          latitude: 19.4326,
          longitude: -99.1332,
        },
        photos: ['foto1.jpg', 'foto2.jpg'],
        internalComments: ['Comentario confidencial'],
        incidentId: 'inc-999',
        status: 'open',
        attempt: 1,
      };

      const sanitized = redactForTelemetry(sensitivePayload) as Record<string, unknown>;

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
      expect((sanitized.profile as Record<string, unknown>).email).toBe('[REDACTED]');
      expect((sanitized.profile as Record<string, unknown>).displayName).toBe('[REDACTED]');
      expect(sanitized.location).toBe('[REDACTED]');
      expect(sanitized.photos).toBe('[REDACTED]');
      expect(sanitized.internalComments).toBe('[REDACTED]');

      // Conserva metadatos técnicos no sensibles
      expect(sanitized.incidentId).toBe('inc-999');
      expect(sanitized.status).toBe('open');
      expect(sanitized.attempt).toBe(1);
    });
  });

  describe('Hallazgo 3: Sanitización de errores y protección contra fuga de infraestructura', () => {
    it('retorna mensaje seguro y genérico ante errores de conexión sin filtrar URLs de infraestructura', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 192.168.1.150:4310'));

      await expect(getBackendHealth('http://192.168.1.150:4310')).rejects.toThrow(
        'No fue posible conectar con el servicio.',
      );
    });

    it('retorna mensaje seguro ante respuestas no exitosas del servidor', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(getBackendHealth('http://127.0.0.1:4310')).rejects.toThrow(
        'No fue posible conectar con el servicio.',
      );
    });
  });
});
