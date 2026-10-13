import type {
  IncidentCategory,
  IncidentLocation,
  IncidentStatus,
} from '../../campusops/contracts';

export type IncidentPriority = 'low' | 'medium' | 'high' | 'urgent';

export type Incident = Readonly<{
  id: string;
  version?: number;
  title?: string;
  category: IncidentCategory;
  description: string;
  status: IncidentStatus;
  priority: IncidentPriority;
  assignedTechnicianId?: string | null;
  location?: IncidentLocation;
  createdAt?: string;
  updatedAt?: string;
}>;
