/**
 * @jest-environment node
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { HttpIncidentRepository } from '../src/infrastructure/api/HttpIncidentRepository';

describe('HttpIncidentRepository (Pruebas de Contrato y Fallas)', () => {
  let backendProcess: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    backendProcess = spawn(process.execPath, ['course-backend/server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, COURSE_BACKEND_PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    baseUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('backend startup timeout')), 5000);
      backendProcess.stdout?.setEncoding('utf8');
      backendProcess.stdout?.on('data', (chunk) => {
        const match = chunk.match(/(http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
      backendProcess.once('exit', (code) => reject(new Error(`backend exited early: ${code}`)));
    });
  }, 10000);

  afterAll(() => {
    backendProcess?.kill('SIGTERM');
  });

  const nativeFetch = (url: string, init?: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const req = require('node:http').request(url, {
        method: init?.method || 'GET',
        headers: init?.headers,
      }, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: async () => JSON.parse(data),
            text: async () => data,
          });
        });
      });
      
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          req.destroy(new Error('aborted'));
        });
      }

      req.on('error', (err: any) => reject(err));
      if (init?.body) req.write(init.body);
      req.end();
    });
  };

  const createRepo = (scenario: string, timeoutMs: number = 5000) => {
    return new HttpIncidentRepository({
      baseUrl,
      accessToken: 'course-valid-token',
      actorId: 'reporter-1',
      timeoutMs,
      scenario,
      fetchImpl: nativeFetch as any,
    });
  };

  test('success: respuesta válida y mapeo correcto a entidades de dominio', async () => {
    const repo = createRepo('success');
    const response = await repo.getAll();
    expect(response).toBeDefined();
    expect(response.items).toBeInstanceOf(Array);
    if (response.items.length > 0) {
      expect(response.items[0]).toHaveProperty('id');
      expect(response.items[0].payload).not.toBeNull();
    }
  });

  test('nullable: sobre válido con payload: null (no inventa propiedades)', async () => {
    const repo = createRepo('nullable');
    const response = await repo.getAll();
    expect(response.items).toBeInstanceOf(Array);
    if (response.items.length > 0) {
      expect(response.items[0].payload).toBeNull();
    }
  });

  test('malformed: DTO con campos faltantes o tipos incorrectos (rechazado seguro)', async () => {
    const repo = createRepo('malformed');
    await expect(repo.getAll()).rejects.toMatchObject({ kind: 'ContractViolationError' });
  });

  test('server_error: simulación de error HTTP 500 (sin exponer stack traces)', async () => {
    const repo = createRepo('server_error');
    await expect(repo.getAll()).rejects.toMatchObject({ kind: 'ServerError' });
  });

  test('slow: timeout supera umbral y retorna TimeoutError', async () => {
    // Timeout of 500ms since the slow scenario delays for 1200ms
    const repo = createRepo('slow', 500);
    await expect(repo.getAll()).rejects.toMatchObject({ kind: 'TimeoutError' });
  });
});
