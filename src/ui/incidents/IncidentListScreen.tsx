import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import type { Incident } from '../../domain/incidents/Incident';
import type { ListIncidents } from '../../application/incidents/ListIncidents';
import type { CreateIncident } from '../../application/incidents/CreateIncident';
import type { IncidentCategory } from '../../campusops/contracts';
import type { UserRole } from '../../domain/auth/types';
import { canCreateIncident } from '../../domain/auth/permissions';
import { createIdempotencyKey } from '../../application/incidents/CreateIncident';
import { logSafeTelemetry } from '../../telemetry/safeTelemetry';
import { isIncidentApiError } from '../../domain/errors/IncidentApiError';
import type { GeocodingService } from '../../infrastructure/location/GeocodingService';

interface Props {
  listIncidentsUseCase: ListIncidents;
  createIncidentUseCase: CreateIncident;
  onSelectIncident: (id: string) => void;
  currentRole?: UserRole | null;
  currentActorId?: string | null;
  geocodingService?: GeocodingService;
}

const categories: readonly IncidentCategory[] = [
  'electrical', 'laboratory', 'water', 'connectivity', 'equipment', 'safety', 'maintenance'
];

const defaultLoadErrorMessage = 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.';

export const IncidentListScreen: React.FC<Props> = ({
  listIncidentsUseCase,
  createIncidentUseCase,
  onSelectIncident,
  currentRole,
  currentActorId,
  geocodingService,
}) => {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState(defaultLoadErrorMessage);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [category, setCategory] = useState<IncidentCategory>('maintenance');
  const [createError, setCreateError] = useState('');
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const requestRef = useRef(0);
  const role = currentRole ?? null;
  const hasSession = Boolean(role && currentActorId);

  const runLoad = useCallback(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    listIncidentsUseCase.execute().then((data: readonly Incident[]) => {
      if (requestRef.current !== requestId) return;
      setIncidents(data);
      setLoadError(false);
      setLoadErrorMessage(defaultLoadErrorMessage);
      setLoading(false);
    }).catch((error: unknown) => {
      logSafeTelemetry('incident_list_load_failed', { feature: 'incident_list', status: 'error' });
      if (requestRef.current !== requestId) return;
      setLoadError(true);
      setLoadErrorMessage(
        isIncidentApiError(error) && error.kind === 'ServerError'
          ? 'El servidor tuvo un problema. Inténtalo de nuevo más tarde.'
          : defaultLoadErrorMessage,
      );
      setLoading(false);
    });
  }, [listIncidentsUseCase]);

  useEffect(() => {
    runLoad();
    return () => { requestRef.current += 1; };
  }, [runLoad]);

  const reload = () => {
    setLoading(true);
    setLoadError(false);
    setLoadErrorMessage(defaultLoadErrorMessage);
    runLoad();
  };

  const handleVerifyLocation = async () => {
    if (!geocodingService || !location.trim()) return;
    try {
      const selection = await geocodingService.geocode(location);
      if (selection.source === 'provider') {
        setLocationStatus(`Coordenadas confirmadas: (${selection.latitude.toFixed(2)}, ${selection.longitude.toFixed(2)})`);
      } else {
        setLocationStatus('Proveedor no disponible o sin coordenadas. Se conservará como referencia manual.');
      }
    } catch {
      setLocationStatus('Falla de red en mapas. Se conservará como referencia manual.');
    }
  };

  const submit = async () => {
    if (!hasSession || !role || !canCreateIncident(role)) {
      setCreateError('Permiso denegado: tu perfil no tiene autorización para crear incidencias.');
      return;
    }
    setCreating(true);
    setCreateError('');
    const key = retryKey ?? createIdempotencyKey();
    setRetryKey(key);
    try {
      await createIncidentUseCase.execute({ category, description, location }, key);
      setDescription('');
      setLocation('');
      setLocationStatus(null);
      setRetryKey(null);
      setCreating(false);
      reload();
    } catch (error: unknown) {
      logSafeTelemetry('incident_create_failed', { feature: 'incident_create', status: 'error' });
      setCreateError(
        isIncidentApiError(error) && error.kind === 'ServerError'
          ? 'El servidor tuvo un problema. Inténtalo de nuevo más tarde.'
          : 'No se pudo conectar. Puedes reintentar de forma segura.',
      );
      setCreating(false);
    }
  };

  const showCreateForm = hasSession && role !== null && canCreateIncident(role);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Incidencias</Text>

      {loadError ? (
        <View accessibilityRole="alert" style={styles.errorBox}>
          <Text style={styles.errorText}>{loadErrorMessage}</Text>
          <TouchableOpacity onPress={reload}>
            <Text style={styles.link}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {incidents.length === 0 && !loadError ? (
        <Text style={styles.emptyText}>No hay incidencias disponibles para este perfil.</Text>
      ) : null}

      <FlatList
        data={incidents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => onSelectIncident(item.id)}>
            <Text style={styles.cardTitle}>{item.description}</Text>
            <View style={styles.cardMeta}>
              <Text style={styles.cardStatus}>Estado: {item.status}</Text>
              <Text style={styles.cardCategory}>{item.category}</Text>
            </View>
            {item.assignedTechnicianId ? (
              <Text style={styles.cardTech}>Técnico: {item.assignedTechnicianId}</Text>
            ) : null}
          </TouchableOpacity>
        )}
      />

      {showCreateForm ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>Crear incidencia</Text>
          <TextInput
            accessibilityLabel="Descripción"
            placeholder="Describe el problema"
            value={description}
            onChangeText={(value) => { setDescription(value); setRetryKey(null); }}
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Ubicación"
            placeholder="Ubicación (ej. Edificio A, Laboratorio o referencia)"
            value={location}
            onChangeText={(value) => {
              setLocation(value);
              setRetryKey(null);
              setLocationStatus(null);
            }}
            style={styles.input}
          />
          {geocodingService && location.trim().length > 0 ? (
            <TouchableOpacity onPress={handleVerifyLocation} style={styles.verifyLocationButton}>
              <Text style={styles.verifyLocationText}>Verificar coordenadas con mapa (opcional)</Text>
            </TouchableOpacity>
          ) : null}
          {locationStatus ? (
            <Text style={styles.locationStatusText}>{locationStatus}</Text>
          ) : null}
          <View style={styles.categories}>
            {categories.map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => { setCategory(item); setRetryKey(null); }}
                style={[styles.category, category === item && styles.selected]}
              >
                <Text style={category === item ? styles.selectedCategoryText : styles.categoryText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {createError ? <Text accessibilityRole="alert" style={styles.createErrorText}>{createError}</Text> : null}
          <TouchableOpacity
            disabled={creating || !description.trim() || !location.trim()}
            onPress={submit}
            style={[styles.createButton, (creating || !description.trim() || !location.trim()) && styles.disabledButton]}
          >
            <Text style={styles.createText}>{creating ? 'Enviando...' : 'Enviar incidencia'}</Text>
          </TouchableOpacity>
        </View>
      ) : role ? (
        <View style={styles.roleNotice}>
          <Text style={styles.roleNoticeText}>
            {role === 'technician'
              ? 'Perfil de técnico: consulta y atiende las incidencias que tiene asignadas.'
              : 'El perfil de coordinación administra y prioriza las incidencias; la creación de reportes corresponde al perfil reportante.'}
          </Text>
        </View>
      ) : null}
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
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  errorBox: {
    padding: 12,
    backgroundColor: '#ffebee',
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
  },
  emptyText: {
    color: '#666',
    fontStyle: 'italic',
    marginVertical: 12,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    padding: 14,
    marginBottom: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
    color: '#222',
  },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardStatus: {
    fontSize: 13,
    color: '#555',
    fontWeight: '500',
  },
  cardCategory: {
    fontSize: 13,
    color: '#777',
  },
  cardTech: {
    fontSize: 12,
    color: '#0277bd',
    marginTop: 4,
    fontWeight: '600',
  },
  link: { color: '#007AFF', paddingVertical: 6, fontWeight: '600' },
  form: { backgroundColor: '#fff', padding: 14, gap: 10, marginTop: 8, borderRadius: 8 },
  formTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, fontSize: 14 },
  verifyLocationButton: { alignSelf: 'flex-start', paddingVertical: 4 },
  verifyLocationText: { fontSize: 12, color: '#0277bd', fontWeight: '600' },
  locationStatusText: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  category: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#ccc', borderRadius: 16 },
  categoryText: { fontSize: 12, color: '#555' },
  selected: { backgroundColor: '#e3f2fd', borderColor: '#007AFF' },
  selectedCategoryText: { fontSize: 12, color: '#007AFF', fontWeight: '700' },
  createButton: { backgroundColor: '#007AFF', padding: 12, borderRadius: 6, alignItems: 'center' },
  disabledButton: { backgroundColor: '#b0bec5' },
  createText: { color: '#fff', fontWeight: '700' },
  createErrorText: { color: '#d32f2f', fontSize: 13 },
  roleNotice: {
    padding: 12,
    backgroundColor: '#e1f5fe',
    borderRadius: 8,
    marginTop: 8,
  },
  roleNoticeText: {
    color: '#01579b',
    fontSize: 13,
    lineHeight: 18,
  },
});
