export type BackendHealth = Readonly<{
  ok: true;
  service: 'dmi-controlled-backend';
  contractVersion: 1;
}>;

const DEFAULT_URL = 'http://127.0.0.1:4310';
const REQUEST_TIMEOUT_MS = 5000;

export const GENERIC_NETWORK_ERROR = 'Error de conexión';

type FailureReason = 'network' | 'timeout' | 'http' | 'contract';

// Error público: el mensaje nunca incluye URL, puerto, ruta ni la causa original.
export class BackendUnavailableError extends Error {
  readonly reason: FailureReason;

  constructor(reason: FailureReason) {
    super(GENERIC_NETWORK_ERROR);
    this.name = 'BackendUnavailableError';
    this.reason = reason;
  }
}

function fail(reason: FailureReason, status?: number): never {
  // Solo contexto técnico seguro: tipo de falla y código HTTP.
  console.error(`[courseBackend] health check falló: ${reason}${status ? ` (HTTP ${status})` : ''}`);
  throw new BackendUnavailableError(reason);
}

export async function getBackendHealth(
  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,
): Promise<BackendHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
  } catch (error) {
    // ECONNREFUSED, ETIMEDOUT, DNS, abort: se descarta el error original (trae host y stack).
    fail(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    fail('http', response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    fail('contract');
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('ok' in payload) ||
    payload.ok !== true ||
    !('contractVersion' in payload) ||
    payload.contractVersion !== 1
  ) {
    fail('contract');
  }
  return payload as BackendHealth;
}
