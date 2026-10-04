import type { CreateIncidentInput, IncidentRepository } from '../../domain/incidents/IncidentRepository';
import type { Incident } from '../../domain/incidents/Incident';

let operationSequence = 0;

/** Creates one operation key; callers keep it when retrying an uncertain submission. */
export function createIdempotencyKey(): string {
  operationSequence += 1;
  return `campusops-${Date.now().toString(36)}-${operationSequence.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class CreateIncident {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(input: CreateIncidentInput, idempotencyKey = createIdempotencyKey()): Promise<Incident> {
    const normalized = {
      ...input,
      description: input.description.trim(),
      location: input.location.trim(),
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
    };
    if (!normalized.description || !normalized.location || !idempotencyKey.trim()) {
      throw new Error('incident_input_invalid');
    }
    return this.repository.create(normalized, idempotencyKey);
  }
}
