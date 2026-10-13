import type { Incident } from '../../domain/incidents/Incident';
import type { IncidentRepository } from '../../domain/incidents/IncidentRepository';
import type { UserRole } from '../../domain/auth/types';
import {
  canAssignIncident,
  canCloseIncident,
  canPrioritizeIncident,
  canReopenIncident,
  canResolveIncident,
  canStartIncident,
} from '../../domain/auth/permissions';
import { createIdempotencyKey } from './CreateIncident';

export type IncidentAction = 'start' | 'resolve' | 'close' | 'reopen' | 'assign' | 'prioritize';

export type ExecuteActionInput = Readonly<{
  incident: Incident;
  action: IncidentAction;
  userRole: UserRole;
  actorId: string;
  diagnosis?: string;
  technicianId?: string;
  priority?: 'low' | 'medium' | 'high';
  idempotencyKey?: string;
}>;

export class ExecuteIncidentAction {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(input: ExecuteActionInput): Promise<Incident> {
    const { incident, action, userRole, actorId } = input;

    // Validación de permisos según el perfil del usuario activo (docs/CAMPUSOPS.md)
    switch (action) {
      case 'start':
        if (!canStartIncident(userRole, incident.status, incident.assignedTechnicianId, actorId)) {
          throw new Error('Permiso denegado: sólo el técnico asignado puede iniciar atención en la incidencia.');
        }
        break;
      case 'resolve':
        if (!canResolveIncident(userRole, incident.status, incident.assignedTechnicianId, actorId)) {
          throw new Error('Permiso denegado: sólo el técnico asignado puede resolver una incidencia en proceso.');
        }
        if (!input.diagnosis || input.diagnosis.trim().length === 0) {
          throw new Error('El diagnóstico es requerido para resolver la incidencia.');
        }
        break;
      case 'close':
        if (!canCloseIncident(userRole, incident.status)) {
          throw new Error('Permiso denegado: sólo la coordinación puede cerrar incidencias resueltas.');
        }
        break;
      case 'reopen':
        if (!canReopenIncident(userRole, incident.status)) {
          throw new Error('Permiso denegado: sólo la coordinación puede reabrir incidencias resueltas o cerradas.');
        }
        break;
      case 'assign':
        if (!canAssignIncident(userRole)) {
          throw new Error('Permiso denegado: sólo la coordinación puede asignar técnicos.');
        }
        if (!input.technicianId || input.technicianId.trim().length === 0) {
          throw new Error('El identificador del técnico es requerido para asignar.');
        }
        break;
      case 'prioritize':
        if (!canPrioritizeIncident(userRole)) {
          throw new Error('Permiso denegado: sólo la coordinación puede cambiar la prioridad.');
        }
        if (!input.priority) {
          throw new Error('La nueva prioridad es requerida.');
        }
        break;
    }

    if (!this.repository.executeAction) {
      throw new Error('El repositorio configurado no soporta la ejecución de acciones.');
    }

    const baseVersion = incident.version ?? 1;
    const body: Record<string, unknown> = {
      action,
      baseVersion,
      ...(input.diagnosis ? { diagnosis: input.diagnosis.trim() } : {}),
      ...(input.technicianId ? { technicianId: input.technicianId.trim() } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
    };

    const key = input.idempotencyKey ?? createIdempotencyKey();
    return this.repository.executeAction(incident.id, body, key);
  }
}
