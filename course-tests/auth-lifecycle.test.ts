import * as SecureStore from 'expo-secure-store';
import { AuthService } from '../src/application/auth/AuthService';
import {
  canAssignIncident,
  canCloseIncident,
  canCreateIncident,
  canPrioritizeIncident,
  canReopenIncident,
  canResolveIncident,
  canStartIncident,
} from '../src/domain/auth/permissions';
import { coordinateRefresh } from '../src/course-evaluation';
import { getToken } from '../src/infrastructure/storage/SecureStorageService';

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'mock-when-unlocked-this-device-only',
}));

describe('AuthService & Secure Storage Lifecycle (Semana 06 - Integrante 3)', () => {
  let authService: AuthService;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    authService = new AuthService({
      baseUrl: 'http://127.0.0.1:4310',
      fetchImpl: jest.fn(async (input, init) => {
        const url = String(input);
        if (url.endsWith('/v1/session/login')) {
          const body = JSON.parse(String(init?.body)) as { actorId: string };
          if (body.actorId === 'reporter-1') {
            return {
              ok: true,
              json: async () => ({
                actorId: 'reporter-1',
                role: 'reporter',
                accessToken: 'sec-token-rep1-12345',
                refreshToken: 'sec-refresh-rep1-67890',
                expiresIn: 3600,
              }),
            } as Response;
          }
          if (body.actorId === 'technician-1') {
            return {
              ok: true,
              json: async () => ({
                actorId: 'technician-1',
                role: 'technician',
                accessToken: 'sec-token-tech1-12345',
                refreshToken: 'sec-refresh-tech1-67890',
                expiresIn: 3600,
              }),
            } as Response;
          }
          if (body.actorId === 'coordinator-1') {
            return {
              ok: true,
              json: async () => ({
                actorId: 'coordinator-1',
                role: 'coordinator',
                accessToken: 'sec-token-coord1-12345',
                refreshToken: 'sec-refresh-coord1-67890',
                expiresIn: 3600,
              }),
            } as Response;
          }
          return { ok: false, status: 401 } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }) as unknown as typeof fetch,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('1. Almacenamiento seguro de tokens y sanitización de logs', () => {
    test('login exitoso persiste los tokens en SecureStore con opciones seguras', async () => {
      const session = await authService.login('reporter-1');
      expect(session.actorId).toBe('reporter-1');
      expect(session.role).toBe('reporter');
      expect(authService.isAuthenticated()).toBe(true);

      // Verificamos que se guardaron en SecureStore
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'campusops.session.accessToken',
        'sec-token-rep1-12345',
        { keychainAccessible: 'mock-when-unlocked-this-device-only' },
      );
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'campusops.session.refreshToken',
        'sec-refresh-rep1-67890',
        { keychainAccessible: 'mock-when-unlocked-this-device-only' },
      );
      expect(await getToken('accessToken')).toBe('sec-token-rep1-12345');
      expect(await getToken('refreshToken')).toBe('sec-refresh-rep1-67890');
    });

    test('no se filtran tokens reales en los logs de telemetría ni consola', async () => {
      await authService.login('reporter-1');

      const loggedInfo = logSpy.mock.calls.flat().map(String).join(' ');
      const loggedError = errorSpy.mock.calls.flat().map(String).join(' ');

      // El token real nunca debe aparecer en stdout / stderr
      expect(loggedInfo).not.toContain('sec-token-rep1-12345');
      expect(loggedInfo).not.toContain('sec-refresh-rep1-67890');
      expect(loggedError).not.toContain('sec-token-rep1-12345');
      expect(loggedError).not.toContain('sec-refresh-rep1-67890');
    });

    test('rechaza actores desconocidos y no guarda tokens espurios', async () => {
      await expect(authService.login('hacker-anon')).rejects.toThrow('auth_login_rejected');
      expect(authService.getState()).toBe('unauthenticated');
      expect(authService.getSession()).toBeNull();
      expect(await getToken('accessToken')).toBeNull();
    });
  });

  describe('2. Validación de perfiles y permisos', () => {
    test('reportante solo puede crear incidencias pero no resolver ni gestionar', async () => {
      await authService.login('reporter-1');
      expect(canCreateIncident('reporter')).toBe(true);
      expect(canAssignIncident('reporter')).toBe(false);
      expect(canPrioritizeIncident('reporter')).toBe(false);
      expect(canCloseIncident('reporter', 'resolved')).toBe(false);
      expect(canResolveIncident('reporter', 'in_progress', 'reporter-1', 'reporter-1')).toBe(false);
    });

    test('técnico solo puede iniciar y resolver incidencias asignadas a su actorId', async () => {
      await authService.login('technician-1');
      expect(canCreateIncident('technician')).toBe(false);
      expect(canAssignIncident('technician')).toBe(false);

      // Si no está asignada al técnico, no puede iniciar ni resolver
      expect(canStartIncident('technician', 'assigned', 'technician-2', 'technician-1')).toBe(false);
      expect(canResolveIncident('technician', 'in_progress', 'technician-2', 'technician-1')).toBe(false);

      // Si está asignada a él y en el estado correcto, sí puede
      expect(canStartIncident('technician', 'assigned', 'technician-1', 'technician-1')).toBe(true);
      expect(canResolveIncident('technician', 'in_progress', 'technician-1', 'technician-1')).toBe(true);
    });

    test('coordinador tiene permisos de asignación, prioridad, cierre y reapertura', async () => {
      await authService.login('coordinator-1');
      expect(canAssignIncident('coordinator')).toBe(true);
      expect(canPrioritizeIncident('coordinator')).toBe(true);
      expect(canCloseIncident('coordinator', 'resolved')).toBe(true);
      expect(canReopenIncident('coordinator', 'resolved')).toBe(true);
      expect(canReopenIncident('coordinator', 'closed')).toBe(true);
      expect(canCreateIncident('coordinator')).toBe(false);
    });
  });

  describe('3. Renovación de tokens (refreshSucceeded)', () => {
    test('actualiza tokens en SecureStore y mantiene la sesión autenticada', async () => {
      await authService.login('reporter-1');
      authService.refreshSucceeded('new-access-token-999', 'new-refresh-token-888');

      expect(authService.getSession()?.accessToken).toBe('new-access-token-999');
      expect(authService.getSession()?.refreshToken).toBe('new-refresh-token-888');
      expect(authService.getState()).toBe('authenticated');

      expect(await getToken('accessToken')).toBe('new-access-token-999');
      expect(await getToken('refreshToken')).toBe('new-refresh-token-888');
    });
  });

  describe('4. Cierre estricto de sesión (Logout)', () => {
    test('logout elimina por completo el estado persistido en SecureStore y en memoria', async () => {
      await authService.login('reporter-1');
      expect(await getToken('accessToken')).toBe('sec-token-rep1-12345');

      await authService.logout();

      // En memoria
      expect(authService.getState()).toBe('unauthenticated');
      expect(authService.getSession()).toBeNull();
      expect(authService.isAuthenticated()).toBe(false);

      // En SecureStore persistido: DEBE SER NULL
      expect(await getToken('accessToken')).toBeNull();
      expect(await getToken('refreshToken')).toBeNull();
      expect(mockStore.size).toBe(0);

      // En máquina de evaluación coordinateRefresh
      const evalState = coordinateRefresh([{ type: 'logout' }]);
      expect(evalState.status).toBe('anonymous');
      expect(evalState.persistedToken).toBeNull();
      expect(evalState.activeGeneration).toBeNull();
    });
  });

  describe('5. Retorno seguro al login cuando coordinateRefresh / renovación falla definitivamente', () => {
    test('setExpired limpia tokens persistidos y coloca la app en estado expired para re-autenticación', async () => {
      await authService.login('reporter-1');
      expect(await getToken('accessToken')).toBe('sec-token-rep1-12345');

      await authService.setExpired();

      // Sesión en memoria descartada
      expect(authService.getState()).toBe('expired');
      expect(authService.getSession()).toBeNull();
      expect(authService.isAuthenticated()).toBe(false);

      // Almacenamiento seguro completamente limpio
      expect(await getToken('accessToken')).toBeNull();
      expect(await getToken('refreshToken')).toBeNull();
      expect(mockStore.size).toBe(0);

      // coordinateRefresh descartó sesión
      const evalState = coordinateRefresh([{ type: 'refreshFailed' }]);
      expect(evalState.status).toBe('anonymous');
      expect(evalState.persistedToken).toBeNull();
    });

    test('permite restaurar sesión desde storage si hay token válido o retorna unauthenticated si no hay', async () => {
      const restoredNone = await authService.restoreFromStorage('reporter-1', 'reporter');
      expect(restoredNone).toBeNull();
      expect(authService.getState()).toBe('unauthenticated');

      // Simulamos guardado previo
      mockStore.set('campusops.session.accessToken', 'token-remanente');
      mockStore.set('campusops.session.refreshToken', 'refresh-remanente');

      const restored = await authService.restoreFromStorage('reporter-1', 'reporter');
      expect(restored).not.toBeNull();
      expect(restored?.accessToken).toBe('token-remanente');
      expect(authService.getState()).toBe('authenticated');
    });
  });
});
