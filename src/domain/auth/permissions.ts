import type { UserRole } from './types';
import type { IncidentStatus } from '../../campusops/contracts';

/**
 * Reglas de autorización formal de CampusOps basadas en roles y propiedad de incidencias.
 * Fuente: docs/CAMPUSOPS.md y docs/CAMPUSOPS_API.md
 */

export function canCreateIncident(role: UserRole): boolean {
  // El contrato del backend sólo permite crear reportes con el perfil reportante.
  return role === 'reporter';
}

export function canStartIncident(
  role: UserRole,
  status: IncidentStatus | string,
  assignedTechnicianId?: string | null,
  currentActorId?: string,
): boolean {
  if (role !== 'technician') return false;
  if (!assignedTechnicianId || !currentActorId || assignedTechnicianId !== currentActorId) return false;
  return status === 'assigned';
}

export function canResolveIncident(
  role: UserRole,
  status: IncidentStatus | string,
  assignedTechnicianId?: string | null,
  currentActorId?: string,
): boolean {
  if (role !== 'technician') return false;
  if (!assignedTechnicianId || !currentActorId || assignedTechnicianId !== currentActorId) return false;
  return status === 'in_progress';
}

export function canCloseIncident(role: UserRole, status: IncidentStatus | string): boolean {
  if (role !== 'coordinator') return false;
  return status === 'resolved';
}

export function canReopenIncident(role: UserRole, status: IncidentStatus | string): boolean {
  if (role !== 'coordinator') return false;
  return status === 'resolved' || status === 'closed';
}

export function canAssignIncident(role: UserRole): boolean {
  return role === 'coordinator';
}

export function canPrioritizeIncident(role: UserRole): boolean {
  return role === 'coordinator';
}

export function canComment(_role: UserRole): boolean {
  return true;
}

export function canAddEvidence(_role: UserRole): boolean {
  return true;
}

export function isIncidentVisible(
  role: UserRole,
  actorId: string,
  reporterId?: string,
  assignedTechnicianId?: string | null,
): boolean {
  if (role === 'coordinator') return true;
  if (role === 'reporter') return reporterId === actorId;
  if (role === 'technician') return assignedTechnicianId === actorId;
  return false;
}
