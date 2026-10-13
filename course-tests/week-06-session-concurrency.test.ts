/**
 * @jest-environment node
 *
 * Actividad Semana 6 — arnés TEMPORAL de observación (no es parte del producto).
 * Ejecuta A, B y C en paralelo contra el backend local con un accessToken inválido,
 * usando el MISMO CampusOpsIncidentRepository que instancia App.tsx, y registra logs.
 *
 *   Caso A (refreshToken válido):   $env:SESSION_CASE="A"; npx jest course-tests/week-06-session-concurrency.test.ts
 *   Caso B (refreshToken inválido): $env:SESSION_CASE="B"; npx jest course-tests/week-06-session-concurrency.test.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { CampusOpsIncidentRepository } from '../src/infrastructure/incidents/CampusOpsIncidentRepository';
import { getToken, saveToken } from '../src/infrastructure/storage/SecureStorageService';
import { isIncidentApiError } from '../src/infrastructure/api/IncidentApiError';

// SecureStore nativo no existe en Node: se sustituye por un Map en memoria.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: async (k: string, v: string) => { store.set(k, v); },
    getItemAsync: async (k: string) => store.get(k) ?? null,
    deleteItemAsync: async (k: string) => { store.delete(k); },
  };
});

const CASE = (process.env.SESSION_CASE ?? 'A').toUpperCase() === 'B' ? 'B' : 'A';
// Única condición que cambia entre casos:
const REFRESH_TOKEN = CASE === 'A' ? 'course-refresh-0' : 'course-refresh-REVOCADO';
const EXPIRED_ACCESS_TOKEN = 'course-expired-token';
const PENDING_LIMIT_MS = 3000;

const t0 = Date.now();
const log = (line: string) => process.stdout.write(`+${String(Date.now() - t0).padStart(4, ' ')}ms  ${line}\n`);

type Raw = { ok: boolean; status: number; json: () => Promise<unknown> };
function nodeFetch(url: string, init?: RequestInit): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init?.method ?? 'GET', headers: init?.headers as Record<string, string> }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({
        ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
        status: res.statusCode ?? 0,
        json: async () => JSON.parse(data),
      }));
    });
    init?.signal?.addEventListener('abort', () => req.destroy(new Error('aborted')));
    req.on('error', reject);
    if (init?.body) req.write(init.body as string);
    req.end();
  });
}

describe(`Semana 6 — Caso ${CASE}: A, B y C con accessToken inválido`, () => {
  let backend: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    backend = spawn(process.execPath, ['course-backend/server.mjs'], {
      cwd: process.cwd(), env: { ...process.env, COURSE_BACKEND_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('backend startup timeout')), 5000);
      backend.stdout?.setEncoding('utf8');
      backend.stdout?.on('data', (chunk: string) => {
        const m = chunk.match(/(http:\/\/127\.0\.0\.1:\d+)/);
        if (m) { clearTimeout(timer); resolve(m[1]!); }
      });
    });
  }, 10000);

  afterAll(() => { backend?.kill(); });

  test('observar 401, refresh, reintentos y estado final de la sesión', async () => {
    // Telemetría real de la app (logSafeTelemetry usa console.info): se imprime compacta.
    jest.spyOn(console, 'info').mockImplementation((event: unknown, meta: unknown) => {
      log(`    [TELEMETRY] ${String(event)} ${JSON.stringify(meta)}`);
    });

    const counters = { requests: 0, unauthorized: 0, refresh: 0, retries: 0 };
    const seen = new Set<string>();

    // Etiqueta cada petición del cliente real por método + ruta.
    const tagOf = (url: string, method: string): string => {
      const path = new URL(url).pathname;
      if (path === '/v1/session/refresh') return 'AUTH';
      if (method === 'POST' && path === '/v1/incidents') return 'C';
      if (path.startsWith('/v1/incidents/')) return 'B';
      if (path === '/v1/incidents') return 'A';
      return '?';
    };

    const observedFetch = async (url: string, init?: RequestInit): Promise<Raw> => {
      const method = init?.method ?? 'GET';
      const tag = tagOf(url, method);
      if (tag === 'AUTH') { counters.refresh += 1; log(`[AUTH] REFRESH START (#${counters.refresh})`); }
      else {
        counters.requests += 1;
        const isRetry = seen.has(tag);
        if (isRetry) counters.retries += 1;
        seen.add(tag);
        log(`[${tag}] ${isRetry ? 'RETRY' : 'REQUEST'} ${method} ${new URL(url).pathname}`);
      }
      const res = await nodeFetch(url, init);
      if (tag === 'AUTH') log(`[AUTH] REFRESH ${res.ok ? 'SUCCESS' : `FAILED (${res.status})`}`);
      else if (res.status === 401) { counters.unauthorized += 1; log(`[${tag}] 401 Unauthorized`); }
      else log(`[${tag}] ${res.status}`);
      return res;
    };

    // ---- Preparación de la sesión -------------------------------------------------
    await saveToken('accessToken', EXPIRED_ACCESS_TOKEN);
    await saveToken('refreshToken', REFRESH_TOKEN);
    log(`[SETUP] Caso ${CASE}: accessToken=INVÁLIDO, refreshToken=${CASE === 'A' ? 'VÁLIDO' : 'INVÁLIDO'}`);
    // Verificación de la precondición directo contra el backend (NO es parte de la app ni se cuenta).
    const pre = await nodeFetch(`${baseUrl}/v1/session/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: REFRESH_TOKEN }),
    });
    log(`[SETUP] precondición: el backend respondería ${pre.status} a /v1/session/refresh con ese refreshToken`);

    // Igual que App.tsx, pero con el token leído del almacenamiento (expirado).
    const repository = new CampusOpsIncidentRepository({
      baseUrl,
      accessToken: (await getToken('accessToken')) ?? '',
      actorId: 'reporter-1',
      fetchImpl: observedFetch as unknown as typeof fetch,
    });

    // ---- A, B y C casi al mismo tiempo ------------------------------------------------
    log('---------------- Promise.allSettled([A, B, C]) ----------------');
    const withLimit = <T,>(p: Promise<T>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('PENDIENTE')), PENDING_LIMIT_MS); });
      return Promise.race([p, limit]).finally(() => clearTimeout(timer));
    };
    const results = await Promise.allSettled([
      withLimit(repository.getAll()),
      withLimit(repository.getById('campus-inc-001')),
      withLimit(repository.create({ category: 'water', description: 'Fuga en baño (prueba S6)', location: 'Edificio de prueba A' }, 'week06-concurrency-key-001')),
    ]);

    log('---------------- RESULTADO FINAL ----------------');
    (['A', 'B', 'C'] as const).forEach((tag, i) => {
      const r = results[i]!;
      if (r.status === 'fulfilled') log(`[${tag}] RESULT OK`);
      else {
        const e = r.reason;
        log(`[${tag}] RESULT RECHAZADA -> ${isIncidentApiError(e) ? `${e.kind} (HTTP ${e.status})` : (e as Error).message}`);
      }
    });
    log(`[RESUMEN] peticiones=${counters.requests} 401=${counters.unauthorized} refresh=${counters.refresh} reintentos=${counters.retries}`);
    const access = await getToken('accessToken');
    const refresh = await getToken('refreshToken');
    log(`[SESSION] accessToken en SecureStore: ${access ? 'SIGUE GUARDADO' : 'ELIMINADO'}`);
    log(`[SESSION] refreshToken en SecureStore: ${refresh ? 'SIGUE GUARDADO' : 'ELIMINADO'}`);
    log(`[SESSION] peticiones pendientes: ${results.some((r) => r.status === 'rejected' && (r.reason as Error).message === 'PENDIENTE') ? 'SÍ' : 'NO'}`);

    expect(results).toHaveLength(3);
  }, 15000);
});
