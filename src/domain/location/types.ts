import type { IncidentLocation } from '../../campusops/contracts';

export type GeographicCoordinates = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type GeocodingResult = GeographicCoordinates
  & Pick<IncidentLocation, 'label'>;

export type ProviderIncidentLocation = Omit<
  IncidentLocation,
  'source' | 'latitude' | 'longitude'
> & GeographicCoordinates & Readonly<{ source: 'provider' }>;

export type ManualIncidentLocation = Omit<
  IncidentLocation,
  'source' | 'latitude' | 'longitude'
> & Readonly<{ source: 'manual' }>;

export type IncidentLocationSelection =
  | ProviderIncidentLocation
  | ManualIncidentLocation;

export type RetryPolicyOptions = Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>;

export type RetryDecision = Readonly<{
  retry: boolean;
  delayMs: number;
  requiresStableIdempotencyKey: boolean;
}>;
