import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import type { SessionState, UserRole } from '../../domain/auth/types';

interface Props {
  state: SessionState;
  actorId: string | null;
  role: UserRole | null;
  onOpenLogin: () => void;
  onLogout: () => void;
}

const roleLabels: Record<UserRole, string> = {
  reporter: 'Reportante',
  technician: 'Técnico',
  coordinator: 'Coordinador',
};

const roleColors: Record<UserRole, string> = {
  reporter: '#2e7d32',
  technician: '#0277bd',
  coordinator: '#c2185b',
};

export const SessionStatusBar: React.FC<Props> = ({ state, actorId, role, onOpenLogin, onLogout }) => {
  if (state === 'authenticating') {
    return (
      <View style={[styles.container, styles.refreshingContainer]}>
        <ActivityIndicator size="small" color="#fff" />
        <Text style={styles.refreshingText}>Iniciando sesión...</Text>
      </View>
    );
  }

  if (state === 'refreshing') {
    return (
      <View style={[styles.container, styles.refreshingContainer]}>
        <View style={styles.refreshingStatus}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.refreshingText}>Renovando sesión...</Text>
        </View>
        <TouchableOpacity onPress={onLogout} style={styles.refreshLogoutButton}>
          <Text style={styles.refreshLogoutText}>Salir</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state === 'authenticated' && actorId && role) {
    return (
      <View style={styles.container}>
        <View style={styles.userInfo}>
          <Text style={styles.actorText}>{actorId}</Text>
          <View style={[styles.roleBadge, { backgroundColor: roleColors[role] }]}>
            <Text style={styles.roleText}>{roleLabels[role]}</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={onOpenLogin} style={styles.switchButton}>
            <Text style={styles.switchText}>Cambiar perfil</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.anonymousContainer]}>
      <Text style={styles.anonymousText}>
        {state === 'expired' ? 'Sesión expirada. Inicia sesión nuevamente.' : 'Modo anónimo / Sin autenticar'}
      </Text>
      <TouchableOpacity onPress={onOpenLogin} style={styles.loginButton}>
        <Text style={styles.loginButtonText}>Iniciar sesión</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  refreshingContainer: {
    backgroundColor: '#f57c00',
  },
  refreshingStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refreshLogoutButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: '#fff' },
  refreshLogoutText: { color: '#e65100', fontSize: 12, fontWeight: '700' },
  refreshingText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actorText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  roleText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  switchButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: '#f0f0f0',
  },
  switchText: {
    fontSize: 12,
    color: '#333',
  },
  logoutButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: '#ffebee',
  },
  logoutText: {
    fontSize: 12,
    color: '#d32f2f',
    fontWeight: '600',
  },
  anonymousContainer: {
    backgroundColor: '#fff3e0',
  },
  anonymousText: {
    fontSize: 13,
    color: '#e65100',
    fontWeight: '500',
  },
  loginButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
