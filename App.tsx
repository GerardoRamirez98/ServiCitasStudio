import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppShell } from './src/components/AppShell';
import { useAuthProfile } from './src/hooks/useAuthProfile';
import { AdminScreen } from './src/screens/AdminScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { ClientScreen } from './src/screens/ClientScreen';
import { EmployeeScreen } from './src/screens/EmployeeScreen';
import { theme } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { profile, loading } = useAuthProfile();
  const [staffView, setStaffView] = useState(true);

  useEffect(() => {
    setStaffView(true);
  }, [profile?.id]);

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
    return <AuthScreen />;
  }

  const hasStaffView = profile.role !== 'client';
  const clientMode = !hasStaffView || !staffView;

  return (
    <AppShell profile={profile} clientMode={clientMode} onToggleMode={hasStaffView ? () => setStaffView((current) => !current) : undefined}>
      {!clientMode && ['owner', 'admin', 'manager', 'receptionist'].includes(profile.role) ? <AdminScreen profile={profile} /> : null}
      {!clientMode && profile.role === 'employee' ? <EmployeeScreen profile={profile} /> : null}
      {clientMode ? <ClientScreen profile={profile} /> : null}
    </AppShell>
  );
}
