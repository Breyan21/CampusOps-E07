import { redactForTelemetry } from '../course-evaluation';

/**
 * Emits only structured, sanitized diagnostics. Callers must use a stable
 * category instead of passing an Error instance or raw server response.
 */
export function logSafeTelemetry(event: string, metadata: Readonly<Record<string, unknown>>): void {
  console.info(`[CampusOps] ${event}`, redactForTelemetry(metadata));
}
