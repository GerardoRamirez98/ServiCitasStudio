import { StatusBar } from 'expo-status-bar';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text } from 'react-native';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../firebase';
import { readableFirebaseError } from '../services/errors';
import { createPublicOrganizationCode, resolveEmployeeInvite, resolveOrganizationCode } from '../services/organizations';
import { defaultAppearance, theme } from '../theme';
import { UserRole } from '../types';
import { normalizeCode } from '../utils/codes';
import { emptyAddress, isAddressComplete, OrganizationAddressFields } from '../components/OrganizationAddressFields';
import { LabeledInput, PrimaryButton, Segmented } from '../components/ui';

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
        await signInWithEmailAndPassword(auth, email.trim(), password);
        return;
      }

      const resolvedOrganization =
        role === 'client' || (role === 'admin' && adminMode === 'join') ? await resolveOrganizationCode(organizationCode) : null;
      const resolvedInvite = role === 'employee' ? await resolveEmployeeInvite(employeeInviteCode) : null;

      if (resolvedInvite?.used) {
        throw new Error('Este codigo de empleado ya fue usado.');
      }
      if (resolvedInvite?.email && resolvedInvite.email !== email.trim().toLowerCase()) {
        throw new Error('Este codigo fue creado para otro correo.');
      }

      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      let finalOrganizationId = '';
      let finalOrganizationName = organizationName.trim();
      let employeeId: string | null = null;

      if (role === 'admin' && adminMode === 'create') {
        const organizationRef = await addDoc(collection(db, 'organizations'), {
          name: organizationName.trim(),
          address: organizationAddress,
          ownerId: credential.user.uid,
          createdAt: serverTimestamp(),
        });
        finalOrganizationId = organizationRef.id;
        finalOrganizationName = organizationName.trim();
        await createPublicOrganizationCode(finalOrganizationId, finalOrganizationName);
      }

      if (role === 'admin' && adminMode === 'join') {
        finalOrganizationId = resolvedOrganization?.organizationId ?? '';
        finalOrganizationName = resolvedOrganization?.organizationName ?? 'Organizacion';
      }

      if (role === 'client') {
        finalOrganizationId = resolvedOrganization?.organizationId ?? '';
        finalOrganizationName = resolvedOrganization?.organizationName ?? 'Organizacion';
      }

      if (role === 'employee') {
        finalOrganizationId = resolvedInvite?.organizationId ?? '';
        finalOrganizationName = resolvedInvite?.organizationName ?? 'Organizacion';
        employeeId = resolvedInvite?.employeeId ?? null;
      }

      await setDoc(doc(db, 'users', credential.user.uid), {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        organizationId: finalOrganizationId,
        organizationName: finalOrganizationName || 'Organizacion',
        employeeId,
        createdAt: serverTimestamp(),
      });

      if (role === 'employee' && resolvedInvite && employeeId) {
        await updateDoc(doc(db, 'organizations', finalOrganizationId, 'employees', employeeId), {
          userId: credential.user.uid,
          active: true,
        });
        await updateDoc(doc(db, 'employeeInvites', resolvedInvite.inviteCode), {
          used: true,
          usedBy: credential.user.uid,
        });
      }

      if (role === 'admin' && adminMode === 'create') {
        await setDoc(doc(db, 'organizations', finalOrganizationId, 'settings', 'business'), {
          requireDeposit: false,
          depositPercent: 30,
          toleranceMinutes: 10,
          cancellationLimitHours: 24,
          businessStart: '09:00',
          businessEnd: '18:00',
          breakEnabled: false,
          breakStart: '14:00',
          breakEnd: '15:00',
          slotMinutes: 60,
          workingDays: [1, 2, 3, 4, 5, 6],
        });
        await setDoc(doc(db, 'organizations', finalOrganizationId, 'settings', 'appearance'), {
          ...defaultAppearance,
          displayName: finalOrganizationName,
          tagline: 'Agenda y citas en tiempo real',
        });
      }
    } catch (error) {
      Alert.alert('No se pudo continuar', readableFirebaseError(error));
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
