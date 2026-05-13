import { StatusBar } from 'expo-status-bar';
import { signOut, type User } from 'firebase/auth';
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LabeledInput, PrimaryButton, Segmented } from '../components/ui';
import { auth, db } from '../firebase';
import { readableFirebaseError } from '../services/errors';
import { createPublicOrganizationCode, resolveEmployeeInvite, resolveOrganizationCode } from '../services/organizations';
import { defaultAppearance, theme } from '../theme';
import { UserRole } from '../types';
import { normalizeCode } from '../utils/codes';
import { emptyAddress, isAddressComplete, OrganizationAddressFields } from '../components/OrganizationAddressFields';

export function ProfileRecoveryScreen({ user }: { user: User }) {
  const [role, setRole] = useState<UserRole>('admin');
  const [adminMode, setAdminMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState(user.email?.split('@')[0] ?? '');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationAddress, setOrganizationAddress] = useState(emptyAddress);
  const [organizationCode, setOrganizationCode] = useState('');
  const [employeeInviteCode, setEmployeeInviteCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function completeProfile() {
    if (!name.trim()) {
      Alert.alert('Falta nombre', 'Agrega tu nombre para completar la cuenta.');
      return;
    }
    if (role === 'admin' && adminMode === 'create' && !organizationName.trim()) {
      Alert.alert('Falta negocio', 'Agrega el nombre del negocio.');
      return;
    }
    if (role === 'admin' && adminMode === 'create' && !isAddressComplete(organizationAddress)) {
      Alert.alert('Falta direccion', 'Completa calle, colonia, ciudad, estado, numero exterior y codigo postal.');
      return;
    }
    if (role !== 'employee' && (role !== 'admin' || adminMode === 'join') && !organizationCode.trim()) {
      Alert.alert('Falta codigo', 'Agrega el codigo del negocio.');
      return;
    }
    if (role === 'employee' && !employeeInviteCode.trim()) {
      Alert.alert('Falta invitacion', 'Agrega el codigo privado de empleado.');
      return;
    }

    setBusy(true);
    try {
      let finalOrganizationId = '';
      let finalOrganizationName = organizationName.trim();
      let employeeId: string | null = null;

      if (role === 'admin' && adminMode === 'create') {
        const organizationRef = await addDoc(collection(db, 'organizations'), {
          name: organizationName.trim(),
          address: organizationAddress,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
        finalOrganizationId = organizationRef.id;
        finalOrganizationName = organizationName.trim();
        await createPublicOrganizationCode(finalOrganizationId, finalOrganizationName);
      }

      if (role === 'admin' && adminMode === 'join') {
        const organization = await resolveOrganizationCode(organizationCode);
        finalOrganizationId = organization.organizationId;
        finalOrganizationName = organization.organizationName;
      }

      if (role === 'client') {
        const organization = await resolveOrganizationCode(organizationCode);
        finalOrganizationId = organization.organizationId;
        finalOrganizationName = organization.organizationName;
      }

      if (role === 'employee') {
        const invite = await resolveEmployeeInvite(employeeInviteCode);
        if (invite.used) {
          throw new Error('Este codigo de empleado ya fue usado.');
        }
        if (invite.email && invite.email !== user.email?.toLowerCase()) {
          throw new Error('Este codigo fue creado para otro correo.');
        }
        finalOrganizationId = invite.organizationId;
        finalOrganizationName = invite.organizationName;
        employeeId = invite.employeeId;
      }

      await setDoc(doc(db, 'users', user.uid), {
        name: name.trim(),
        email: user.email?.toLowerCase() ?? '',
        role,
        organizationId: finalOrganizationId,
        organizationName: finalOrganizationName || 'Organizacion',
        employeeId,
        createdAt: serverTimestamp(),
      });

      if (role === 'employee' && employeeId) {
        const invite = await resolveEmployeeInvite(employeeInviteCode);
        await updateDoc(doc(db, 'organizations', finalOrganizationId, 'employees', employeeId), {
          userId: user.uid,
          active: true,
        });
        await updateDoc(doc(db, 'employeeInvites', invite.inviteCode), {
          used: true,
          usedBy: user.uid,
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
      Alert.alert('No se pudo completar', readableFirebaseError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={theme.styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, gap: 14 }}>
        <Text style={theme.styles.eyebrow}>Cuenta encontrada</Text>
        <Text style={theme.styles.screenTitle}>Completar perfil</Text>
        <Text style={theme.styles.mutedText}>
          Tu usuario ya existe en Authentication, pero falta crear su perfil en Firestore.
        </Text>

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

        <PrimaryButton icon="save" label={busy ? 'Guardando...' : 'Completar perfil'} onPress={completeProfile} />
        <Pressable onPress={() => signOut(auth)} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ color: theme.colors.primaryDark, fontWeight: '800' }}>Salir y usar otra cuenta</Text>
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
          Primero el administrador debe agregarte en Equipo. Despues te pasara un codigo privado tipo EMP4821 para completar tu perfil.
        </Text>
      </View>
    );
  }

  if (role === 'client') {
    return (
      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>Registro de cliente</Text>
        <Text style={theme.styles.mutedText}>Usa el codigo publico del negocio que te compartieron, por ejemplo BRBRSH383.</Text>
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
