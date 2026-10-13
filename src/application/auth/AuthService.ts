import type { SessionState, SessionTokenStore, UserRole, UserSession } from '../../domain/auth/types';
import { KNOWN_FIXTURE_ACTORS } from '../../domain/auth/types';
import { coordinateRefresh } from '../../course-evaluation';
import { logSafeTelemetry } from '../../telemetry/safeTelemetry';

export type SessionChangeListener = (session: UserSession | null, state: SessionState) => void;

export type AuthServiceOptions = Readonly<{
  baseUrl: string;
  sessionStore: SessionTokenStore;
  fetchImpl?: typeof fetch;
  initialSession?: UserSession | null;
}>;

export class AuthService {
  private readonly baseUrl: string;
  private readonly sessionStore: SessionTokenStore;
  private readonly fetchImpl: typeof fetch;
  private state: SessionState;
  private session: UserSession | null;
  private readonly listeners = new Set<SessionChangeListener>();

  constructor(options: AuthServiceOptions) {
    this.baseUrl = options.baseUrl;
    this.sessionStore = options.sessionStore;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.session = options.initialSession ?? null;
    this.state = this.session ? 'authenticated' : 'unauthenticated';
  }

  getState(): SessionState {
    return this.state;
  }

  getSession(): UserSession | null {
    return this.session;
  }

  getRole(): UserRole | null {
    return this.session?.role ?? null;
  }

  getActorId(): string | null {
    return this.session?.actorId ?? null;
  }

  isAuthenticated(): boolean {
    return this.state === 'authenticated' && this.session !== null;
  }

  async login(actorId: string): Promise<UserSession> {
    this.session = null;
    this.setState('authenticating');
    try {
      if (!Object.hasOwn(KNOWN_FIXTURE_ACTORS, actorId)) {
        throw new Error('auth_login_rejected');
      }
      const response = await this.fetchImpl(`${this.baseUrl}/v1/session/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ actorId }),
      });

      if (!response.ok) {
        this.setState('unauthenticated');
        logSafeTelemetry('auth_login_failed', { status: response.status });
        throw new Error('auth_login_rejected');
      }

      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null) throw new Error('auth_response_invalid');
      const candidate = body as Record<string, unknown>;
      const role = candidate.role;
      const expectedRole = KNOWN_FIXTURE_ACTORS[actorId];
      if (
        candidate.actorId !== actorId
        || !expectedRole
        || role !== expectedRole
        || typeof candidate.accessToken !== 'string'
        || candidate.accessToken.length === 0
        || (candidate.refreshToken !== undefined && typeof candidate.refreshToken !== 'string')
        || (candidate.expiresIn !== undefined && (typeof candidate.expiresIn !== 'number' || !Number.isFinite(candidate.expiresIn) || candidate.expiresIn <= 0))
      ) throw new Error('auth_response_invalid');

      const session: UserSession = {
        actorId,
        role: expectedRole,
        accessToken: candidate.accessToken,
        ...(typeof candidate.refreshToken === 'string' ? { refreshToken: candidate.refreshToken } : {}),
        ...(typeof candidate.expiresIn === 'number' ? { expiresIn: candidate.expiresIn } : {}),
      };

      this.session = session;
      await this.sessionStore.save('accessToken', session.accessToken);
      if (session.refreshToken) {
        await this.sessionStore.save('refreshToken', session.refreshToken);
      }
      this.setState('authenticated');
      logSafeTelemetry('auth_login_success', { role: session.role });
      return session;
    } catch (error) {
      this.setState('unauthenticated');
      throw error;
    }
  }

  async logout(): Promise<void> {
    coordinateRefresh([{ type: 'logout' }]);
    await this.sessionStore.clear();
    this.session = null;
    this.setState('unauthenticated');
    logSafeTelemetry('auth_logout_success', { status: 'logged_out' });
  }

  setRefreshing(isRefreshing: boolean): void {
    if (!this.session) return;
    if (isRefreshing) {
      this.setState('refreshing');
    } else {
      this.setState(this.session ? 'authenticated' : 'unauthenticated');
    }
  }

  refreshSucceeded(accessToken: string, refreshToken?: string): void {
    if (!this.session || this.state === 'unauthenticated' || this.state === 'expired') return;
    this.session = {
      ...this.session,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
    };
    void this.sessionStore.save('accessToken', accessToken);
    if (refreshToken) {
      void this.sessionStore.save('refreshToken', refreshToken);
    }
    this.setState('authenticated');
  }

  async setExpired(): Promise<void> {
    coordinateRefresh([{ type: 'refreshFailed' }]);
    await this.sessionStore.clear();
    this.session = null;
    this.setState('expired');
    logSafeTelemetry('auth_session_expired', { status: 'expired' });
  }

  async restoreFromStorage(actorId: string, role: UserRole): Promise<UserSession | null> {
    const accessToken = await this.sessionStore.get('accessToken');
    const refreshToken = await this.sessionStore.get('refreshToken');
    if (!accessToken) {
      this.session = null;
      this.setState('unauthenticated');
      return null;
    }
    const session: UserSession = {
      actorId,
      role,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
    };
    this.session = session;
    this.setState('authenticated');
    return session;
  }

  subscribe(listener: SessionChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.session, this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(nextState: SessionState): void {
    this.state = nextState;
    for (const listener of this.listeners) {
      listener(this.session, this.state);
    }
  }
}
