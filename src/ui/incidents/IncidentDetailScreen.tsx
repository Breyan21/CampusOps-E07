import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import type { Incident } from '../../domain/incidents/Incident';
import type { GetIncidentDetail } from '../../application/incidents/GetIncidentDetail';

interface Props {
  getIncidentDetailUseCase: GetIncidentDetail;
  incidentId: string;
  onBack: () => void;
}

export const IncidentDetailScreen: React.FC<Props> = ({ getIncidentDetailUseCase, incidentId, onBack }) => {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getIncidentDetailUseCase.execute(incidentId).then((data: Incident | null) => {
      if (mounted) {
        setIncident(data);
        setLoading(false);
      }
    }).catch((err: unknown) => {
      console.error(err);
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [getIncidentDetailUseCase, incidentId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

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

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>← Volver a la lista</Text>
      </TouchableOpacity>
      
      <View style={styles.card}>
        <Text style={styles.title}>{incident.title}</Text>
        
        <View style={styles.infoRow}>
          <Text style={styles.label}>ID:</Text>
          <Text style={styles.value}>{incident.id}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.label}>Estado:</Text>
          <Text style={styles.value}>{incident.status}</Text>
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
          <Text style={styles.label}>Ubicación:</Text>
          <Text style={styles.value}>{incident.location?.label ?? 'No especificada'}</Text>
        </View>

        <Text style={styles.descriptionLabel}>Descripción:</Text>
        <Text style={styles.description}>{incident.description}</Text>
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
    marginTop: 40,
    marginBottom: 16,
    padding: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 8,
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
  descriptionLabel: {
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    color: '#555',
  },
  description: {
    lineHeight: 20,
    color: '#444',
  },
  button: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
