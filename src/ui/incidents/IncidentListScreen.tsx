import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import type { Incident } from '../../domain/incidents/Incident';
import type { ListIncidents } from '../../application/incidents/ListIncidents';
import type { CreateIncident } from '../../application/incidents/CreateIncident';
import type { IncidentCategory } from '../../campusops/contracts';
import { createIdempotencyKey } from '../../application/incidents/CreateIncident';
import { logSafeTelemetry } from '../../telemetry/safeTelemetry';
import { isIncidentApiError } from '../../infrastructure/api/IncidentApiError';

interface Props {
  listIncidentsUseCase: ListIncidents;
  createIncidentUseCase: CreateIncident;
  onSelectIncident: (id: string) => void;
}

const categories: readonly IncidentCategory[] = ['electrical', 'laboratory', 'water', 'connectivity', 'equipment', 'safety', 'maintenance'];

export const IncidentListScreen: React.FC<Props> = ({ listIncidentsUseCase, createIncidentUseCase, onSelectIncident }) => {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.');
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<IncidentCategory>('maintenance');
  const [createError, setCreateError] = useState('');
  const [retryKey, setRetryKey] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(false);
    setLoadErrorMessage('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.');
    let mounted = true;
    listIncidentsUseCase.execute().then((data: readonly Incident[]) => {
      if (mounted) {
        setIncidents(data);
        setLoading(false);
      }
    }).catch((error: unknown) => {
      logSafeTelemetry('incident_list_load_failed', {
        feature: 'incident_list',
        status: 'error',
      });
      if (mounted) {
        setLoadError(true);
        setLoadErrorMessage(isIncidentApiError(error) && error.kind === 'ServerError'
          ? 'El servidor tuvo un problema. Inténtalo de nuevo más tarde.'
          : 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.');
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  };

  useEffect(() => load(), [listIncidentsUseCase]);

  const submit = async () => {
    setCreating(true);
    setCreateError('');
    const key = retryKey ?? createIdempotencyKey();
    setRetryKey(key);
    try {
      await createIncidentUseCase.execute({ category, description, location }, key);
      setDescription(''); setLocation(''); setRetryKey(null);
      setCreating(false);
      load();
    } catch (error: unknown) {
      logSafeTelemetry('incident_create_failed', { feature: 'incident_create', status: 'error' });
      setCreateError(isIncidentApiError(error) && error.kind === 'ServerError'
        ? 'El servidor tuvo un problema. Inténtalo de nuevo más tarde.'
        : 'No se pudo conectar. Puedes reintentar de forma segura.');
      setCreating(false);
    }
  };

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
      {loadError ? <View accessibilityRole="alert"><Text>{loadErrorMessage}</Text><TouchableOpacity onPress={load}><Text style={styles.link}>Reintentar</Text></TouchableOpacity></View> : null}
      {incidents.length === 0 && !loadError ? <Text>No hay incidencias disponibles.</Text> : null}
      <FlatList
        data={incidents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={styles.card} 
            onPress={() => onSelectIncident(item.id)}
          >
            <Text style={styles.cardTitle}>{item.title ?? item.description}</Text>
            <Text style={styles.cardStatus}>Estado: {item.status}</Text>
            <Text style={styles.cardCategory}>Categoría: {item.category}</Text>
          </TouchableOpacity>
        )}
      />
      <View style={styles.form}>
        <Text style={styles.formTitle}>Crear incidencia</Text>
        <TextInput accessibilityLabel="Descripción" placeholder="Describe el problema" value={description} onChangeText={(value) => { setDescription(value); setRetryKey(null); }} style={styles.input} />
        <TextInput accessibilityLabel="Ubicación" placeholder="Ubicación" value={location} onChangeText={(value) => { setLocation(value); setRetryKey(null); }} style={styles.input} />
        <View style={styles.categories}>{categories.map((item) => <TouchableOpacity key={item} onPress={() => { setCategory(item); setRetryKey(null); }} style={[styles.category, category === item && styles.selected]}><Text>{item}</Text></TouchableOpacity>)}</View>
        {createError ? <Text accessibilityRole="alert">{createError}</Text> : null}
        <TouchableOpacity disabled={creating || !description.trim() || !location.trim()} onPress={submit} style={styles.createButton}><Text style={styles.createText}>{creating ? 'Enviando…' : 'Enviar incidencia'}</Text></TouchableOpacity>
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 40,
    color: '#333',
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardStatus: {
    fontSize: 14,
    color: '#666',
  },
  cardCategory: {
    fontSize: 14,
    color: '#888',
  },
  link: { color: '#007AFF', paddingVertical: 8 },
  form: { backgroundColor: '#fff', padding: 12, gap: 8, marginTop: 8 },
  formTitle: { fontSize: 18, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 6, padding: 10 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  category: { padding: 6, borderWidth: 1, borderColor: '#bbb', borderRadius: 5 },
  selected: { backgroundColor: '#d9eaff', borderColor: '#007AFF' },
  createButton: { backgroundColor: '#007AFF', padding: 12, borderRadius: 6, alignItems: 'center' },
  createText: { color: '#fff', fontWeight: '700' },
});
