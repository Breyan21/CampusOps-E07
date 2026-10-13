import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import { CampusOpsIncidentRepository } from './src/infrastructure/incidents/CampusOpsIncidentRepository';
import { ListIncidents } from './src/application/incidents/ListIncidents';
import { GetIncidentDetail } from './src/application/incidents/GetIncidentDetail';
import { CreateIncident } from './src/application/incidents/CreateIncident';
import { ExecuteIncidentAction } from './src/application/incidents/ExecuteIncidentAction';
import { AuthService } from './src/application/auth/AuthService';
import type { SessionState, UserRole } from './src/domain/auth/types';
import { SessionStatusBar } from './src/ui/auth/SessionStatusBar';
import { LoginModal } from './src/ui/auth/LoginModal';
import { IncidentListScreen } from './src/ui/incidents/IncidentListScreen';
import { IncidentDetailScreen } from './src/ui/incidents/IncidentDetailScreen';

const backendUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? 'http://127.0.0.1:4310';

// Instanciar dependencias de forma centralizada (Composition Root)
const authService = new AuthService({ baseUrl: backendUrl });

const repository = new CampusOpsIncidentRepository({
  baseUrl: backendUrl,
  accessToken: 'course-valid-token',
  refreshToken: 'course-refresh-0',
  actorId: 'reporter-1',
  onSessionStateChange: (event) => {
    if (event.type === 'refreshing') authService.setRefreshing(true);
    if (event.type === 'authenticated') authService.refreshSucceeded(event.accessToken, event.refreshToken);
    if (event.type === 'expired') authService.setExpired();
  },
});

const listIncidentsUseCase = new ListIncidents(repository);
const getIncidentDetailUseCase = new GetIncidentDetail(repository);
const createIncidentUseCase = new CreateIncident(repository);
const executeIncidentActionUseCase = new ExecuteIncidentAction(repository);

export default function App() {
  const [backendStatus, setBackendStatus] = useState<'checking' | 'available' | 'offline'>('checking');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>(authService.getState());
  const [currentActorId, setCurrentActorId] = useState<string | null>(authService.getActorId());
  const [currentRole, setCurrentRole] = useState<UserRole | null>(authService.getRole());
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    let active = true;
    getBackendHealth()
      .then(() => active && setBackendStatus('available'))
      .catch(() => active && setBackendStatus('offline'));

    const unsubscribe = authService.subscribe((session, state) => {
      if (!active) return;
      setSessionState(state);
      setCurrentActorId(session?.actorId ?? null);
      setCurrentRole(session?.role ?? null);
      if (session && repository.setSession) {
        repository.setSession(session.accessToken, session.actorId, session.refreshToken);
      } else {
        repository.clearSession?.();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleSelectActor = async (actorId: string) => {
    await authService.login(actorId);
    setSelectedIncidentId(null);
  };

  const handleLogout = async () => {
    await authService.logout();
    setSelectedIncidentId(null);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <SessionStatusBar
        state={sessionState}
        actorId={currentActorId}
        role={currentRole}
        onOpenLogin={() => setShowLoginModal(true)}
        onLogout={handleLogout}
      />

      <View style={styles.content}>
        {sessionState === 'authenticated' && currentRole && currentActorId ? (!selectedIncidentId ? (
          <IncidentListScreen
            listIncidentsUseCase={listIncidentsUseCase}
            createIncidentUseCase={createIncidentUseCase}
            onSelectIncident={setSelectedIncidentId}
            currentRole={currentRole}
            currentActorId={currentActorId}
          />
        ) : (
          <IncidentDetailScreen
            getIncidentDetailUseCase={getIncidentDetailUseCase}
            executeIncidentActionUseCase={executeIncidentActionUseCase}
            incidentId={selectedIncidentId}
            onBack={() => setSelectedIncidentId(null)}
            currentRole={currentRole}
            currentActorId={currentActorId}
          />
        )) : (
          <View style={styles.loginRequired}>
            <Text style={styles.loginRequiredTitle}>Inicia sesión para consultar CampusOps</Text>
            <Text style={styles.loginRequiredText}>Selecciona un perfil de prueba para ver las incidencias y sus operaciones autorizadas.</Text>
          </View>
        )}
      </View>

      <LoginModal
        visible={showLoginModal}
        currentActorId={currentActorId}
        onSelectActor={handleSelectActor}
        onClose={() => setShowLoginModal(false)}
      />

      <View accessibilityRole="summary" style={styles.card}>
        <Text style={styles.title}>CampusOps</Text>
        <Text style={styles.cardSubtitle}>Gestión de incidencias de campus · Ciclo de sesión y roles</Text>
        <Text testID="backend-status">Backend: {backendStatus}</Text>
      </View>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { flex: 1 },
  loginRequired: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 10 },
  loginRequiredTitle: { color: '#333', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  loginRequiredText: { color: '#666', fontSize: 14, textAlign: 'center' },
  card: { gap: 6, padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  title: { fontSize: 16, fontWeight: '700', color: '#222' },
  cardSubtitle: { fontSize: 12, color: '#666' },
});
