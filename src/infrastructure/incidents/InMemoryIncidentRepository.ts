import type { Incident } from '../../domain/incidents/Incident';
import type { IncidentRepository } from '../../domain/incidents/IncidentRepository';

export const DEFAULT_SYNTHETIC_INCIDENTS: readonly Incident[] = [
  {
    id: 'inc-001',
    title: 'Fuga de agua en sanitarios de Biblioteca Central',
    category: 'water',
    description: 'Goteo continuo en tubería principal del segundo piso con riesgo de filtración a salas de estudio.',
    status: 'open',
    priority: 'high',
    assignedTechnicianId: null,
    location: {
      source: 'manual',
      label: 'Biblioteca Central - Segundo Piso',
    },
    createdAt: '2026-09-14T08:30:00.000Z',
    updatedAt: '2026-09-14T08:30:00.000Z',
  },
  {
    id: 'inc-002',
    title: 'Falla en panel eléctrico del Laboratorio L4',
    category: 'electrical',
    description: 'Sobrecarga en interruptor termomagnético que suministra energía a los racks de prácticas.',
    status: 'assigned',
    priority: 'urgent',
    assignedTechnicianId: 'tech-042',
    location: {
      source: 'manual',
      label: 'Edificio de Ingeniería - Lab L4',
      latitude: 19.4326,
      longitude: -99.1332,
    },
    createdAt: '2026-09-14T09:15:00.000Z',
    updatedAt: '2026-09-14T09:45:00.000Z',
  },
  {
    id: 'inc-003',
    title: 'Proyector sin señal en Aula Magna 101',
    category: 'equipment',
    description: 'Cable de conexión HDMI dañado y puerto de entrada flojo en consola docente.',
    status: 'in_progress',
    priority: 'medium',
    assignedTechnicianId: 'tech-018',
    location: {
      source: 'manual',
      label: 'Edificio Central - Aula Magna 101',
    },
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T10:20:00.000Z',
  },
];

export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly incidents: Map<string, Incident>;

  constructor(initialIncidents: readonly Incident[] = DEFAULT_SYNTHETIC_INCIDENTS) {
    this.incidents = new Map(
      initialIncidents.map((incident) => [incident.id, incident]),
    );
  }

  async getAll(): Promise<readonly Incident[]> {
    return Array.from(this.incidents.values());
  }

  async getById(id: string): Promise<Incident | null> {
    return this.incidents.get(id) ?? null;
  }
}
