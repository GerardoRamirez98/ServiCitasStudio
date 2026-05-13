import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { addDoc, collection, deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppointmentCard } from '../components/AppointmentCard';
import { ManualAppointmentModal } from '../components/ManualAppointmentModal';
import { emptyAddress, formatAddress, isAddressComplete, OrganizationAddressFields } from '../components/OrganizationAddressFields';
import { EmptyState, IconButton, LabeledInput, Pill, PrimaryButton, Section, SmallButton } from '../components/ui';
import { noBlazeMessage, runtimeFeatures } from '../config/features';
import { db, storage } from '../firebase';
import { useOrganizationData } from '../hooks/useOrganizationData';
import { readableFirebaseError } from '../services/errors';
import { createPublicOrganizationCode } from '../services/organizations';
import { createMercadoPagoOAuthUrl, disconnectMercadoPago } from '../services/payments';
import { orgPath } from '../services/paths';
import { appearancePresets, defaultAppearance, getAppearancePalette, theme } from '../theme';
import { useBrandColors } from '../theme-context';
import { AppearanceSettings, Appointment, BusinessSettings, DayNote, Employee, MercadoPagoConnectionStatus, OrganizationAddress, Service, UserProfile } from '../types';
import { makeEmployeeInviteCode } from '../utils/codes';
import { dateLabel, monthMatrix, monthTitle, toDateId, weekDays } from '../utils/dates';
import { appointmentDuration, availableEmployeesForSlot, formatDuration } from '../utils/schedule';

type AdminTab = 'business' | 'agenda' | 'history' | 'schedule' | 'calendar' | 'services' | 'employees' | 'announcements' | 'payments' | 'appearance' | 'settings';

const finalAppointmentStatuses = ['completed', 'lost', 'cancelled'];
const adminTabItems: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap; helper: string }[] = [
  { key: 'business', label: 'Negocio', icon: 'storefront-outline', helper: 'Datos, codigo y resumen' },
  { key: 'agenda', label: 'Agenda', icon: 'calendar-outline', helper: 'Citas activas y manuales' },
  { key: 'history', label: 'Historial', icon: 'document-text-outline', helper: 'Citas cerradas por dia' },
  { key: 'schedule', label: 'Horarios', icon: 'time-outline', helper: 'Jornada, comida y descansos' },
  { key: 'calendar', label: 'Calendario', icon: 'grid-outline', helper: 'Dias especiales' },
  { key: 'services', label: 'Servicios', icon: 'cut-outline', helper: 'Precios y duraciones' },
  { key: 'employees', label: 'Equipo', icon: 'people-outline', helper: 'Empleados y rendimiento' },
  { key: 'announcements', label: 'Avisos', icon: 'megaphone-outline', helper: 'Promos y eventos' },
  { key: 'payments', label: 'Pagos', icon: 'wallet-outline', helper: 'Anticipos y Mercado Pago' },
  { key: 'appearance', label: 'Apariencia', icon: 'color-palette-outline', helper: 'Tema, logo y mensajes' },
  { key: 'settings', label: 'Config', icon: 'settings-outline', helper: 'Reglas de anticipo' },
];

function isFinalAppointment(appointment: Appointment) {
  return finalAppointmentStatuses.includes(appointment.status);
}

function employeePerformance(employee: Employee, appointments: Appointment[]) {
  const completed = appointments.filter((appointment) => appointment.employeeId === employee.id && appointment.status === 'completed');
  const generated = completed.reduce((sum, appointment) => sum + Number(appointment.total || 0), 0);
  const commission = Math.round((generated * Number(employee.commissionPercent || 0)) / 100);
  return { completed: completed.length, generated, commission };
}

