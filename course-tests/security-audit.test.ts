import * as SecureStore from 'expo-secure-store';

import {
  BackendUnavailableError,
  GENERIC_NETWORK_ERROR,
  getBackendHealth,
} from '../src/api/courseBackend';
import { getToken, removeToken, saveToken } from '../src/infrastructure/storage/SecureStorageService';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'mock-when-unlocked-this-device-only',
}));

const FAKE_TOKEN = 'token-ficticio-semana-04';
const INFRA_LEAKS = ['127.0.0.1', '4310', '/health', 'ECONNREFUSED', 'ETIMEDOUT', 'http://', '    at '];

let errorSpy: jest.SpyInstance;

function loggedText(): string {
  return errorSpy.mock.calls.flat().map(String).join('\n');
}

beforeEach(() => {
  jest.clearAllMocks();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('SecureStorageService (TH-03)', () => {
  test('guarda el token en SecureStore sin respaldo fuera del dispositivo', async () => {
    await expect(saveToken('accessToken', FAKE_TOKEN)).resolves.toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'campusops.session.accessToken',
      FAKE_TOKEN,
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });

  test('si falla el guardado no registra la clave ni el valor', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error(`keystore failure ${FAKE_TOKEN}`));
    await expect(saveToken('accessToken', FAKE_TOKEN)).resolves.toBe(false);
    expect(loggedText()).not.toContain(FAKE_TOKEN);
    expect(loggedText()).not.toContain('campusops.session');
  });

  test('si falla la lectura devuelve null sin exponer datos', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('read failure'));
    await expect(getToken('refreshToken')).resolves.toBeNull();
    expect(loggedText()).not.toContain('campusops.session');
  });

  test('removeToken elimina el token para que no quede sesión en reposo', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    await expect(removeToken('accessToken')).resolves.toBe(true);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('campusops.session.accessToken', expect.any(Object));
    await expect(getToken('accessToken')).resolves.toBeNull();
  });
});

describe('courseBackend sanitiza errores de red (TH-04)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function expectSanitizedFailure(): Promise<void> {
    const error = await getBackendHealth('http://127.0.0.1:4310').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect((error as Error).message).toBe(GENERIC_NETWORK_ERROR);
    for (const leak of INFRA_LEAKS) {
      expect((error as Error).message).not.toContain(leak);
      expect(loggedText()).not.toContain(leak);
    }
  }

  test('ECONNREFUSED se convierte en "Error de conexión"', async () => {
    global.fetch = jest.fn().mockRejectedValue(
      new TypeError('connect ECONNREFUSED 127.0.0.1:4310 at http://127.0.0.1:4310/health'),
    );
    await expectSanitizedFailure();
  });

  test('ETIMEDOUT / abort se convierte en "Error de conexión"', async () => {
    const abort = Object.assign(new Error('ETIMEDOUT 127.0.0.1:4310'), { name: 'AbortError' });
    global.fetch = jest.fn().mockRejectedValue(abort);
    await expectSanitizedFailure();
  });

  test('HTTP 500 no expone el cuerpo ni la ruta del servidor', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ stack: 'Error at /srv/campusops/server.mjs:42' }),
    });
    await expectSanitizedFailure();
    expect(loggedText()).toContain('HTTP 500');
    expect(loggedText()).not.toContain('/srv/');
  });
});
