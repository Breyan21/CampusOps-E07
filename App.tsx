import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import { InMemoryIncidentRepository } from './src/infrastructure/incidents/InMemoryIncidentRepository';
import { ListIncidents } from './src/application/incidents/ListIncidents';
import { GetIncidentDetail } from './src/application/incidents/GetIncidentDetail';
import { IncidentListScreen } from './src/ui/incidents/IncidentListScreen';
import { IncidentDetailScreen } from './src/ui/incidents/IncidentDetailScreen';

// Instanciar dependencias de forma centralizada (Composition Root)
const repository = new InMemoryIncidentRepository();
const listIncidentsUseCase = new ListIncidents(repository);
const getIncidentDetailUseCase = new GetIncidentDetail(repository);

export default function App() {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>('checking');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getBackendHealth()
      .then(() => active && setStatus('available'))
      .catch(() => active && setStatus('offline'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={styles.screen}>
      {!selectedIncidentId ? (
        <IncidentListScreen 
          listIncidentsUseCase={listIncidentsUseCase} 
          onSelectIncident={setSelectedIncidentId} 
        />
      ) : (
        <IncidentDetailScreen 
          getIncidentDetailUseCase={getIncidentDetailUseCase} 
          incidentId={selectedIncidentId} 
          onBack={() => setSelectedIncidentId(null)} 
        />
      )}
      
      <View accessibilityRole="summary" style={styles.card}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {status}</Text>
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f5f5' },
  card: { gap: 12, padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  title: { fontSize: 18, fontWeight: '700' },
});