export function AdminScreen({ profile }: { profile: UserProfile }) {
  const { organization, services, employees, appointments, dayNotes, announcements, settings, appearance, mercadoPagoConnection } = useOrganizationData(profile.organizationId);
  const brandColors = useBrandColors();
  const [tab, setTab] = useState<AdminTab>('business');
  const [serviceDraft, setServiceDraft] = useState<Service | null>(null);
  const [employeeDraft, setEmployeeDraft] = useState<Employee | null>(null);
  const [manualAppointmentOpen, setManualAppointmentOpen] = useState(false);
  const [dayDraft, setDayDraft] = useState<DayNote>({ id: '', date: toDateId(new Date()), type: 'closed', note: '' });
  const [manualDayDraft, setManualDayDraft] = useState<DayNote>({ id: '', date: toDateId(new Date()), type: 'closed', note: '' });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [announcementDraft, setAnnouncementDraft] = useState({ title: '', body: '' });
  const [settingsDraft, setSettingsDraft] = useState(settings);
  const [appearanceDraft, setAppearanceDraft] = useState(appearance);
  const [historyDate, setHistoryDate] = useState(toDateId(new Date()));
  const [businessDraft, setBusinessDraft] = useState<{ name: string; address: OrganizationAddress }>({
    name: profile.organizationName,
    address: emptyAddress,
  });
  const historyDateOptions = useMemo(() => relativeDates(14, 14), []);
  const activeAppointments = useMemo(() => appointments.filter((appointment) => !isFinalAppointment(appointment)), [appointments]);
  const historyAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.date === historyDate && isFinalAppointment(appointment)),
    [appointments, historyDate],
  );

  useEffect(() => setSettingsDraft(settings), [settings]);
  useEffect(() => setAppearanceDraft(appearance), [appearance]);

  useEffect(() => {
    if (organization) {
      setBusinessDraft({
        name: organization.name,
        address: organization.address ?? emptyAddress,
      });
    }
  }, [organization]);

  useEffect(() => {
    if (organization && !organization.publicCode) {
      createPublicOrganizationCode(organization.id, organization.name).catch(() => undefined);
    }
  }, [organization]);

  async function saveService() {
    if (!serviceDraft?.name.trim()) return;
    if (serviceDraft.duration <= 0) {
      Alert.alert('Duracion invalida', 'La duracion debe ser mayor a 0 minutos.');
      return;
    }
    if (serviceDraft.duration > 24 * 60) {
      Alert.alert('Duracion invalida', 'La duracion maxima permitida es 24 horas.');
      return;
    }

    Alert.alert(
      serviceDraft.id ? 'Confirmar cambios' : 'Confirmar servicio',
      `Servicio: ${serviceDraft.name.trim()}\nPrecio: $${Number(serviceDraft.price || 0)} MXN\nDuracion: ${formatDuration(serviceDraft.duration)}`,
      [
        { text: 'Revisar', style: 'cancel' },
        { text: 'Guardar', onPress: () => persistService(serviceDraft) },
      ],
    );
  }

  async function persistService(serviceDraft: Service) {
    const payload = {
      name: serviceDraft.name.trim(),
      price: Number(serviceDraft.price || 0),
      duration: Number(serviceDraft.duration || 0),
      active: serviceDraft.active,
    };
    if (serviceDraft.id) {
      await updateDoc(doc(db, orgPath(profile.organizationId, 'services'), serviceDraft.id), payload);
    } else {
      await addDoc(collection(db, orgPath(profile.organizationId, 'services')), payload);
    }
    setServiceDraft(null);
  }

  async function saveEmployee() {
    if (!employeeDraft?.name.trim()) return;
    const inviteCode = employeeDraft.inviteCode || makeEmployeeInviteCode();
    const payload = {
      name: employeeDraft.name.trim(),
      email: employeeDraft.email?.trim().toLowerCase() ?? '',
      role: employeeDraft.role.trim(),
      active: employeeDraft.active,
      userId: employeeDraft.userId ?? '',
      inviteCode,
      compensationMode: employeeDraft.compensationMode ?? 'commission',
      fixedSalary: Number(employeeDraft.fixedSalary || 0),
      commissionPercent: Number(employeeDraft.commissionPercent || 0),
    };

    let employeeId = employeeDraft.id;
    if (employeeDraft.id) {
      await updateDoc(doc(db, orgPath(profile.organizationId, 'employees'), employeeDraft.id), payload);
    } else {
      const employeeRef = await addDoc(collection(db, orgPath(profile.organizationId, 'employees')), payload);
      employeeId = employeeRef.id;
    }

    await setDoc(doc(db, 'employeeInvites', inviteCode), {
      code: inviteCode,
      organizationId: profile.organizationId,
      organizationName: organization?.name ?? profile.organizationName,
      employeeId,
      email: payload.email,
      used: Boolean(payload.userId),
    });
    setEmployeeDraft(null);
  }

  function confirmDeleteEmployee(employee: Employee) {
    const assignedAppointments = appointments.filter(
      (appointment) =>
        appointment.employeeId === employee.id &&
        !['completed', 'lost', 'cancelled'].includes(appointment.status),
    );

    Alert.alert(
      'Eliminar empleado',
      assignedAppointments.length
        ? `${employee.name} tiene ${assignedAppointments.length} cita(s) activa(s). Se desasignaran y volveran a pendiente.`
        : `Se eliminara a ${employee.name} del equipo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => deleteEmployee(employee) },
      ],
    );
  }

  async function deleteEmployee(employee: Employee) {
    const batch = writeBatch(db);
    batch.delete(doc(db, orgPath(profile.organizationId, 'employees'), employee.id));
    if (employee.inviteCode) {
      batch.delete(doc(db, 'employeeInvites', employee.inviteCode));
    }

    appointments
      .filter(
        (appointment) =>
          appointment.employeeId === employee.id &&
          !['completed', 'lost', 'cancelled'].includes(appointment.status),
      )
      .forEach((appointment) => {
        batch.update(doc(db, orgPath(profile.organizationId, 'appointments'), appointment.id), {
          employeeId: '',
          status: 'pending',
        });
      });

    if (employee.userId) {
      batch.set(
        doc(db, 'users', employee.userId),
        {
          role: 'client',
          employeeId: null,
        },
        { merge: true },
      );
    }

    await batch.commit();
  }

  function confirmDeleteAppointment(appointment: Appointment) {
    const paymentWarning =
      appointment.deposit > 0 || appointment.paymentStatus === 'paid'
        ? '\n\nEsta cita tiene anticipo o pago registrado. Borrarla de la app no hace reembolso automatico en la pasarela.'
        : '';

    Alert.alert(
      'Eliminar cita definitivamente',
      `Se borrara la cita de ${appointment.clientName} el ${appointment.date} a las ${appointment.time}.${paymentWarning}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Continuar', style: 'destructive', onPress: () => confirmDeleteAppointmentAgain(appointment) },
      ],
    );
  }

  function confirmDeleteAppointmentAgain(appointment: Appointment) {
    Alert.alert(
      'Ultima confirmacion',
      'Esta accion elimina la cita de Firestore y no se puede deshacer desde la app.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Eliminar ya',
          style: 'destructive',
          onPress: () => deleteDoc(doc(db, orgPath(profile.organizationId, 'appointments'), appointment.id)),
        },
      ],
    );
  }

  async function addDayNote() {
    await saveDayNote(dayDraft, () => setDayDraft({ id: '', date: dayDraft.date, type: 'closed', note: '' }));
  }

  async function addManualDayNote() {
    await saveDayNote(manualDayDraft, () => setManualDayDraft({ id: '', date: manualDayDraft.date, type: 'closed', note: '' }));
  }

  async function saveDayNote(draft: DayNote, onSaved: () => void) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      Alert.alert('Fecha invalida', 'Usa formato AAAA-MM-DD, por ejemplo 2026-12-25.');
      return;
    }
    if (!draft.note.trim()) {
      Alert.alert('Falta nota', 'Agrega una nota para identificar el dia especial.');
      return;
    }
    await addDoc(collection(db, orgPath(profile.organizationId, 'dayNotes')), {
      date: draft.date,
      type: draft.type,
      note: draft.note.trim(),
    });
    onSaved();
  }

  async function addAnnouncement() {
    if (!announcementDraft.title.trim() || !announcementDraft.body.trim()) return;
    await addDoc(collection(db, orgPath(profile.organizationId, 'announcements')), {
      title: announcementDraft.title.trim(),
      body: announcementDraft.body.trim(),
      active: true,
    });
    setAnnouncementDraft({ title: '', body: '' });
  }

  async function saveSettings() {
    const depositPercent = Number(settingsDraft.depositPercent || 0);
    const toleranceMinutes = Number(settingsDraft.toleranceMinutes || 0);
    const cancellationLimitHours = Number(settingsDraft.cancellationLimitHours || 0);
    if (!Number.isFinite(depositPercent) || !Number.isFinite(toleranceMinutes) || !Number.isFinite(cancellationLimitHours)) {
      Alert.alert('Configuracion invalida', 'Revisa que anticipo, tolerancia y horas de cancelacion sean numeros validos.');
      return;
    }
    if (settingsDraft.requireDeposit && (depositPercent <= 0 || depositPercent > 100)) {
      Alert.alert('Anticipo invalido', 'Si vas a pedir anticipo, usa un porcentaje entre 1 y 100.');
      return;
    }
    if (toleranceMinutes < 0) {
      Alert.alert('Tolerancia invalida', 'Los minutos de tolerancia no pueden ser negativos.');
      return;
    }
    if (cancellationLimitHours < 0 || cancellationLimitHours > 720) {
      Alert.alert('Cancelacion invalida', 'Usa un plazo entre 0 y 720 horas.');
      return;
    }

    await setDoc(
      doc(db, 'organizations', profile.organizationId, 'settings', 'business'),
      {
        requireDeposit: Boolean(settingsDraft.requireDeposit),
        depositPercent,
        toleranceMinutes,
        cancellationLimitHours,
      },
      { merge: true },
    );
    Alert.alert('Configuracion guardada', settingsDraft.requireDeposit ? 'El negocio pedira anticipo al apartar citas.' : 'El negocio no pedira anticipo al apartar citas.');
  }

  async function saveAppearance() {
    if (!appearanceDraft.displayName.trim()) {
      Alert.alert('Falta nombre visible', 'Agrega el nombre que veran clientes y empleados.');
      return;
    }

    await setDoc(
      doc(db, 'organizations', profile.organizationId, 'settings', 'appearance'),
      {
        preset: appearanceDraft.preset,
        displayName: appearanceDraft.displayName.trim(),
        tagline: appearanceDraft.tagline.trim(),
        welcomeMessage: appearanceDraft.welcomeMessage.trim(),
        logoUrl: appearanceDraft.logoUrl ?? '',
      },
      { merge: true },
    );
    Alert.alert('Apariencia guardada', 'El estilo del negocio fue actualizado.');
  }

  async function pickAndUploadLogo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tus imagenes para subir el logo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.82,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;

    try {
      const asset = result.assets[0];
      const base64Logo = asset.base64;
      if (!base64Logo) return;
      const mimeType = asset.mimeType || 'image/jpeg';
      let logoUrl = '';

      if (runtimeFeatures.firebaseStorage) {
        const logoRef = ref(storage, `organizations/${profile.organizationId}/branding/logo.jpg`);
        await uploadString(logoRef, base64Logo, 'base64', {
          contentType: mimeType,
        });
        logoUrl = await getDownloadURL(logoRef);
      } else {
        if (base64Logo.length > 850000) {
          Alert.alert('Logo muy pesado', 'Elige o recorta una imagen mas pequena. Sin Blaze guardamos una version ligera en Firestore.');
          return;
        }
        logoUrl = `data:${mimeType};base64,${base64Logo}`;
      }

      setAppearanceDraft((current) => ({ ...current, logoUrl }));
      await setDoc(doc(db, 'organizations', profile.organizationId, 'settings', 'appearance'), { logoUrl }, { merge: true });
      Alert.alert(
        'Logo actualizado',
        runtimeFeatures.firebaseStorage
          ? 'El logo del negocio fue subido correctamente.'
          : 'El logo se guardo en Firestore en modo temporal sin Blaze. Para produccion conviene usar Storage.',
      );
    } catch (error) {
      Alert.alert('No se pudo subir el logo', readableFirebaseError(error));
    }
  }

  async function connectMercadoPago() {
    if (!runtimeFeatures.firebaseFunctions || !runtimeFeatures.mercadoPagoCheckout) {
      Alert.alert('Blaze pendiente', noBlazeMessage);
      return;
    }
    try {
      const url = await createMercadoPagoOAuthUrl(profile.organizationId);
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('No se pudo conectar', readableFirebaseError(error));
    }
  }

  function confirmDisconnectMercadoPago() {
    if (!runtimeFeatures.firebaseFunctions || !runtimeFeatures.mercadoPagoCheckout) {
      Alert.alert('Blaze pendiente', noBlazeMessage);
      return;
    }
    Alert.alert(
      'Desconectar Mercado Pago',
      'El negocio dejara de recibir anticipos por Mercado Pago hasta que se vuelva a conectar.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar',
          style: 'destructive',
          onPress: async () => {
            try {
              await disconnectMercadoPago(profile.organizationId);
            } catch (error) {
              Alert.alert('No se pudo desconectar', readableFirebaseError(error));
            }
          },
        },
      ],
    );
  }

  async function saveSchedule() {
    const start = parseClock(settingsDraft.businessStart);
    const end = parseClock(settingsDraft.businessEnd);
    const breakStart = parseClock(settingsDraft.breakStart);
    const breakEnd = parseClock(settingsDraft.breakEnd);
    if (!settingsDraft.workingDays?.length) {
      Alert.alert('Faltan dias laborales', 'Selecciona al menos un dia de trabajo.');
      return;
    }
    if (start === null || end === null || start >= end) {
      Alert.alert('Horario invalido', 'Usa formato 24 horas y verifica que la apertura sea antes del cierre. Ej. 09:00 a 18:00.');
      return;
    }
    if (settingsDraft.breakEnabled && (breakStart === null || breakEnd === null || breakStart >= breakEnd || breakStart < start || breakEnd > end)) {
      Alert.alert('Break invalido', 'La comida o descanso debe estar dentro del horario laboral y tener inicio antes del fin.');
      return;
    }
    if (Number(settingsDraft.slotMinutes || 0) < 15) {
      Alert.alert('Intervalo invalido', 'El intervalo minimo permitido es de 15 minutos.');
      return;
    }

    await setDoc(
      doc(db, 'organizations', profile.organizationId, 'settings', 'business'),
      {
        businessStart: settingsDraft.businessStart,
        businessEnd: settingsDraft.businessEnd,
        breakEnabled: Boolean(settingsDraft.breakEnabled),
        breakStart: settingsDraft.breakStart,
        breakEnd: settingsDraft.breakEnd,
        slotMinutes: Number(settingsDraft.slotMinutes || 60),
        workingDays: settingsDraft.workingDays?.length ? settingsDraft.workingDays : [1, 2, 3, 4, 5, 6],
      },
      { merge: true },
    );
  }

  async function saveBusiness() {
    if (!businessDraft.name.trim()) {
      Alert.alert('Falta nombre', 'Agrega el nombre del negocio.');
      return;
    }
    if (!isAddressComplete(businessDraft.address)) {
      Alert.alert('Falta direccion', 'Completa calle, colonia, ciudad, estado, numero exterior y codigo postal.');
      return;
    }
    await setDoc(
      doc(db, 'organizations', profile.organizationId),
      {
        name: businessDraft.name.trim(),
        address: businessDraft.address,
      },
      { merge: true },
    );
    await setDoc(
      doc(db, 'users', profile.id),
      {
        organizationName: businessDraft.name.trim(),
      },
      { merge: true },
    );
    Alert.alert('Negocio actualizado', 'Los datos del negocio fueron guardados.');
  }

  async function markDepositReceived(appointment: Appointment, method: 'cash' | 'transfer') {
    await updateDoc(doc(db, orgPath(profile.organizationId, 'appointments'), appointment.id), {
      status: appointment.status === 'pending' ? 'confirmed' : appointment.status,
      paymentStatus: 'paid',
      paymentMethod: method,
      paymentProvider: 'none',
      paymentStatusDetail: method === 'cash' ? 'Anticipo recibido en efectivo.' : 'Anticipo recibido por transferencia/SPEI.',
      paymentReference: `Confirmado manualmente por admin - ${new Date().toISOString()}`,
    });
  }

  return (
    <ScrollView contentContainerStyle={[theme.styles.scrollContent, { backgroundColor: brandColors.background }]}>
      <View style={[theme.styles.card, { borderColor: brandColors.line }]}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Codigo del negocio para clientes</Text>
        <Text style={theme.styles.screenTitle}>{organization?.publicCode ?? 'Generando...'}</Text>
        <Text style={theme.styles.mutedText}>{formatAddress(organization?.address)}</Text>
        <Text style={theme.styles.mutedText}>Comparte este codigo corto con clientes. El ID interno queda oculto.</Text>
      </View>

      <AdminTabMenu
        value={tab}
        onChange={(value) => setTab(value as AdminTab)}
        organizationName={appearance.displayName || organization?.name || profile.organizationName}
        organizationCode={organization?.publicCode}
        logoUrl={appearance.logoUrl}
      />

      {tab === 'business' ? (
        <Section title="Datos del negocio" icon="storefront-outline">
          <AdminOverview
            appointments={appointments}
            services={services}
            employees={employees}
            organizationCode={organization?.publicCode}
            onOpenAgenda={() => setTab('agenda')}
            onOpenServices={() => setTab('services')}
            onOpenEmployees={() => setTab('employees')}
          />
          <View style={theme.styles.card}>
            <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Codigo publico</Text>
            <Text style={theme.styles.screenTitle}>{organization?.publicCode ?? 'Generando...'}</Text>
            <Text style={theme.styles.mutedText}>Este codigo se comparte con clientes y admins invitados.</Text>
          </View>
          <LabeledInput label="Nombre del negocio" placeholder="Ej. Barbershop Centro" value={businessDraft.name} onChangeText={(name) => setBusinessDraft({ ...businessDraft, name })} />
          <OrganizationAddressFields
            value={businessDraft.address}
            onChange={(address) => setBusinessDraft({ ...businessDraft, address })}
          />
          <PrimaryButton icon="save" label="Guardar datos del negocio" onPress={saveBusiness} />
        </Section>
      ) : null}

      {tab === 'agenda' ? (
        <>
          <Section title="Agenda activa" icon="calendar-outline">
            <PrimaryButton icon="add-circle" label="Agregar cita manual" onPress={() => setManualAppointmentOpen(true)} />
            <Text style={theme.styles.mutedText}>Las citas terminadas, perdidas o canceladas salen automaticamente de esta vista y pasan al historial.</Text>
            {activeAppointments.length ? (
              activeAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  services={services}
                  employees={employees}
                  onStatus={(status) => updateDoc(doc(db, orgPath(profile.organizationId, 'appointments'), appointment.id), { status })}
                  onCompletePayment={(method) =>
                    updateDoc(doc(db, orgPath(profile.organizationId, 'appointments'), appointment.id), {
                      status: 'completed',
                      servicePaymentMethod: method,
                      servicePaymentStatus: method === 'cash' ? 'paid' : 'pending',
                      servicePaidAt: method === 'cash' ? new Date() : null,
                    })
                  }
                  extraActions={
                    <View style={{ gap: 8 }}>
                      {appointment.deposit > 0 && appointment.paymentStatus === 'pending' ? (
                        <View style={theme.styles.row}>
                          <SmallButton label="Anticipo efectivo" onPress={() => markDepositReceived(appointment, 'cash')} />
                          <SmallButton label="Anticipo transferencia" onPress={() => markDepositReceived(appointment, 'transfer')} />
                        </View>
                      ) : null}
                      <View style={theme.styles.row}>
                        <SmallButton
                          label="Avisar demora"
                          onPress={() =>
                            updateDoc(doc(db, orgPath(profile.organizationId, 'appointments'), appointment.id), {
                              status: 'waiting',
                              delayMinutes: 10,
                              delayNotice: 'Estamos atendiendo a otro cliente. Te pedimos una disculpa por la demora, en breve te atenderemos.',
                            })
                          }
                        />
                        <SmallButton label="Eliminar" danger onPress={() => confirmDeleteAppointment(appointment)} />
                      </View>
                      <View style={theme.styles.pillWrap}>
                        {availableEmployeesForSlot(
                          employees,
                          appointments,
                          services,
                          appointment.date,
                          appointment.time,
                          appointmentDuration(appointment, services),
                          appointment.id,
                        ).map((employee) => (
                            <Pill
                              key={employee.id}
                              label={`Asignar a ${employee.name}`}
                              active={appointment.employeeId === employee.id}
                              onPress={() => updateDoc(doc(db, orgPath(profile.organizationId, 'appointments'), appointment.id), { employeeId: employee.id })}
                            />
                          ))}
                      </View>
                    </View>
                  }
                />
              ))
            ) : (
              <EmptyState text="No hay citas activas en la agenda." />
            )}
          </Section>
        </>
      ) : null}

      {tab === 'history' ? (
        <HistoryByDay
          historyDate={historyDate}
          setHistoryDate={setHistoryDate}
          historyDateOptions={historyDateOptions}
          appointments={historyAppointments}
          services={services}
          employees={employees}
          onDelete={confirmDeleteAppointment}
        />
      ) : null}

      {tab === 'schedule' ? (
        <ScheduleForm settings={settingsDraft} onChange={setSettingsDraft} onSave={saveSchedule} />
      ) : null}

      {tab === 'calendar' ? (
        <SpecialDaysCalendar
          month={calendarMonth}
          setMonth={setCalendarMonth}
          dayDraft={dayDraft}
          setDayDraft={setDayDraft}
          dayNotes={dayNotes}
          onAdd={addDayNote}
          manualDayDraft={manualDayDraft}
          setManualDayDraft={setManualDayDraft}
          onAddManual={addManualDayNote}
          onDelete={(id) => deleteDoc(doc(db, orgPath(profile.organizationId, 'dayNotes'), id))}
        />
      ) : null}

      {tab === 'services' ? (
        <Section title="Servicios y precios" icon="cut-outline">
          <PrimaryButton icon="add-circle" label="Nuevo servicio" onPress={() => setServiceDraft({ id: '', name: '', price: 0, duration: 45, active: true })} />
          {services.length ? (
            services.map((service) => (
              <View key={service.id} style={theme.styles.rowCard}>
                <Ionicons name={service.active ? 'checkmark-circle-outline' : 'pause-circle-outline'} size={22} color={service.active ? brandColors.primary : theme.colors.muted} />
                <View style={theme.styles.grow}>
                  <Text style={theme.styles.text}>{service.name}</Text>
                  <Text style={theme.styles.mutedText}>
                    ${service.price} MXN · {service.duration} min
                  </Text>
                </View>
                <IconButton icon="create-outline" onPress={() => setServiceDraft(service)} />
                <IconButton icon="trash-outline" onPress={() => deleteDoc(doc(db, orgPath(profile.organizationId, 'services'), service.id))} />
              </View>
            ))
          ) : (
            <EmptyState text="Crea servicios para que los clientes puedan agendar." />
          )}
        </Section>
      ) : null}

      {tab === 'employees' ? (
        <Section title="Empleados" icon="people-outline">
          <PrimaryButton icon="person-add" label="Registrar empleado" onPress={() => setEmployeeDraft({ id: '', name: '', email: '', role: '', active: true, compensationMode: 'commission', fixedSalary: 0, commissionPercent: 0 })} />
          {employees.length ? (
            employees.map((employee) => {
              const performance = employeePerformance(employee, appointments);
              return (
                <View key={employee.id} style={theme.styles.rowCard}>
                  <Ionicons name={employee.active ? 'person-circle-outline' : 'pause-circle-outline'} size={24} color={employee.active ? brandColors.primary : theme.colors.muted} />
                  <View style={theme.styles.grow}>
                    <Text style={theme.styles.text}>{employee.name}</Text>
                    <Text style={theme.styles.mutedText}>{employee.role} · {employee.email || 'sin correo'}</Text>
                    <Text style={theme.styles.mutedText}>Invitacion: {employee.inviteCode || 'se generara al guardar'}</Text>
                    <Text style={theme.styles.mutedText}>
                      Atendidos: {performance.completed} · Generado: ${performance.generated} · Destajo: ${performance.commission}
                    </Text>
                  </View>
                  <IconButton icon="create-outline" onPress={() => setEmployeeDraft(employee)} />
                  <IconButton icon="trash-outline" onPress={() => confirmDeleteEmployee(employee)} />
                </View>
              );
            })
          ) : (
            <EmptyState text="Registra empleados y comparte el ID de organizacion para que creen su cuenta." />
          )}
        </Section>
      ) : null}

      {tab === 'announcements' ? (
        <Section title="Avisos y promociones" icon="megaphone-outline">
          <LabeledInput label="Titulo del aviso" placeholder="Ej. Promocion de viernes" value={announcementDraft.title} onChangeText={(title) => setAnnouncementDraft({ ...announcementDraft, title })} />
          <LabeledInput
            label="Mensaje del aviso"
            style={theme.styles.textArea}
            placeholder="Mensaje"
            value={announcementDraft.body}
            onChangeText={(body) => setAnnouncementDraft({ ...announcementDraft, body })}
            multiline
          />
          <PrimaryButton icon="send" label="Publicar aviso" onPress={addAnnouncement} />
          {announcements.map((announcement) => (
            <View key={announcement.id} style={theme.styles.card}>
              <View style={theme.styles.rowBetween}>
                <View style={theme.styles.grow}>
                  <Text style={theme.styles.sectionTitle}>{announcement.title}</Text>
                  <Text style={theme.styles.mutedText}>{announcement.body}</Text>
                </View>
                <IconButton
                  icon={announcement.active ? 'eye-outline' : 'eye-off-outline'}
                  onPress={() => updateDoc(doc(db, orgPath(profile.organizationId, 'announcements'), announcement.id), { active: !announcement.active })}
                />
                <IconButton icon="trash-outline" onPress={() => deleteDoc(doc(db, orgPath(profile.organizationId, 'announcements'), announcement.id))} />
              </View>
            </View>
          ))}
        </Section>
      ) : null}

      {tab === 'payments' ? (
        <PaymentsForm
          connection={mercadoPagoConnection}
          backendEnabled={runtimeFeatures.firebaseFunctions && runtimeFeatures.mercadoPagoCheckout}
          onConnect={connectMercadoPago}
          onDisconnect={confirmDisconnectMercadoPago}
        />
      ) : null}

      {tab === 'appearance' ? (
        <AppearanceForm appearance={appearanceDraft} onChange={setAppearanceDraft} onSave={saveAppearance} onPickLogo={pickAndUploadLogo} />
      ) : null}

      {tab === 'settings' ? <SettingsForm settings={settingsDraft} onChange={setSettingsDraft} onSave={saveSettings} /> : null}

      <ServiceModal draft={serviceDraft} setDraft={setServiceDraft} onSave={saveService} />
      <EmployeeModal draft={employeeDraft} setDraft={setEmployeeDraft} onSave={saveEmployee} />
      <ManualAppointmentModal
        visible={manualAppointmentOpen}
        organizationId={profile.organizationId}
        services={services}
        employees={employees}
        appointments={appointments}
        dayNotes={dayNotes}
        settings={settings}
        onClose={() => setManualAppointmentOpen(false)}
      />
    </ScrollView>
  );
}

