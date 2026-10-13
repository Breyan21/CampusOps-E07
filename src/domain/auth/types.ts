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
