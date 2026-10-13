import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import type { Incident } from '../../domain/incidents/Incident';
import type { GetIncidentDetail } from '../../application/incidents/GetIncidentDetail';
import type { ExecuteIncidentAction } from '../../application/incidents/ExecuteIncidentAction';
import type { UserRole } from '../../domain/auth/types';
import {
  canAssignIncident,
  canCloseIncident,
  canPrioritizeIncident,
  canReopenIncident,
  canResolveIncident,
  canStartIncident,
} from '../../domain/auth/permissions';
import { logSafeTelemetry } from '../../telemetry/safeTelemetry';
import { isIncidentApiError } from '../../domain/errors/IncidentApiError';

interface Props {
  getIncidentDetailUseCase: GetIncidentDetail;
  executeIncidentActionUseCase?: ExecuteIncidentAction;
  incidentId: string;
  onBack: () => void;
  currentRole?: UserRole | null;
  currentActorId?: string | null;
}

const defaultLoadErrorMessage = 'No se pudo conectar para consultar la incidencia.';

interface DetailState {
  incidentId: string;
  incident: Incident | null;
  failed: boolean;
  message: string;
}

export const IncidentDetailScreen: React.FC<Props> = ({
  getIncidentDetailUseCase,
  executeIncidentActionUseCase,
  incidentId,
  onBack,
  currentRole,
  currentActorId,
}) => {
  const [state, setState] = useState<DetailState | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    getIncidentDetailUseCase.execute(incidentId).then((data: Incident | null) => {
      if (requestRef.current !== requestId) return;
      setState({ incidentId, incident: data, failed: false, message: defaultLoadErrorMessage });
    }).catch((error: unknown) => {
      logSafeTelemetry('incident_detail_load_failed', { feature: 'incident_detail', incidentId, status: 'error' });
      if (requestRef.current !== requestId) return;
      setState({
        incidentId,
        incident: null,
        failed: true,
        message: isIncidentApiError(error) && error.kind === 'ServerError'
          ? 'El servidor tuvo un problema. Inténtalo de nuevo más tarde.'
          : defaultLoadErrorMessage,
      });
    });
    return () => { requestRef.current += 1; };
  }, [getIncidentDetailUseCase, incidentId]);

  const handleAction = async (
    action: 'start' | 'resolve' | 'close' | 'reopen' | 'assign' | 'prioritize',
    extra?: { diagnosis?: string; technicianId?: string; priority?: 'low' | 'medium' | 'high' },
  ) => {
    if (!executeIncidentActionUseCase || !state?.incident) return;
    if (!currentRole || !currentActorId) {
      setActionError('Inicia sesión para ejecutar esta operación.');
      return;
    }
    setActionInProgress(true);
    setActionError(null);
    try {
      const updated = await executeIncidentActionUseCase.execute({
        incident: state.incident,
        action,
        userRole: currentRole ?? 'reporter',
        actorId: currentActorId ?? 'reporter-1',
        ...extra,
      });
      setState({ incidentId, incident: updated, failed: false, message: '' });
      setShowResolveDialog(false);
      setDiagnosis('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al ejecutar la acción';
      setActionError(msg);
    } finally {
      setActionInProgress(false);
    }
  };

  const loading = state === null || state.incidentId !== incidentId;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  if (state.failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{state.message}</Text>
        <TouchableOpacity style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const incident = state.incident;

  if (!incident) {
    return (
      <View style={styles.center}>
        <Text>No se encontró la incidencia.</Text>
        <TouchableOpacity style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const role = currentRole ?? null;
  const actor = currentActorId ?? null;

  const canStart = Boolean(role && actor && canStartIncident(role, incident.status, incident.assignedTechnicianId, actor));
  const canResolve = Boolean(role && actor && canResolveIncident(role, incident.status, incident.assignedTechnicianId, actor));
  const canClose = Boolean(role && canCloseIncident(role, incident.status));
  const canReopen = Boolean(role && canReopenIncident(role, incident.status));
  const canAssign = Boolean(role && canAssignIncident(role));
  const canPrioritize = Boolean(role && canPrioritizeIncident(role));

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>← Volver a la lista</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.title}>{incident.title ?? incident.description}</Text>

        <View style={styles.infoRow}>
          <Text style={styles.label}>ID:</Text>
          <Text style={styles.value}>{incident.id}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>Estado:</Text>
          <Text style={[styles.value, styles.statusValue]}>{incident.status}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>Categoría:</Text>
          <Text style={styles.value}>{incident.category}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>Prioridad:</Text>
          <Text style={styles.value}>{incident.priority}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>Técnico:</Text>
          <Text style={styles.value}>{incident.assignedTechnicianId ?? 'Sin asignar'}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>Ubicación:</Text>
          <Text style={styles.value}>{incident.location?.label ?? 'No especificada'}</Text>
        </View>

        <Text style={styles.descriptionLabel}>Descripción:</Text>
        <Text style={styles.description}>{incident.description}</Text>
      </View>

      {/* Panel de acciones autorizadas según el perfil */}
      <View style={styles.actionsPanel}>
        <Text style={styles.actionsTitle}>Operaciones disponibles ({role ?? 'sin autenticar'})</Text>

        {actionError ? <Text style={styles.actionErrorText}>{actionError}</Text> : null}

        {/* Técnico: Iniciar atención */}
        {canStart ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.startBtn]}
            disabled={actionInProgress}
            onPress={() => handleAction('start')}
          >
            <Text style={styles.actionBtnText}>{actionInProgress ? 'Iniciando...' : 'Iniciar Atención'}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Técnico: Resolver */}
        {canResolve && !showResolveDialog ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.resolveBtn]}
            disabled={actionInProgress}
            onPress={() => setShowResolveDialog(true)}
          >
            <Text style={styles.actionBtnText}>Resolver Incidencia</Text>
          </TouchableOpacity>
        ) : null}

        {/* Formulario de diagnóstico para resolver */}
        {showResolveDialog ? (
          <View style={styles.diagnosisBox}>
            <Text style={styles.diagnosisLabel}>Diagnóstico de resolución:</Text>
            <TextInput
              placeholder="Escribe el diagnóstico o solución aplicada..."
              value={diagnosis}
              onChangeText={setDiagnosis}
              style={styles.diagnosisInput}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.resolveBtn, !diagnosis.trim() && styles.disabledButton]}
                disabled={actionInProgress || !diagnosis.trim()}
                onPress={() => handleAction('resolve', { diagnosis })}
              >
                <Text style={styles.actionBtnText}>{actionInProgress ? 'Guardando...' : 'Confirmar Resolución'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setShowResolveDialog(false); setDiagnosis(''); }}
              >
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Coordinador: Cerrar */}
        {canClose ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.closeBtn]}
            disabled={actionInProgress}
            onPress={() => handleAction('close')}
          >
            <Text style={styles.actionBtnText}>{actionInProgress ? 'Cerrando...' : 'Cerrar Incidencia'}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Coordinador: Reabrir */}
        {canReopen ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.reopenBtn]}
            disabled={actionInProgress}
            onPress={() => handleAction('reopen')}
          >
            <Text style={styles.actionBtnText}>{actionInProgress ? 'Reabriendo...' : 'Reabrir Incidencia'}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Coordinador: Reasignar técnico */}
        {canAssign ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.assignBtn]}
            disabled={actionInProgress}
            onPress={() => {
              const targetTech = incident.assignedTechnicianId === 'technician-1' ? 'technician-2' : 'technician-1';
              handleAction('assign', { technicianId: targetTech });
            }}
          >
            <Text style={styles.actionBtnText}>
              {actionInProgress ? 'Asignando...' : `Reasignar a ${incident.assignedTechnicianId === 'technician-1' ? 'technician-2' : 'technician-1'}`}
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Coordinador: Cambiar prioridad */}
        {canPrioritize ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.prioritizeBtn]}
            disabled={actionInProgress}
            onPress={() => {
              const nextPriority = incident.priority === 'high' ? 'medium' : 'high';
              handleAction('prioritize', { priority: nextPriority });
            }}
          >
            <Text style={styles.actionBtnText}>
              {actionInProgress ? 'Actualizando...' : `Cambiar Prioridad a ${incident.priority === 'high' ? 'Media' : 'Alta'}`}
            </Text>
          </TouchableOpacity>
        ) : null}

        {!canStart && !canResolve && !canClose && !canReopen && !canAssign && !canPrioritize && (
          <Text style={styles.noActionsText}>
            {role ? 'No hay operaciones de estado permitidas para el perfil actual sobre esta incidencia.' : 'Inicia sesión para consultar las operaciones de esta incidencia.'}
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButton: {
    marginTop: 20,
    marginBottom: 12,
    paddingVertical: 6,
  },
  backButtonText: {
    fontSize: 15,
    color: '#007AFF',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#222',
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  label: {
    fontWeight: 'bold',
    width: 90,
    color: '#555',
  },
  value: {
    flex: 1,
    color: '#333',
  },
  statusValue: {
    fontWeight: '700',
    color: '#007AFF',
    textTransform: 'uppercase',
  },
  descriptionLabel: {
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 4,
    color: '#555',
  },
  description: {
    lineHeight: 20,
    color: '#444',
  },
  actionsPanel: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    gap: 10,
  },
  actionsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  startBtn: { backgroundColor: '#0288d1' },
  resolveBtn: { backgroundColor: '#388e3c' },
  closeBtn: { backgroundColor: '#c2185b' },
  reopenBtn: { backgroundColor: '#f57c00' },
  assignBtn: { backgroundColor: '#7b1fa2' },
  prioritizeBtn: { backgroundColor: '#00796b' },
  disabledButton: { backgroundColor: '#b0bec5' },
  actionErrorText: { color: '#d32f2f', fontSize: 13, marginBottom: 4 },
  noActionsText: { color: '#888', fontStyle: 'italic', fontSize: 13 },
  diagnosisBox: {
    backgroundColor: '#f1f8e9',
    padding: 12,
    borderRadius: 6,
    gap: 8,
  },
  diagnosisLabel: { fontSize: 13, fontWeight: '600', color: '#2e7d32' },
  diagnosisInput: { borderWidth: 1, borderColor: '#a5d6a7', borderRadius: 4, padding: 8, backgroundColor: '#fff' },
  dialogActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  cancelBtn: { padding: 10 },
  cancelText: { color: '#666', fontWeight: '600' },
  errorText: { color: '#c62828', marginBottom: 12 },
  button: {
    padding: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
