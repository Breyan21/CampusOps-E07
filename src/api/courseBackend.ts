export type BackendHealth = Readonly<{
  ok: true;
  service: 'dmi-controlled-backend';
  contractVersion: 1;
}>;

const DEFAULT_URL = 'http://127.0.0.1:4310';

export async function getBackendHealth(
  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,
  apiKey = process.env.EXPO_PUBLIC_BACKEND_API_KEY,
): Promise<BackendHealth> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`, { headers });
  } catch {
    throw new Error('No fue posible conectar con el servicio.');
  }

  if (!response.ok) {
    throw new Error('No fue posible conectar con el servicio.');
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('ok' in payload) ||
    payload.ok !== true ||
    !('contractVersion' in payload) ||
    payload.contractVersion !== 1
  ) {
    throw new Error('Backend health contract mismatch');
  }
  return payload as BackendHealth;
}
