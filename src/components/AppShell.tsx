import { signOut } from 'firebase/auth';
import { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebase';
import { useOrganizationData } from '../hooks/useOrganizationData';
import { getAppearancePalette, theme } from '../theme';
import { BrandThemeProvider, useBrandColors } from '../theme-context';
import { UserProfile, UserRole } from '../types';
import { IconButton } from './ui';

const roleLabels: Record<UserRole, string> = {
  admin: 'Administrador',
  owner: 'Dueno',
  manager: 'Gerente',
  receptionist: 'Recepcion',
  employee: 'Empleado',
  client: 'Cliente',
};

export function AppShell({ children, profile }: { children: ReactNode; profile: UserProfile }) {
  const { appearance } = useOrganizationData(profile.organizationId);
  const palette = getAppearancePalette(appearance);

  return (
    <BrandThemeProvider appearance={appearance}>
      <AppShellFrame profile={profile} appearance={appearance} backgroundColor={palette.background}>
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
}: {
  children: ReactNode;
  profile: UserProfile;
  appearance: ReturnType<typeof useOrganizationData>['appearance'];
  backgroundColor: string;
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
              {profile.name} · {roleLabels[profile.role]}
            </Text>
          </View>
          <IconButton icon="log-out-outline" onPress={() => signOut(auth)} />
        </View>
      </View>
      {children}
    </SafeAreaView>
  );
}
