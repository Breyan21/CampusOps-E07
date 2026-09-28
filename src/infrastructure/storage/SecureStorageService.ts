import * as SecureStore from 'expo-secure-store';

export type SessionTokenKey = 'accessToken' | 'refreshToken';

// SecureStore solo acepta claves alfanuméricas con ".", "-" y "_".
const STORAGE_KEYS: Readonly<Record<SessionTokenKey, string>> = {
  accessToken: 'campusops.session.accessToken',
  refreshToken: 'campusops.session.refreshToken',
};

// Sin respaldo en iCloud/migración de dispositivo; solo legible con el equipo desbloqueado.
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// Nunca se registra la clave real ni el valor: solo la operación fallida.
function logStorageFailure(operation: 'save' | 'read' | 'remove'): void {
  console.error(`[SecureStorage] No se pudo completar la operación: ${operation}`);
}

export async function saveToken(key: SessionTokenKey, value: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEYS[key], value, STORE_OPTIONS);
    return true;
  } catch {
    logStorageFailure('save');
    return false;
  }
}

export async function getToken(key: SessionTokenKey): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(STORAGE_KEYS[key], STORE_OPTIONS);
  } catch {
    logStorageFailure('read');
    return null;
  }
}

export async function removeToken(key: SessionTokenKey): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEYS[key], STORE_OPTIONS);
    return true;
  } catch {
    logStorageFailure('remove');
    return false;
  }
}
