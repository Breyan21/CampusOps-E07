import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import type { UserRole } from '../../domain/auth/types';

interface Props {
  visible: boolean;
  currentActorId: string | null;
  onSelectActor: (actorId: string) => Promise<void>;
  onClose: () => void;
}

type ActorOption = Readonly<{
  id: string;
  role: UserRole;
  label: string;
  description: string;
}>;

const ACTORS: readonly ActorOption[] = [
  { id: 'reporter-1', role: 'reporter', label: 'Reportante 1', description: 'Crea incidencias y consulta sus reportes' },
  { id: 'reporter-2', role: 'reporter', label: 'Reportante 2', description: 'Actor secundario para pruebas de aislamiento' },
  { id: 'technician-1', role: 'technician', label: 'Técnico 1', description: 'Atiende y resuelve incidencias asignadas' },
  { id: 'technician-2', role: 'technician', label: 'Técnico 2', description: 'Técnico alterno para pruebas de reasignación' },
  { id: 'coordinator-1', role: 'coordinator', label: 'Coordinador', description: 'Visibilidad total, asigna, prioriza, cierra y reabre' },
];

export const LoginModal: React.FC<Props> = ({ visible, currentActorId, onSelectActor, onClose }) => {
  const [loadingActor, setLoadingActor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (actorId: string) => {
    setLoadingActor(actorId);
    setError(null);
    try {
      await onSelectActor(actorId);
      onClose();
    } catch {
      setError('Error al iniciar sesión con el actor seleccionado.');
    } finally {
      setLoadingActor(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>Seleccionar Perfil de Sesión</Text>
          <Text style={styles.subtitle}>
            Actores didácticos de CampusOps (docs/CAMPUSOPS_API.md). Cada perfil tiene permisos diferenciados.
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.list}>
            {ACTORS.map((actor) => {
              const isSelected = currentActorId === actor.id;
              const isBusy = loadingActor === actor.id;
              return (
                <TouchableOpacity
                  key={actor.id}
                  disabled={loadingActor !== null}
                  style={[styles.actorCard, isSelected && styles.selectedCard]}
                  onPress={() => handleSelect(actor.id)}
                >
                  <View style={styles.actorHeader}>
                    <Text style={styles.actorLabel}>{actor.label} ({actor.id})</Text>
                    <Text style={styles.actorRole}>{actor.role}</Text>
                  </View>
                  <Text style={styles.actorDesc}>{actor.description}</Text>
                  {isBusy ? <ActivityIndicator size="small" color="#007AFF" style={styles.spinner} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.closeButton} onPress={onClose} disabled={loadingActor !== null}>
            <Text style={styles.closeText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 440,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
    color: '#222',
  },
  subtitle: {
    fontSize: 13,
    color: '#666',
    marginBottom: 16,
    lineHeight: 18,
  },
  errorText: {
    color: '#d32f2f',
    marginBottom: 10,
    fontSize: 13,
  },
  list: {
    gap: 10,
    marginBottom: 16,
  },
  actorCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fafafa',
  },
  selectedCard: {
    borderColor: '#007AFF',
    backgroundColor: '#f0f7ff',
  },
  actorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  actorLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
  },
  actorRole: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
    textTransform: 'uppercase',
  },
  actorDesc: {
    fontSize: 12,
    color: '#666',
  },
  spinner: {
    marginTop: 6,
  },
  closeButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  closeText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
});
