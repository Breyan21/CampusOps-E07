export type UserRole = 'reporter' | 'technician' | 'coordinator';

export type SessionState = 'unauthenticated' | 'authenticating' | 'authenticated' | 'refreshing' | 'expired';

export type UserSession = Readonly<{
  actorId: string;
  role: UserRole;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}>;

export const KNOWN_FIXTURE_ACTORS: Readonly<Record<string, UserRole>> = {
  'reporter-1': 'reporter',
  'reporter-2': 'reporter',
  'technician-1': 'technician',
  'technician-2': 'technician',
  'coordinator-1': 'coordinator',
};

export type SessionTokenKey = 'accessToken' | 'refreshToken';

// Puerto de persistencia de sesión: la capa de aplicación depende de esta
// interfaz y la implementación concreta (SecureStore) se inyecta en la raíz.
export interface SessionTokenStore {
  save(key: SessionTokenKey, value: string): Promise<boolean>;
  get(key: SessionTokenKey): Promise<string | null>;
  remove(key: SessionTokenKey): Promise<boolean>;
  clear(): Promise<boolean>;
}
