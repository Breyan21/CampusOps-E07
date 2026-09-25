import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import type { Incident } from '../../domain/incidents/Incident';
import type { ListIncidents } from '../../application/incidents/ListIncidents';

interface Props {
  listIncidentsUseCase: ListIncidents;
  onSelectIncident: (id: string) => void;
}

export const IncidentListScreen: React.FC<Props> = ({ listIncidentsUseCase, onSelectIncident }) => {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    listIncidentsUseCase.execute().then((data: readonly Incident[]) => {
      if (mounted) {
        setIncidents(data);
        setLoading(false);
      }
    }).catch((_err: unknown) => {
      console.error('Error al consultar lista de incidencias: error controlado sin exposición de datos.');
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [listIncidentsUseCase]);

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
      <FlatList
        data={incidents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={styles.card} 
            onPress={() => onSelectIncident(item.id)}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardStatus}>Estado: {item.status}</Text>
            <Text style={styles.cardCategory}>Categoría: {item.category}</Text>
          </TouchableOpacity>
        )}
      />
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
});
