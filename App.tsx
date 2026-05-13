import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppShell } from './src/components/AppShell';
import { useAuthProfile } from './src/hooks/useAuthProfile';
import { AdminScreen } from './src/screens/AdminScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { ClientScreen } from './src/screens/ClientScreen';
import { EmployeeScreen } from './src/screens/EmployeeScreen';
import { ProfileRecoveryScreen } from './src/screens/ProfileRecoveryScreen';
import { registerPushToken } from './src/services/notifications';
import { theme } from './src/theme';
import { useEffect } from 'react';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { profile, authUser, missingProfile, loading } = useAuthProfile();

  useEffect(() => {
    if (!profile) return;
    registerPushToken(profile).catch(() => undefined);
  }, [profile]);

  if (loading) {
    return (
      <SafeAreaView style={theme.styles.centered}>
        <StatusBar style="dark" />
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={theme.styles.mutedText}>Cargando ServiCitas...</Text>
      </SafeAreaView>
    );
  }

  if (!profile) {
    if (authUser && missingProfile) {
      return <ProfileRecoveryScreen user={authUser} />;
    }
    return <AuthScreen />;
  }

  return (
    <AppShell profile={profile}>
      {['owner', 'admin', 'manager', 'receptionist'].includes(profile.role) ? <AdminScreen profile={profile} /> : null}
      {profile.role === 'employee' ? <EmployeeScreen profile={profile} /> : null}
      {profile.role === 'client' ? <ClientScreen profile={profile} /> : null}
    </AppShell>
  );
}
