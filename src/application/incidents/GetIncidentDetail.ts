import type { Incident } from '../../domain/incidents/Incident';
import type { IncidentRepository } from '../../domain/incidents/IncidentRepository';

export class GetIncidentDetail {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(id: string): Promise<Incident | null> {
    if (!id || id.trim().length === 0) {
      return null;
    }
    return this.repository.getById(id.trim());
  }
}
