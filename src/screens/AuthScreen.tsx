import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text } from 'react-native';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { readableApiError } from '../services/errors';
import { theme } from '../theme';
import { UserRole } from '../types';
import { normalizeCode } from '../utils/codes';
import { emptyAddress, isAddressComplete, OrganizationAddressFields } from '../components/OrganizationAddressFields';
import { LabeledInput, PrimaryButton, Segmented } from '../components/ui';
import { apiLogin, apiRegister } from '../services/api';

export function AuthScreen() {
  const [isRegister, setIsRegister] = useState(false);
  const [role, setRole] = useState<UserRole>('client');
  const [adminMode, setAdminMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationAddress, setOrganizationAddress] = useState(emptyAddress);
  const [organizationCode, setOrganizationCode] = useState('');
  const [employeeInviteCode, setEmployeeInviteCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password.trim() || (isRegister && !name.trim())) {
      Alert.alert('Datos incompletos', 'Completa los campos para continuar.');
      return;
    }

    if (isRegister && role === 'admin' && adminMode === 'create' && !organizationName.trim()) {
      Alert.alert('Falta organizacion', 'Agrega el nombre del negocio.');
      return;
    }
    if (isRegister && role === 'admin' && adminMode === 'create' && !isAddressComplete(organizationAddress)) {
      Alert.alert('Falta direccion', 'Completa calle, colonia, ciudad, estado, numero exterior y codigo postal.');
      return;
    }

    if (isRegister && role !== 'employee' && (role !== 'admin' || adminMode === 'join') && !organizationCode.trim()) {
      Alert.alert('Falta codigo', 'Pide al administrador el codigo del negocio.');
      return;
    }

    if (isRegister && role === 'employee' && !employeeInviteCode.trim()) {
      Alert.alert('Falta invitacion', 'Pide al administrador tu codigo de empleado.');
      return;
    }

    setBusy(true);
    try {
      if (!isRegister) {
        await apiLogin(email.trim(), password);
        return;
      }
      await apiRegister({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: role === 'admin' && adminMode === 'create' ? 'owner' : role,
        organizationName: role === 'admin' && adminMode === 'create' ? organizationName.trim() : undefined,
        organizationCode: role === 'client' || (role === 'admin' && adminMode === 'join') ? organizationCode : undefined,
        organizationAddress: role === 'admin' && adminMode === 'create' ? organizationAddress : undefined,
        employeeInviteCode: role === 'employee' ? employeeInviteCode : undefined,
      });
    } catch (error) {
      Alert.alert('No se pudo continuar', readableApiError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={theme.styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, gap: 14 }}>
        <Text style={theme.styles.eyebrow}>ServiCitas multi-negocio</Text>
        <Text style={theme.styles.screenTitle}>{isRegister ? 'Crear cuenta' : 'Iniciar sesion'}</Text>
        <Text style={theme.styles.mutedText}>Cada organizacion tiene su agenda, empleados, servicios y clientes separados.</Text>

        {isRegister ? (
          <>
            <LabeledInput label="Tu nombre" placeholder="Ej. Karen" value={name} onChangeText={setName} />
            <Segmented
              options={[
                { key: 'client', label: 'Cliente', icon: 'person-outline' },
                { key: 'employee', label: 'Empleado', icon: 'id-card-outline' },
                { key: 'admin', label: 'Admin', icon: 'briefcase-outline' },
              ]}
              value={role}
              onChange={(value) => setRole(value as UserRole)}
            />
            <RoleHelp role={role} adminMode={adminMode} />
            {role === 'admin' ? (
              <>
                <Segmented
                  options={[
                    { key: 'create', label: 'Crear negocio', icon: 'add-circle-outline' },
                    { key: 'join', label: 'Unirme', icon: 'enter-outline' },
                  ]}
                  value={adminMode}
                  onChange={(value) => setAdminMode(value as 'create' | 'join')}
                />
                {adminMode === 'create' ? (
                  <>
                    <LabeledInput label="Nombre del negocio" placeholder="Ej. Barbershop Centro" value={organizationName} onChangeText={setOrganizationName} />
                    <OrganizationAddressFields value={organizationAddress} onChange={setOrganizationAddress} />
                  </>
                ) : (
                  <LabeledInput
                    label="Codigo publico del negocio"
                    helper="Lo comparte el administrador. Ej. BRBRSH383."
                    placeholder="Codigo del negocio ej. BARBER123"
                    value={organizationCode}
                    onChangeText={(value) => setOrganizationCode(normalizeCode(value))}
                    autoCapitalize="none"
                  />
                )}
              </>
            ) : role === 'employee' ? (
              <LabeledInput
                label="Codigo privado de empleado"
                helper="Primero el admin debe registrarte en Equipo y pasarte este codigo."
                placeholder="Codigo privado de empleado ej. EMP4821"
                value={employeeInviteCode}
                onChangeText={(value) => setEmployeeInviteCode(normalizeCode(value))}
                autoCapitalize="none"
              />
            ) : (
              <LabeledInput
                label="Codigo publico del negocio"
                helper="Lo comparte el negocio para que puedas agendar."
                placeholder="Codigo del negocio ej. BARBER123"
                value={organizationCode}
                onChangeText={(value) => setOrganizationCode(normalizeCode(value))}
                autoCapitalize="none"
              />
            )}
          </>
        ) : null}

        <LabeledInput label="Correo electronico" placeholder="nombre@correo.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <LabeledInput label="Contrasena" helper="Minimo 6 caracteres." placeholder="Tu contrasena" value={password} onChangeText={setPassword} secureTextEntry />
        <PrimaryButton icon={isRegister ? 'person-add' : 'log-in'} label={busy ? 'Procesando...' : isRegister ? 'Crear cuenta' : 'Entrar'} onPress={submit} />
        <Pressable onPress={() => setIsRegister((current) => !current)} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ color: theme.colors.primaryDark, fontWeight: '800' }}>{isRegister ? 'Ya tengo cuenta' : 'Crear cuenta nueva'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function RoleHelp({ role, adminMode }: { role: UserRole; adminMode: 'create' | 'join' }) {
  if (role === 'employee') {
    return (
      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>Registro de empleado</Text>
        <Text style={theme.styles.mutedText}>
          Primero el administrador debe agregarte en Equipo. Despues te pasara un codigo privado tipo EMP4821 para crear tu cuenta.
        </Text>
      </View>
    );
  }

  if (role === 'client') {
    return (
      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>Registro de cliente</Text>
        <Text style={theme.styles.mutedText}>
          Usa el codigo publico del negocio, por ejemplo BRBRSH383. Ese codigo lo comparte el administrador o la barberia.
        </Text>
      </View>
    );
  }

  return (
    <View style={theme.styles.card}>
      <Text style={theme.styles.sectionTitle}>{adminMode === 'create' ? 'Nuevo negocio' : 'Administrador invitado'}</Text>
      <Text style={theme.styles.mutedText}>
        {adminMode === 'create'
          ? 'Crea la organizacion con su direccion completa. Luego podras registrar empleados y compartir codigos.'
          : 'Usa el codigo publico del negocio para unirte como administrador.'}
      </Text>
    </View>
  );
}
