import type { Incident } from '../../domain/incidents/Incident';
import type { IncidentRepository } from '../../domain/incidents/IncidentRepository';

export class ListIncidents {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(): Promise<readonly Incident[]> {
    return this.repository.getAll();
  }
}
