import type { Incident } from './Incident';
import type { IncidentCategory } from '../../campusops/contracts';

export type CreateIncidentInput = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
  title?: string;
}>;

export interface IncidentRepository {
  getAll(): Promise<readonly Incident[]>;
  getById(id: string): Promise<Incident | null>;
  create(input: CreateIncidentInput, idempotencyKey: string): Promise<Incident>;
}
