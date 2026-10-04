import type { Incident } from '../../domain/incidents/Incident';
import type { CreateIncidentInput, IncidentRepository } from '../../domain/incidents/IncidentRepository';
import type { JsonObject } from '../../course-evaluation/contracts';
import { IncidentApiError } from '../api/IncidentApiError';
import { HttpIncidentRepository, type HttpIncidentRepositoryOptions } from '../api/HttpIncidentRepository';
import type { IncidentResourceDto } from '../api/incidentDtos';
import type { IncidentCategory, IncidentStatus } from '../../campusops/contracts';

const categories: readonly IncidentCategory[] = ['electrical', 'laboratory', 'water', 'connectivity', 'equipment', 'safety', 'maintenance'];
const statuses: readonly IncidentStatus[] = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];
const priorities = ['low', 'medium', 'high', 'urgent'] as const;

/** Maps validated transport resources into the smaller set the app can actually use. */
export class CampusOpsIncidentRepository implements IncidentRepository {
  private readonly client: HttpIncidentRepository;

  constructor(options: HttpIncidentRepositoryOptions) {
    this.client = new HttpIncidentRepository(options);
  }

  async getAll(): Promise<readonly Incident[]> {
    const { items } = await this.client.getAll();
    // A valid null payload has no domain data. Omit it instead of inventing an incident.
    return items.flatMap((item) => {
      const incident = toIncident(item);
      return incident ? [incident] : [];
    });
  }

  async getById(id: string): Promise<Incident | null> {
    const item = await this.client.getById(id);
    return item ? toIncident(item) : null;
  }

  async create(input: CreateIncidentInput, idempotencyKey: string): Promise<Incident> {
    const { incident } = await this.client.create({
      category: input.category,
      description: input.description,
      location: input.location,
    }, idempotencyKey);
    const mapped = toIncident(incident);
    if (!mapped) throw new IncidentApiError('ContractViolationError');
    return mapped;
  }
}

function toIncident(resource: IncidentResourceDto): Incident | null {
  if (resource.payload === null) return null;
  const payload: JsonObject = resource.payload;
  const { category, description, location, priority, assignedTechnicianId } = payload;
  if (
    typeof category !== 'string' || !categories.includes(category as IncidentCategory)
    || typeof description !== 'string' || description.trim().length === 0
    || typeof location !== 'string' || location.trim().length === 0
    || typeof priority !== 'string' || !priorities.includes(priority as (typeof priorities)[number])
    || !statuses.includes(resource.status as IncidentStatus)
    || !(assignedTechnicianId === null || typeof assignedTechnicianId === 'string')
  ) throw new IncidentApiError('ContractViolationError');

  return {
    id: resource.id,
    category: category as IncidentCategory,
    description,
    location: { source: 'manual', label: location },
    status: resource.status as IncidentStatus,
    priority: priority as Incident['priority'],
    assignedTechnicianId,
  };
}
