import { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOrganizationData } from '../hooks/useOrganizationData';
import { apiLogout } from '../services/api';
import { getAppearancePalette, theme } from '../theme';
import { BrandThemeProvider, useBrandColors } from '../theme-context';
import { UserProfile, UserRole } from '../types';
import { IconButton, SmallButton } from './ui';

const roleLabels: Record<UserRole, string> = {
  admin: 'Administrador',
  owner: 'Dueno',
  manager: 'Gerente',
  receptionist: 'Recepcion',
  employee: 'Empleado',
  client: 'Cliente',
};

export function AppShell({ children, profile, clientMode, onToggleMode }: { children: ReactNode; profile: UserProfile; clientMode?: boolean; onToggleMode?: () => void }) {
  const organizationId = clientMode ? profile.clientOrganizationId || profile.organizationId : profile.organizationId;
  const { appearance } = useOrganizationData(organizationId, Boolean(clientMode));
  const palette = getAppearancePalette(appearance);

  return (
    <BrandThemeProvider appearance={appearance}>
      <AppShellFrame profile={profile} appearance={appearance} backgroundColor={palette.background} clientMode={clientMode} onToggleMode={onToggleMode}>
        {children}
      </AppShellFrame>
    </BrandThemeProvider>
  );
}

function AppShellFrame({
  children,
  profile,
  appearance,
  backgroundColor,
  clientMode,
  onToggleMode,
}: {
  children: ReactNode;
  profile: UserProfile;
  appearance: ReturnType<typeof useOrganizationData>['appearance'];
  backgroundColor: string;
  clientMode?: boolean;
  onToggleMode?: () => void;
}) {
  const colors = useBrandColors();

  return (
    <SafeAreaView style={[theme.styles.safe, { backgroundColor }]}>
      <View style={[theme.styles.header, { backgroundColor: colors.primaryDark, borderBottomColor: colors.primaryDark }]}>
        <View style={theme.styles.rowBetween}>
          <View style={theme.styles.grow}>
            <Text style={[theme.styles.eyebrow, { color: theme.colors.surface }]}>{appearance.displayName || profile.organizationName}</Text>
            <Text style={[theme.styles.title, { color: theme.colors.surface }]}>{appearance.tagline || 'ServiCitas'}</Text>
            <Text style={[theme.styles.mutedText, { color: 'rgba(255,255,255,0.78)' }]}>
              {profile.name} · {clientMode ? roleLabels.client : roleLabels[profile.role]}
            </Text>
          </View>
          {onToggleMode ? <SmallButton label={clientMode ? 'Trabajo' : 'Cliente'} onPress={onToggleMode} /> : null}
          <IconButton icon="log-out-outline" onPress={() => apiLogout()} />
        </View>
      </View>
      {children}
    </SafeAreaView>
  );
}