function AdminTabMenu({
  value,
  onChange,
  organizationName,
  organizationCode,
  logoUrl,
}: {
  value: AdminTab;
  onChange: (value: AdminTab) => void;
  organizationName: string;
  organizationCode?: string;
  logoUrl?: string;
}) {
  const colors = useBrandColors();
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.88, 350);
  const slide = useRef(new Animated.Value(-drawerWidth)).current;
  const current = adminTabItems.find((item) => item.key === value) ?? adminTabItems[0];

  useEffect(() => {
    if (!open) return;
    slide.setValue(-drawerWidth);
    Animated.timing(slide, {
      toValue: 0,
      duration: 230,
      useNativeDriver: true,
    }).start();
  }, [drawerWidth, open, slide]);

  function closeDrawer(nextValue?: AdminTab) {
    Animated.timing(slide, {
      toValue: -drawerWidth,
      duration: 190,
      useNativeDriver: true,
    }).start(() => {
      setOpen(false);
      if (nextValue) onChange(nextValue);
    });
  }

  return (
    <>
      <View style={[adminNavStyles.summary, { backgroundColor: colors.primaryDark, borderColor: `${colors.primary}55` }]}>
        <Pressable style={[adminNavStyles.menuButton, { backgroundColor: colors.primary }]} onPress={() => setOpen(true)}>
          <Ionicons name="menu" size={24} color={colors.surface} />
        </Pressable>
        <View style={theme.styles.grow}>
          <Text style={[adminNavStyles.overline, { color: 'rgba(255,255,255,0.78)' }]}>Panel administrador</Text>
          <Text style={adminNavStyles.currentTitle}>{current.label}</Text>
          <Text style={[adminNavStyles.currentHelper, { color: 'rgba(255,255,255,0.82)' }]}>{current.helper}</Text>
        </View>
        <View style={adminNavStyles.currentIcon}>
          <Ionicons name={current.icon} size={22} color={colors.primaryDark} />
        </View>
      </View>

      <View style={adminNavStyles.quickRow}>
        {(['agenda', 'services', 'employees'] as AdminTab[]).map((quickTab) => {
          const item = adminTabItems.find((entry) => entry.key === quickTab)!;
          return (
            <Pressable
              key={item.key}
              style={[
                adminNavStyles.quickTab,
                { borderColor: colors.line, backgroundColor: colors.surface },
                value === item.key && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
              onPress={() => onChange(item.key)}
            >
              <Ionicons name={item.icon} size={16} color={value === item.key ? colors.surface : colors.primaryDark} />
              <Text style={[adminNavStyles.quickText, { color: value === item.key ? colors.surface : colors.primaryDark }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => closeDrawer()}>
        <View style={adminNavStyles.drawerLayer}>
          <Pressable style={adminNavStyles.drawerScrim} onPress={() => closeDrawer()} />
          <Animated.View style={[adminNavStyles.drawer, { width: drawerWidth, backgroundColor: colors.background, transform: [{ translateX: slide }] }]}>
            <View style={[adminNavStyles.drawerHeader, { borderBottomColor: colors.line }]}>
                <View style={[adminNavStyles.brandMark, { backgroundColor: logoUrl ? colors.surface : colors.accent }]}>
                  {logoUrl ? (
                    <Image source={{ uri: logoUrl }} style={adminNavStyles.brandLogo} />
                  ) : (
                    <Ionicons name="sparkles-outline" size={22} color={colors.surface} />
                  )}
                </View>
              <View style={theme.styles.grow}>
                <Text style={adminNavStyles.drawerTitle}>{organizationName}</Text>
                <Text style={adminNavStyles.drawerSubtitle}>{organizationCode ?? 'Codigo pendiente'}</Text>
              </View>
              <Pressable style={[adminNavStyles.closeButton, { borderColor: colors.line, backgroundColor: colors.surface }]} onPress={() => closeDrawer()}>
                <Ionicons name="close" size={20} color={colors.primaryDark} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={adminNavStyles.drawerContent}>
              {adminTabItems.map((item) => {
                const active = item.key === value;
                return (
                  <Pressable
                    key={item.key}
                    style={[
                      adminNavStyles.drawerItem,
                      { borderColor: colors.line, backgroundColor: colors.surface },
                      active && { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
                    ]}
                    onPress={() => closeDrawer(item.key)}
                  >
                    <View style={[adminNavStyles.drawerItemIcon, { backgroundColor: colors.surfaceMuted }, active && { backgroundColor: colors.primary }]}>
                      <Ionicons name={item.icon} size={19} color={active ? colors.surface : colors.primaryDark} />
                    </View>
                    <View style={theme.styles.grow}>
                      <Text style={[adminNavStyles.drawerItemTitle, active && adminNavStyles.drawerItemTitleActive]}>{item.label}</Text>
                      <Text style={[adminNavStyles.drawerItemHelper, active && { color: 'rgba(255,255,255,0.78)' }]}>{item.helper}</Text>
                    </View>
                    {active ? <Ionicons name="chevron-forward" size={18} color={theme.colors.surface} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

function parseClock(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function relativeDates(daysBefore: number, daysAfter: number) {
  return Array.from({ length: daysBefore + daysAfter + 1 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index - daysBefore);
    return toDateId(date);
  });
}

function AdminOverview({
  appointments,
  services,
  employees,
  organizationCode,
  onOpenAgenda,
  onOpenServices,
  onOpenEmployees,
}: {
  appointments: Appointment[];
  services: Service[];
  employees: Employee[];
  organizationCode?: string;
  onOpenAgenda: () => void;
  onOpenServices: () => void;
  onOpenEmployees: () => void;
}) {
  const brandColors = useBrandColors();
  const today = toDateId(new Date());
  const activeAppointments = appointments.filter((appointment) => !isFinalAppointment(appointment));
  const todayAppointments = activeAppointments.filter((appointment) => appointment.date === today);
  const pendingAppointments = activeAppointments.filter((appointment) => appointment.status === 'pending');
  const activeServices = services.filter((service) => service.active);
  const activeEmployees = employees.filter((employee) => employee.active);

  return (
    <View style={theme.styles.card}>
      <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Resumen rapido</Text>
      <View style={theme.styles.statGrid}>
        <StatCard label="Hoy" value={todayAppointments.length} helper="citas activas" />
        <StatCard label="Pendientes" value={pendingAppointments.length} helper="por confirmar" />
        <StatCard label="Servicios" value={activeServices.length} helper="activos" />
        <StatCard label="Equipo" value={activeEmployees.length} helper="disponibles" />
      </View>
      <View style={theme.styles.pillWrap}>
        <SmallButton label="Abrir agenda" onPress={onOpenAgenda} />
        <SmallButton label="Servicios" onPress={onOpenServices} />
        <SmallButton label="Equipo" onPress={onOpenEmployees} />
      </View>
      <Text style={theme.styles.mutedText}>Codigo para clientes: {organizationCode ?? 'generando...'}</Text>
    </View>
  );
}

function StatCard({ label, value, helper }: { label: string; value: number | string; helper: string }) {
  const brandColors = useBrandColors();
  return (
    <View style={theme.styles.statCard}>
      <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>{label}</Text>
      <Text style={[theme.styles.statValue, { color: brandColors.primaryDark }]}>{value}</Text>
      <Text style={theme.styles.mutedText}>{helper}</Text>
    </View>
  );
}

function HistoryByDay({
  historyDate,
  setHistoryDate,
  historyDateOptions,
  appointments,
  services,
  employees,
  onDelete,
}: {
  historyDate: string;
  setHistoryDate: (date: string) => void;
  historyDateOptions: string[];
  appointments: Appointment[];
  services: Service[];
  employees: Employee[];
  onDelete: (appointment: Appointment) => void;
}) {
  const brandColors = useBrandColors();
  const completedCount = appointments.filter((appointment) => appointment.status === 'completed').length;
  const lostCount = appointments.filter((appointment) => appointment.status === 'lost').length;
  const cancelledCount = appointments.filter((appointment) => appointment.status === 'cancelled').length;

  return (
    <Section title="Historial por dia" icon="document-text-outline">
      <LabeledInput
        label="Fecha del historial"
        helper="Formato AAAA-MM-DD. Tambien puedes elegir un dia rapido abajo."
        placeholder="2026-05-12"
        value={historyDate}
        onChangeText={setHistoryDate}
      />
      <View style={theme.styles.pillWrap}>
        {historyDateOptions.map((date) => (
          <Pill key={date} label={dateLabel(date)} active={historyDate === date} onPress={() => setHistoryDate(date)} />
        ))}
      </View>
      <View style={theme.styles.rowCard}>
        <Ionicons name="stats-chart-outline" size={22} color={brandColors.primaryDark} />
        <View style={theme.styles.grow}>
          <Text style={theme.styles.text}>{historyDate}</Text>
          <Text style={theme.styles.mutedText}>
            Terminadas: {completedCount} · Perdidas: {lostCount} · Canceladas: {cancelledCount}
          </Text>
        </View>
      </View>
      {appointments.length ? (
        appointments.map((appointment) => (
          <AppointmentCard
            key={appointment.id}
            appointment={appointment}
            services={services}
            employees={employees}
            extraActions={
              <View style={theme.styles.row}>
                <SmallButton label="Eliminar definitivamente" danger onPress={() => onDelete(appointment)} />
              </View>
            }
          />
        ))
      ) : (
        <EmptyState text="No hay citas terminadas, perdidas o canceladas en este dia." />
      )}
    </Section>
  );
}

function AppearanceForm({
  appearance,
  onChange,
  onSave,
  onPickLogo,
}: {
  appearance: AppearanceSettings;
  onChange: (appearance: AppearanceSettings) => void;
  onSave: () => void;
  onPickLogo: () => void;
}) {
  const palette = getAppearancePalette(appearance);
  const brandColors = useBrandColors();
  const presetKeys = Object.keys(appearancePresets) as AppearanceSettings['preset'][];

  return (
    <Section title="Apariencia del negocio" icon="color-palette-outline">
      <View style={[theme.styles.heroCard, { backgroundColor: palette.primaryDark }]}>
        {appearance.logoUrl ? <Image source={{ uri: appearance.logoUrl }} style={appearanceStyles.logoPreview} /> : null}
        <Text style={[theme.styles.eyebrow, { color: theme.colors.surface }]}>{appearance.displayName || defaultAppearance.displayName}</Text>
        <Text style={[theme.styles.screenTitle, { color: theme.colors.surface }]}>{appearance.tagline || defaultAppearance.tagline}</Text>
        <Text style={[theme.styles.mutedText, { color: 'rgba(255,255,255,0.82)' }]}>{appearance.welcomeMessage || defaultAppearance.welcomeMessage}</Text>
      </View>

      <LabeledInput
        label="Nombre visible"
        helper="Este nombre aparece en encabezado y pantallas del cliente."
        value={appearance.displayName}
        onChangeText={(displayName) => onChange({ ...appearance, displayName })}
      />
      <PrimaryButton icon="image-outline" label="Subir logo del negocio" onPress={onPickLogo} />
      <LabeledInput
        label="Frase corta"
        helper="Texto breve para identificar el negocio o estilo de atencion."
        value={appearance.tagline}
        onChangeText={(tagline) => onChange({ ...appearance, tagline })}
      />
      <LabeledInput
        label="Mensaje para clientes"
        helper="Debe ser corto y directo para no hacer lenta la pantalla."
        style={theme.styles.textArea}
        value={appearance.welcomeMessage}
        onChangeText={(welcomeMessage) => onChange({ ...appearance, welcomeMessage })}
        multiline
      />

      <Text style={theme.styles.sectionTitle}>Tema visual</Text>
      <View style={theme.styles.pillWrap}>
        {presetKeys.map((preset) => {
          const option = appearancePresets[preset];
          return (
            <Pressable
              key={preset}
              onPress={() => onChange({ ...appearance, preset })}
              style={[
                theme.styles.rowCard,
                { minWidth: 150, borderColor: appearance.preset === preset ? brandColors.primaryDark : theme.colors.line },
              ]}
            >
              <View style={appearanceStyles.swatchStack}>
                <View style={[appearanceStyles.miniSwatch, { backgroundColor: option.primaryDark }]} />
                <View style={[appearanceStyles.miniSwatch, { backgroundColor: option.primary }]} />
                <View style={[appearanceStyles.miniSwatch, { backgroundColor: option.accent }]} />
              </View>
              <View style={theme.styles.grow}>
                <Text style={theme.styles.text}>{option.label}</Text>
                <Text style={theme.styles.mutedText}>Tema llamativo listo</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <PrimaryButton icon="save" label="Guardar apariencia" onPress={onSave} />
    </Section>
  );
}

function PaymentsForm({
  connection,
  backendEnabled,
  onConnect,
  onDisconnect,
}: {
  connection: MercadoPagoConnectionStatus;
  backendEnabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const brandColors = useBrandColors();
  return (
    <Section title="Pagos con Mercado Pago" icon="wallet-outline">
      {!backendEnabled ? (
        <View style={[theme.styles.card, { borderColor: brandColors.accent }]}>
          <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Modo sin Blaze</Text>
          <Text style={theme.styles.sectionTitle}>Pagos automaticos desactivados temporalmente</Text>
          <Text style={theme.styles.mutedText}>
            Puedes seguir usando agenda, servicios, empleados, anticipos manuales y confirmacion en tiempo real. Mercado Pago OAuth,
            webhooks, SPEI/OXXO automatico y Storage quedan para cuando actives Blaze.
          </Text>
        </View>
      ) : null}
      <View style={theme.styles.card}>
        <View style={theme.styles.rowBetween}>
          <View style={theme.styles.grow}>
            <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Estado marketplace</Text>
            <Text style={theme.styles.sectionTitle}>{connection.connected ? 'Cuenta conectada' : 'Sin cuenta conectada'}</Text>
            <Text style={theme.styles.mutedText}>
              {connection.connected
                ? 'Los anticipos se crearan usando el token OAuth de este negocio.'
                : 'Conecta la cuenta Mercado Pago del dueno para que reciba sus propios anticipos.'}
            </Text>
          </View>
          <Ionicons
            name={connection.connected ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            size={28}
            color={connection.connected ? brandColors.primary : brandColors.accent}
          />
        </View>
        {connection.connected ? (
          <>
            <Text style={theme.styles.mutedText}>Usuario Mercado Pago: {connection.userId ?? 'sin dato'}</Text>
            {connection.publicKey ? <Text style={theme.styles.mutedText}>Public key: {connection.publicKey.slice(0, 14)}...</Text> : null}
            <SmallButton label="Desconectar Mercado Pago" danger onPress={onDisconnect} />
          </>
        ) : (
          <PrimaryButton icon="link-outline" label={backendEnabled ? 'Conectar Mercado Pago' : 'Activar cuando haya Blaze'} onPress={onConnect} />
        )}
      </View>

      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>{backendEnabled ? 'Como funciona' : 'Mientras tanto'}</Text>
        {backendEnabled ? (
          <>
            <Text style={theme.styles.mutedText}>1. El administrador conecta su propia cuenta con OAuth.</Text>
            <Text style={theme.styles.mutedText}>2. El backend guarda tokens en una zona privada de Firestore.</Text>
            <Text style={theme.styles.mutedText}>3. Cada anticipo se crea con el access_token del negocio dueno de la cita.</Text>
            <Text style={theme.styles.mutedText}>4. Mercado Pago confirma el pago por webhook y la cita se confirma automaticamente.</Text>
          </>
        ) : (
          <>
            <Text style={theme.styles.mutedText}>1. El cliente solicita la cita y el anticipo queda pendiente.</Text>
            <Text style={theme.styles.mutedText}>2. Admin o empleado revisa transferencia, SPEI manual o efectivo.</Text>
            <Text style={theme.styles.mutedText}>3. Se marca "Anticipo recibido" y la cita pasa a confirmada.</Text>
          </>
        )}
      </View>
    </Section>
  );
}

function SettingsForm({ settings, onChange, onSave }: { settings: BusinessSettings; onChange: (settings: BusinessSettings) => void; onSave: () => void }) {
  const brandColors = useBrandColors();

  return (
    <Section title="Anticipos, cancelacion y tolerancia" icon="settings-outline">
      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Forma de apartar cita</Text>
        <Text style={theme.styles.mutedText}>El negocio puede trabajar con anticipo o permitir citas sin pago inicial.</Text>
        <View style={theme.styles.pillWrap}>
          <Pill label="Sin anticipo" active={!settings.requireDeposit} onPress={() => onChange({ ...settings, requireDeposit: false })} />
          <Pill label="Pedir anticipo" active={settings.requireDeposit} onPress={() => onChange({ ...settings, requireDeposit: true })} />
        </View>
      </View>
      <LabeledInput
        label="Porcentaje de anticipo"
        helper={settings.requireDeposit ? 'Ej. 30 significa que el cliente aparta pagando 30%.' : 'Se guarda para usarlo despues si activas el anticipo.'}
        keyboardType="numeric"
        editable={settings.requireDeposit}
        value={String(settings.depositPercent)}
        onChangeText={(value) => onChange({ ...settings, depositPercent: Number(value || 0) })}
      />
      <LabeledInput label="Minutos de tolerancia" helper="Tiempo permitido antes de marcar una cita como perdida." keyboardType="numeric" value={String(settings.toleranceMinutes)} onChangeText={(value) => onChange({ ...settings, toleranceMinutes: Number(value || 0) })} />
      <LabeledInput
        label="Horas minimas para cancelar"
        helper="Ej. 24 significa que el cliente debe cancelar al menos un dia antes. El anticipo sigue siendo no reembolsable si ya fue pagado."
        keyboardType="numeric"
        value={String(settings.cancellationLimitHours)}
        onChangeText={(value) => onChange({ ...settings, cancellationLimitHours: Number(value || 0) })}
      />
      <PrimaryButton icon="save" label="Guardar configuracion" onPress={onSave} />
    </Section>
  );
}

function ScheduleForm({ settings, onChange, onSave }: { settings: BusinessSettings; onChange: (settings: BusinessSettings) => void; onSave: () => void }) {
  const brandColors = useBrandColors();
  const workingDays = settings.workingDays?.length ? settings.workingDays : [1, 2, 3, 4, 5, 6];

  function toggleDay(day: number) {
    const nextDays = workingDays.includes(day) ? workingDays.filter((item) => item !== day) : [...workingDays, day].sort();
    onChange({ ...settings, workingDays: nextDays });
  }

  return (
    <Section title="Horario laboral" icon="time-outline">
      <Text style={theme.styles.mutedText}>Selecciona los dias en que el negocio trabaja. Los dias no seleccionados no permitiran citas.</Text>
      <View style={theme.styles.pillWrap}>
        <Pill label="Lun-Vie" active={false} onPress={() => onChange({ ...settings, workingDays: [1, 2, 3, 4, 5] })} />
        <Pill label="Lun-Sab" active={false} onPress={() => onChange({ ...settings, workingDays: [1, 2, 3, 4, 5, 6] })} />
        <Pill label="Todos" active={false} onPress={() => onChange({ ...settings, workingDays: [0, 1, 2, 3, 4, 5, 6] })} />
      </View>
      <View style={theme.styles.pillWrap}>
        {weekDays.map((day) => (
          <Pill key={day.id} label={day.short} active={workingDays.includes(day.id)} onPress={() => toggleDay(day.id)} />
        ))}
      </View>
      <LabeledInput label="Hora de apertura" helper="Formato 24 horas. Ej. 09:00." value={settings.businessStart} onChangeText={(value) => onChange({ ...settings, businessStart: value })} />
      <LabeledInput label="Hora de cierre" helper="Formato 24 horas. Ej. 18:00." value={settings.businessEnd} onChangeText={(value) => onChange({ ...settings, businessEnd: value })} />
      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Comida o break</Text>
        <Text style={theme.styles.mutedText}>Si se activa, no se ofreceran citas que choquen con este descanso.</Text>
        <View style={theme.styles.pillWrap}>
          <Pill label="Sin break" active={!settings.breakEnabled} onPress={() => onChange({ ...settings, breakEnabled: false })} />
          <Pill label="Usar break" active={settings.breakEnabled} onPress={() => onChange({ ...settings, breakEnabled: true })} />
        </View>
      </View>
      {settings.breakEnabled ? (
        <View style={theme.styles.row}>
          <View style={theme.styles.grow}>
            <LabeledInput label="Inicio break" helper="Ej. 14:00." value={settings.breakStart} onChangeText={(value) => onChange({ ...settings, breakStart: value })} />
          </View>
          <View style={theme.styles.grow}>
            <LabeledInput label="Fin break" helper="Ej. 15:00." value={settings.breakEnd} onChangeText={(value) => onChange({ ...settings, breakEnd: value })} />
          </View>
        </View>
      ) : null}
      <LabeledInput label="Intervalo de horarios" helper="Cada cuantos minutos se muestran opciones de cita. Ej. 30 o 60." keyboardType="numeric" value={String(settings.slotMinutes)} onChangeText={(value) => onChange({ ...settings, slotMinutes: Number(value || 60) })} />
      <PrimaryButton icon="save" label="Guardar horario laboral" onPress={onSave} />
    </Section>
  );
}

function SpecialDaysCalendar({
  month,
  setMonth,
  dayDraft,
  setDayDraft,
  dayNotes,
  onAdd,
  manualDayDraft,
  setManualDayDraft,
  onAddManual,
  onDelete,
}: {
  month: { year: number; month: number };
  setMonth: (month: { year: number; month: number }) => void;
  dayDraft: DayNote;
  setDayDraft: (day: DayNote) => void;
  dayNotes: DayNote[];
  onAdd: () => void;
  manualDayDraft: DayNote;
  setManualDayDraft: (day: DayNote) => void;
  onAddManual: () => void;
  onDelete: (id: string) => void;
}) {
  const brandColors = useBrandColors();
  const days = monthMatrix(month.year, month.month);
  const selectedNote = dayNotes.find((day) => day.date === dayDraft.date);

  function moveMonth(delta: number) {
    const next = new Date(month.year, month.month + delta, 1);
    setMonth({ year: next.getFullYear(), month: next.getMonth() });
  }

  return (
    <Section title="Calendario de dias especiales" icon="grid-outline">
      <View style={theme.styles.card}>
        <View style={theme.styles.rowBetween}>
          <SmallButton label="Anterior" onPress={() => moveMonth(-1)} />
          <Text style={theme.styles.sectionTitle}>{monthTitle(month.year, month.month)}</Text>
          <SmallButton label="Siguiente" onPress={() => moveMonth(1)} />
        </View>

        <View style={calendarStyles.weekHeader}>
          {weekDays.map((day) => (
            <Text key={day.id} style={calendarStyles.weekText}>{day.short}</Text>
          ))}
        </View>

        <View style={calendarStyles.grid}>
          {days.map((day) => {
            const note = dayNotes.find((item) => item.date === day.dateId);
            const selected = dayDraft.date === day.dateId;
            return (
              <Pressable
                key={day.dateId}
                style={[
                  calendarStyles.dayCell,
                  { borderColor: brandColors.line, backgroundColor: brandColors.surface },
                  !day.inMonth && calendarStyles.dayOutside,
                  selected && { borderColor: brandColors.primaryDark, borderWidth: 2 },
                  note?.type === 'closed' && calendarStyles.dayClosed,
                  note?.type === 'delay' && calendarStyles.dayDelay,
                  note?.type === 'issue' && calendarStyles.dayIssue,
                ]}
                onPress={() => setDayDraft({ ...dayDraft, date: day.dateId, note: note?.note ?? dayDraft.note, type: note?.type ?? dayDraft.type })}
              >
                <Text style={[calendarStyles.dayNumber, selected && { color: brandColors.primaryDark }]}>{day.dayNumber}</Text>
                {note ? <View style={[calendarStyles.dot, { backgroundColor: brandColors.primaryDark }]} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Dia seleccionado</Text>
        <Text style={theme.styles.sectionTitle}>{dayDraft.date}</Text>
        {selectedNote ? <Text style={theme.styles.mutedText}>Ya existe: {selectedNote.type} · {selectedNote.note}</Text> : null}
        <View style={theme.styles.pillWrap}>
          <Pill label="Descanso" active={dayDraft.type === 'closed'} onPress={() => setDayDraft({ ...dayDraft, type: 'closed' })} />
          <Pill label="Retraso" active={dayDraft.type === 'delay'} onPress={() => setDayDraft({ ...dayDraft, type: 'delay' })} />
          <Pill label="Complicacion" active={dayDraft.type === 'issue'} onPress={() => setDayDraft({ ...dayDraft, type: 'issue' })} />
        </View>
        <LabeledInput label="Nota visible para el dia" placeholder="Ej. Cerrado por dia festivo" value={dayDraft.note} onChangeText={(note) => setDayDraft({ ...dayDraft, note })} />
        <PrimaryButton icon="add-circle" label="Guardar dia especial" onPress={onAdd} />
        {selectedNote ? <SmallButton label="Eliminar dia especial seleccionado" danger onPress={() => onDelete(selectedNote.id)} /> : null}
      </View>

      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Agregar manualmente</Text>
        <Text style={theme.styles.mutedText}>Usa esta opcion si ya sabes la fecha exacta y no quieres navegar el calendario.</Text>
        <LabeledInput
          label="Fecha"
          helper="Formato AAAA-MM-DD. Ej. 2026-12-25."
          placeholder="2026-12-25"
          value={manualDayDraft.date}
          onChangeText={(date) => setManualDayDraft({ ...manualDayDraft, date })}
        />
        <View style={theme.styles.pillWrap}>
          <Pill label="Descanso" active={manualDayDraft.type === 'closed'} onPress={() => setManualDayDraft({ ...manualDayDraft, type: 'closed' })} />
          <Pill label="Retraso" active={manualDayDraft.type === 'delay'} onPress={() => setManualDayDraft({ ...manualDayDraft, type: 'delay' })} />
          <Pill label="Complicacion" active={manualDayDraft.type === 'issue'} onPress={() => setManualDayDraft({ ...manualDayDraft, type: 'issue' })} />
        </View>
        <LabeledInput
          label="Nota visible para el dia"
          placeholder="Ej. Cerrado por dia festivo"
          value={manualDayDraft.note}
          onChangeText={(note) => setManualDayDraft({ ...manualDayDraft, note })}
        />
        <PrimaryButton icon="add-circle" label="Agregar fecha manual" onPress={onAddManual} />
      </View>

      {dayNotes.length ? (
        <Section title="Lista de dias especiales" icon="list-outline">
          {dayNotes.map((day) => (
            <View key={day.id} style={theme.styles.rowCard}>
              <Ionicons name="information-circle-outline" size={22} color={brandColors.accent} />
              <View style={theme.styles.grow}>
                <Text style={theme.styles.text}>{day.date} · {day.type}</Text>
                <Text style={theme.styles.mutedText}>{day.note}</Text>
              </View>
              <IconButton icon="trash-outline" onPress={() => onDelete(day.id)} />
            </View>
          ))}
        </Section>
      ) : null}
    </Section>
  );
}

const calendarStyles = StyleSheet.create({
  weekHeader: {
    flexDirection: 'row',
    gap: 6,
  },
  weekText: {
    flex: 1,
    textAlign: 'center',
    color: theme.colors.muted,
    fontWeight: '800',
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dayCell: {
    width: '13.4%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayOutside: {
    opacity: 0.35,
  },
  daySelected: {
    borderColor: theme.colors.primaryDark,
    borderWidth: 2,
  },
  dayClosed: {
    backgroundColor: '#fdebed',
  },
  dayDelay: {
    backgroundColor: '#fff5dc',
  },
  dayIssue: {
    backgroundColor: '#eaf2ff',
  },
  dayNumber: {
    color: theme.colors.ink,
    fontWeight: '800',
  },
  daySelectedText: {
    color: theme.colors.primaryDark,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.colors.primaryDark,
  },
});

const adminNavStyles = StyleSheet.create({
  summary: {
    minHeight: 78,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.primaryDark,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    boxShadow: '0 10px 26px rgba(17, 24, 39, 0.18)',
  },
  menuButton: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  overline: {
    color: theme.colors.surface,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  currentTitle: {
    color: theme.colors.surface,
    fontSize: 22,
    fontWeight: '800',
  },
  currentHelper: {
    color: theme.colors.surface,
    fontSize: 13,
    lineHeight: 18,
  },
  currentIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickTab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  quickTabActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  quickText: {
    color: theme.colors.primaryDark,
    fontSize: 13,
    fontWeight: '800',
  },
  quickTextActive: {
    color: theme.colors.surface,
  },
  drawerLayer: {
    flex: 1,
  },
  drawerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.42)',
  },
  drawer: {
    flex: 1,
    backgroundColor: theme.colors.background,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    paddingTop: 18,
    boxShadow: '10px 0 30px rgba(17, 24, 39, 0.24)',
  },
  drawerHeader: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
    overflow: 'hidden',
  },
  brandLogo: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  drawerTitle: {
    color: theme.colors.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  drawerSubtitle: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  drawerContent: {
    padding: 12,
    gap: 8,
    paddingBottom: 28,
  },
  drawerItem: {
    minHeight: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surface,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  drawerItemActive: {
    backgroundColor: theme.colors.primaryDark,
    borderColor: theme.colors.primaryDark,
  },
  drawerItemIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
  drawerItemIconActive: {
    backgroundColor: theme.colors.primary,
  },
  drawerItemTitle: {
    color: theme.colors.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  drawerItemTitleActive: {
    color: theme.colors.surface,
  },
  drawerItemHelper: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  drawerItemHelperActive: {
    color: theme.colors.surface,
  },
});

const appearanceStyles = StyleSheet.create({
  logoPreview: {
    width: 68,
    height: 68,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
  },
  swatchStack: {
    width: 34,
    gap: 3,
  },
  miniSwatch: {
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.08)',
  },
});

function ServiceModal({ draft, setDraft, onSave }: { draft: Service | null; setDraft: (service: Service | null) => void; onSave: () => void }) {
  const brandColors = useBrandColors();

  function updateDuration(part: 'hours' | 'minutes', rawValue: string) {
    if (!draft) return;
    const numericValue = Math.max(0, Number(rawValue.replace(/[^0-9]/g, '') || 0));
    const currentHours = Math.floor(draft.duration / 60);
    const currentMinutes = draft.duration % 60;
    const hours = part === 'hours' ? Math.min(numericValue, 24) : currentHours;
    const minutes = part === 'minutes' ? Math.min(numericValue, 59) : currentMinutes;
    const total = Math.min(hours * 60 + minutes, 24 * 60);
    setDraft({ ...draft, duration: total });
  }

  return (
    <Modal visible={!!draft} transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        {draft ? (
          <View style={theme.styles.modalCard}>
            <Text style={theme.styles.title}>{draft.id ? 'Editar servicio' : 'Nuevo servicio'}</Text>
            <LabeledInput label="Nombre del servicio" placeholder="Ej. Corte clasico" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <LabeledInput label="Precio del servicio" helper="Cantidad en pesos MXN. Ej. 50." keyboardType="numeric" value={String(draft.price)} onChangeText={(price) => setDraft({ ...draft, price: Number(price || 0) })} />
            <Text style={theme.styles.sectionTitle}>Duracion del servicio</Text>
            <View style={theme.styles.row}>
              <View style={theme.styles.grow}>
                <LabeledInput
                  label="Horas"
                  helper="Maximo 24 horas."
                  keyboardType="numeric"
                  value={String(Math.floor(draft.duration / 60))}
                  onChangeText={(value) => updateDuration('hours', value)}
                />
              </View>
              <View style={theme.styles.grow}>
                <LabeledInput
                  label="Minutos"
                  helper="De 0 a 59."
                  keyboardType="numeric"
                  value={String(draft.duration % 60)}
                  onChangeText={(value) => updateDuration('minutes', value)}
                />
              </View>
            </View>
            <Text style={theme.styles.mutedText}>Duracion final: {formatDuration(draft.duration)}</Text>
            <Pressable style={theme.styles.row} onPress={() => setDraft({ ...draft, active: !draft.active })}>
              <Ionicons name={draft.active ? 'checkbox' : 'square-outline'} size={22} color={brandColors.primaryDark} />
              <Text style={theme.styles.text}>Servicio activo</Text>
            </Pressable>
            <View style={theme.styles.row}>
              <SmallButton label="Cancelar" onPress={() => setDraft(null)} />
              <SmallButton label="Guardar" onPress={onSave} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function EmployeeModal({ draft, setDraft, onSave }: { draft: Employee | null; setDraft: (employee: Employee | null) => void; onSave: () => void }) {
  const brandColors = useBrandColors();

  return (
    <Modal visible={!!draft} transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        {draft ? (
          <View style={theme.styles.modalCard}>
            <Text style={theme.styles.title}>{draft.id ? 'Editar empleado' : 'Nuevo empleado'}</Text>
            <LabeledInput label="Nombre del empleado" placeholder="Ej. Karen" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <LabeledInput label="Correo para vincular login" helper="Debe coincidir con el correo que usara al registrarse." value={draft.email} autoCapitalize="none" keyboardType="email-address" onChangeText={(email) => setDraft({ ...draft, email })} />
            <LabeledInput label="Puesto o especialidad" placeholder="Ej. Barbera, colorista, manicurista" value={draft.role} onChangeText={(role) => setDraft({ ...draft, role })} />
            <Text style={theme.styles.sectionTitle}>Pago del empleado</Text>
            <View style={theme.styles.pillWrap}>
              <Pill label="Sueldo fijo" active={draft.compensationMode === 'fixed'} onPress={() => setDraft({ ...draft, compensationMode: 'fixed' })} />
              <Pill label="Destajo" active={(draft.compensationMode ?? 'commission') === 'commission'} onPress={() => setDraft({ ...draft, compensationMode: 'commission' })} />
              <Pill label="Mixto" active={draft.compensationMode === 'mixed'} onPress={() => setDraft({ ...draft, compensationMode: 'mixed' })} />
            </View>
            {draft.compensationMode === 'fixed' || draft.compensationMode === 'mixed' ? (
              <LabeledInput label="Sueldo fijo" helper="Monto acordado por periodo. Ej. 2500." keyboardType="numeric" value={String(draft.fixedSalary ?? 0)} onChangeText={(fixedSalary) => setDraft({ ...draft, fixedSalary: Number(fixedSalary || 0) })} />
            ) : null}
            {(draft.compensationMode ?? 'commission') === 'commission' || draft.compensationMode === 'mixed' ? (
              <LabeledInput label="Porcentaje de destajo" helper="Ej. 40 significa 40% de lo generado en servicios terminados." keyboardType="numeric" value={String(draft.commissionPercent ?? 0)} onChangeText={(commissionPercent) => setDraft({ ...draft, commissionPercent: Number(commissionPercent || 0) })} />
            ) : null}
            {draft.inviteCode ? (
              <View style={theme.styles.card}>
                <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Codigo privado de empleado</Text>
                <Text style={theme.styles.sectionTitle}>{draft.inviteCode}</Text>
              </View>
            ) : null}
            <Pressable style={theme.styles.row} onPress={() => setDraft({ ...draft, active: !draft.active })}>
              <Ionicons name={draft.active ? 'checkbox' : 'square-outline'} size={22} color={brandColors.primaryDark} />
              <Text style={theme.styles.text}>Empleado activo</Text>
            </Pressable>
            <View style={theme.styles.row}>
              <SmallButton label="Cancelar" onPress={() => setDraft(null)} />
              <SmallButton label="Guardar" onPress={onSave} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
