import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppointmentCard } from '../components/AppointmentCard';
import { ManualAppointmentModal } from '../components/ManualAppointmentModal';
import { emptyAddress, formatAddress, isAddressComplete, OrganizationAddressFields } from '../components/OrganizationAddressFields';
import { EmptyState, IconButton, LabeledInput, Pill, PrimaryButton, Section, SmallButton } from '../components/ui';
import { useOrganizationData } from '../hooks/useOrganizationData';
import { apiAssetUrl, apiDelete, apiFinanceReport, apiPatch, apiPost, apiPut, apiStoredAssetPath, apiUploadOrganizationLogo, apiUploadPortfolioImage, financeReportCsvUrl } from '../services/api';
import { readableApiError } from '../services/errors';
import { buildPaymentSummary } from '../services/finance';
import { disconnectMercadoPago } from '../services/payments';
import { checkSqlServerConnection } from '../services/sqlServer';
import { appearancePresets, defaultAppearance, getAppearancePalette, theme } from '../theme';
import { useBrandColors } from '../theme-context';
import { AuditLog, Announcement, AppearanceSettings, Appointment, BusinessSettings, ClientHistory, DayNote, Employee, EmployeeBlock, MercadoPagoConnectionStatus, OrganizationAddress, PaymentSummary, PortfolioItem, Promotion, Service, ServiceCategory, UserProfile } from '../types';
import { makeEmployeeInviteCode } from '../utils/codes';
import { dateLabel, monthMatrix, monthTitle, toDateId, weekDays } from '../utils/dates';
import { appointmentDuration, availableEmployeesForSlot, formatDuration, selectedServiceSummaryForEmployee } from '../utils/schedule';

type AdminTab = 'business' | 'agenda' | 'history' | 'schedule' | 'calendar' | 'services' | 'employees' | 'clients' | 'announcements' | 'payments' | 'settings';

const finalAppointmentStatuses = ['completed', 'lost', 'cancelled'];
const adminTabItems: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap; helper: string }[] = [
  { key: 'business', label: 'Inicio', icon: 'storefront-outline', helper: 'Resumen y accesos rapidos' },
  { key: 'agenda', label: 'Agenda', icon: 'calendar-outline', helper: 'Citas activas y captura rapida' },
  { key: 'history', label: 'Historial', icon: 'document-text-outline', helper: 'Citas cerradas por fecha' },
  { key: 'services', label: 'Servicios', icon: 'cut-outline', helper: 'Precios y duraciones' },
  { key: 'employees', label: 'Equipo', icon: 'people-outline', helper: 'Empleados y rendimiento' },
  { key: 'clients', label: 'Clientes', icon: 'heart-outline', helper: 'Historial, puntos y notas' },
  { key: 'announcements', label: 'Avisos', icon: 'megaphone-outline', helper: 'Promos y eventos' },
  { key: 'payments', label: 'Pagos', icon: 'wallet-outline', helper: 'Anticipos y Mercado Pago' },
  { key: 'schedule', label: 'Horario', icon: 'time-outline', helper: 'Jornada y descansos' },
  { key: 'calendar', label: 'Calendario', icon: 'grid-outline', helper: 'Dias especiales' },
  { key: 'settings', label: 'Config', icon: 'settings-outline', helper: 'Negocio, apariencia y reglas' },
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

function matchesQuery(values: unknown[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value ?? '').toLowerCase().includes(normalized));
}

export function AdminScreen({ profile }: { profile: UserProfile }) {
  const { organization, serviceCategories, services, employees, appointments, dayNotes, announcements, portfolioItems, promotions, clientHistories, employeeBlocks, auditLogs, settings, appearance, mercadoPagoConnection } = useOrganizationData(profile.organizationId);
  const brandColors = useBrandColors();
  const [tab, setTab] = useState<AdminTab>('business');
  const [serviceDraft, setServiceDraft] = useState<Service | null>(null);
  const [appointmentDraft, setAppointmentDraft] = useState<Appointment | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<ServiceCategory | null>(null);
  const [portfolioDraft, setPortfolioDraft] = useState<PortfolioItem | null>(null);
  const [promotionDraft, setPromotionDraft] = useState<Promotion | null>(null);
  const [employeeBlockDraft, setEmployeeBlockDraft] = useState<EmployeeBlock | null>(null);
  const [employeeDraft, setEmployeeDraft] = useState<Employee | null>(null);
  const [manualAppointmentOpen, setManualAppointmentOpen] = useState(false);
  const [dayDraft, setDayDraft] = useState<DayNote>({ id: '', date: toDateId(new Date()), type: 'closed', note: '' });
  const [manualDayDraft, setManualDayDraft] = useState<DayNote>({ id: '', date: toDateId(new Date()), type: 'closed', note: '' });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  const [announcementDraft, setAnnouncementDraft] = useState<{ title: string; body: string; audience: NonNullable<Announcement['audience']> }>({ title: '', body: '', audience: 'clients' });
  const [settingsDraft, setSettingsDraft] = useState(settings);
  const [appearanceDraft, setAppearanceDraft] = useState(appearance);
  const [historyDate, setHistoryDate] = useState(toDateId(new Date()));
  const [agendaQuery, setAgendaQuery] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [serviceQuery, setServiceQuery] = useState('');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [reportFrom, setReportFrom] = useState(toDateId(new Date()));
  const [reportTo, setReportTo] = useState(toDateId(new Date()));
  const [financeReport, setFinanceReport] = useState<PaymentSummary | null>(null);
  const [financeReportBusy, setFinanceReportBusy] = useState(false);
  const [businessDraft, setBusinessDraft] = useState<{ name: string; address: OrganizationAddress }>({
    name: profile.organizationName,
    address: emptyAddress,
  });
  const historyDateOptions = useMemo(() => relativeDates(14, 14), []);
  const activeAppointments = useMemo(() => appointments.filter((appointment) => !isFinalAppointment(appointment)), [appointments]);
  const filteredActiveAppointments = useMemo(
    () => activeAppointments.filter((appointment) => matchesQuery([appointment.clientName, appointment.note, appointment.date, appointment.time], agendaQuery)),
    [activeAppointments, agendaQuery],
  );
  const historyAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.date === historyDate && isFinalAppointment(appointment) && matchesQuery([appointment.clientName, appointment.note, appointment.status], historyQuery)),
    [appointments, historyDate, historyQuery],
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
      categoryId: serviceDraft.categoryId ?? '',
      employeeDurations: serviceDraft.employeeDurations ?? {},
    };
    if (serviceDraft.id) {
      await apiPut(`/organizations/${profile.organizationId}/services/${serviceDraft.id}`, payload);
    } else {
      await apiPost(`/organizations/${profile.organizationId}/services`, payload);
    }
    setServiceDraft(null);
  }

  async function saveCategory() {
    if (!categoryDraft?.name.trim()) return;
    const payload = {
      name: categoryDraft.name.trim(),
      active: categoryDraft.active,
      sortOrder: Number(categoryDraft.sortOrder || 0),
    };
    if (categoryDraft.id) {
      await apiPut(`/organizations/${profile.organizationId}/service-categories/${categoryDraft.id}`, payload);
    } else {
      await apiPost(`/organizations/${profile.organizationId}/service-categories`, payload);
    }
    setCategoryDraft(null);
  }

  async function savePromotion() {
    if (!promotionDraft?.title.trim()) return;
    const payload = {
      title: promotionDraft.title.trim(),
      description: promotionDraft.description?.trim() ?? '',
      active: promotionDraft.active,
      startsAt: promotionDraft.startsAt,
      endsAt: promotionDraft.endsAt,
      discountType: promotionDraft.discountType,
      discountValue: Number(promotionDraft.discountValue || 0),
      serviceIds: promotionDraft.serviceIds,
    };
    if (promotionDraft.id) {
      await apiPut(`/organizations/${profile.organizationId}/promotions/${promotionDraft.id}`, payload);
    } else {
      await apiPost(`/organizations/${profile.organizationId}/promotions`, payload);
    }
    setPromotionDraft(null);
  }

  async function saveEmployeeBlock() {
    if (!employeeBlockDraft?.employeeId || !employeeBlockDraft.date) return;
    await apiPost(`/organizations/${profile.organizationId}/employee-blocks`, {
      employeeId: employeeBlockDraft.employeeId,
      type: employeeBlockDraft.type,
      date: employeeBlockDraft.date,
      startsAt: employeeBlockDraft.startsAt,
      endsAt: employeeBlockDraft.endsAt,
      note: employeeBlockDraft.note ?? '',
    });
    setEmployeeBlockDraft(null);
  }

  async function pickPortfolioImage() {
    if (!portfolioDraft) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tus imagenes para subir trabajos al portafolio.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.86,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    try {
      const asset = result.assets[0];
      const mimeType = asset.mimeType || 'image/jpeg';
      const { imageUrl } = await apiUploadPortfolioImage({
        organizationId: profile.organizationId,
        uri: asset.uri,
        fileName: asset.fileName || `portfolio.${mimeType.split('/')[1] || 'jpg'}`,
        mimeType,
      });
      setPortfolioDraft((current) => (current ? { ...current, imageUrl } : current));
    } catch (error) {
      Alert.alert('No se pudo subir la imagen', readableApiError(error));
    }
  }

  async function savePortfolioItem() {
    if (!portfolioDraft?.title.trim()) return;
    if (!portfolioDraft.imageUrl) {
      Alert.alert('Falta imagen', 'Sube una imagen del trabajo antes de guardar.');
      return;
    }
    const payload = {
      title: portfolioDraft.title.trim(),
      description: portfolioDraft.description?.trim() ?? '',
      categoryId: portfolioDraft.categoryId ?? '',
      employeeId: portfolioDraft.employeeId ?? '',
      imageUrl: apiStoredAssetPath(portfolioDraft.imageUrl),
      active: portfolioDraft.active !== false,
    };
    if (portfolioDraft.id) {
      await apiPut(`/organizations/${profile.organizationId}/portfolio/${portfolioDraft.id}`, payload);
    } else {
      await apiPost(`/organizations/${profile.organizationId}/portfolio`, payload);
    }
    setPortfolioDraft(null);
  }

  async function saveEmployee() {
    if (!employeeDraft?.name.trim()) return;
    const inviteCode = employeeDraft.inviteCode || makeEmployeeInviteCode();
    const payload = {
      name: employeeDraft.name.trim(),
      email: employeeDraft.email?.trim().toLowerCase() ?? '',
      role: employeeDraft.role.trim(),
      specialties: employeeDraft.specialties ?? [],
      active: employeeDraft.active,
      userId: employeeDraft.userId ?? '',
      inviteCode,
      compensationMode: employeeDraft.compensationMode ?? 'commission',
      fixedSalary: Number(employeeDraft.fixedSalary || 0),
      commissionPercent: Number(employeeDraft.commissionPercent || 0),
      serviceDurations: employeeDraft.serviceDurations ?? {},
      scheduleOverrides: employeeDraft.scheduleOverrides ?? {},
    };

    let employeeId = employeeDraft.id;
    if (employeeDraft.id) {
      await apiPut(`/organizations/${profile.organizationId}/employees/${employeeDraft.id}`, payload);
    } else {
      const employeeRef = await apiPost<{ id: string }>(`/organizations/${profile.organizationId}/employees`, payload);
      employeeId = employeeRef.id;
    }
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
    await apiDelete(`/organizations/${profile.organizationId}/employees/${employee.id}`);
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
      'Esta accion elimina la cita de la base de datos y no se puede deshacer desde la app.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Eliminar ya',
          style: 'destructive',
          onPress: () => apiDelete(`/organizations/${profile.organizationId}/appointments/${appointment.id}`),
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
    await apiPost(`/organizations/${profile.organizationId}/day-notes`, {
      date: draft.date,
      type: draft.type,
      note: draft.note.trim(),
    });
    onSaved();
  }

  async function addAnnouncement() {
    if (!announcementDraft.title.trim() || !announcementDraft.body.trim()) return;
    await apiPost(`/organizations/${profile.organizationId}/announcements`, {
      title: announcementDraft.title.trim(),
      body: announcementDraft.body.trim(),
      audience: announcementDraft.audience,
      active: true,
    });
    setAnnouncementDraft({ title: '', body: '', audience: 'clients' });
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

    await apiPut(`/organizations/${profile.organizationId}/settings/business`, {
      ...settingsDraft,
      requireDeposit: Boolean(settingsDraft.requireDeposit),
      depositPercent,
      toleranceMinutes,
      cancellationLimitHours,
    });
    Alert.alert('Configuracion guardada', settingsDraft.requireDeposit ? 'El negocio pedira anticipo al apartar citas.' : 'El negocio no pedira anticipo al apartar citas.');
  }

  async function saveAppearance() {
    if (!appearanceDraft.displayName.trim()) {
      Alert.alert('Falta nombre visible', 'Agrega el nombre que veran clientes y empleados.');
      return;
    }

    await apiPut(`/organizations/${profile.organizationId}/settings/appearance`, {
      preset: appearanceDraft.preset,
      displayName: appearanceDraft.displayName.trim(),
      tagline: appearanceDraft.tagline.trim(),
      welcomeMessage: appearanceDraft.welcomeMessage.trim(),
      logoUrl: apiStoredAssetPath(appearanceDraft.logoUrl),
    });
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
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    try {
      const asset = result.assets[0];
      const mimeType = asset.mimeType || 'image/jpeg';
      const { logoUrl } = await apiUploadOrganizationLogo({
        organizationId: profile.organizationId,
        uri: asset.uri,
        fileName: asset.fileName || `logo.${mimeType.split('/')[1] || 'jpg'}`,
        mimeType,
      });

      setAppearanceDraft((current) => ({ ...current, logoUrl }));
      Alert.alert('Logo actualizado', 'El logo del negocio fue guardado.');
    } catch (error) {
      Alert.alert('No se pudo subir el logo', readableApiError(error));
    }
  }

  async function connectMercadoPago() {
    Alert.alert('Pagos automaticos no activos', 'En modo self-hosted los anticipos se confirman manualmente.');
  }

  function confirmDisconnectMercadoPago() {
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
              Alert.alert('No se pudo desconectar', readableApiError(error));
            }
          },
        },
      ],
    );
  }

  async function testSqlServerConnection() {
    try {
      const status = await checkSqlServerConnection();
      Alert.alert('SQL Server conectado', `${status.serverName}\nBase: ${status.databaseName}`);
    } catch (error) {
      Alert.alert('No se pudo conectar a SQL Server', readableApiError(error));
    }
  }

  async function loadFinanceReport() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(reportTo)) {
      Alert.alert('Rango invalido', 'Usa fechas en formato AAAA-MM-DD.');
      return;
    }
    setFinanceReportBusy(true);
    try {
      const report = await apiFinanceReport(profile.organizationId, reportFrom, reportTo);
      setFinanceReport(report.summary);
    } catch (error) {
      Alert.alert('No se pudo cargar el reporte', readableApiError(error));
    } finally {
      setFinanceReportBusy(false);
    }
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

    await apiPut(`/organizations/${profile.organizationId}/settings/business`, {
      ...settingsDraft,
      businessStart: settingsDraft.businessStart,
      businessEnd: settingsDraft.businessEnd,
      breakEnabled: Boolean(settingsDraft.breakEnabled),
      breakStart: settingsDraft.breakStart,
      breakEnd: settingsDraft.breakEnd,
      slotMinutes: Number(settingsDraft.slotMinutes || 60),
      workingDays: settingsDraft.workingDays?.length ? settingsDraft.workingDays : [1, 2, 3, 4, 5, 6],
    });
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
    await apiPut(`/organizations/${profile.organizationId}`, {
      name: businessDraft.name.trim(),
      userName: profile.name,
      address: businessDraft.address,
    });
    Alert.alert('Negocio actualizado', 'Los datos del negocio fueron guardados.');
  }

  async function markDepositReceived(appointment: Appointment, method: 'cash' | 'transfer') {
    await apiPatch(`/organizations/${profile.organizationId}/appointments/${appointment.id}`, {
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
      <AdminTabMenu
        value={tab}
        onChange={(value) => setTab(value as AdminTab)}
        organizationName={appearance.displayName || organization?.name || profile.organizationName}
        organizationCode={organization?.publicCode}
        logoUrl={appearance.logoUrl}
      />

      <View style={[theme.styles.card, { borderColor: brandColors.line }]}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Codigo del negocio para clientes</Text>
        <Text style={theme.styles.screenTitle}>{organization?.publicCode ?? 'Generando...'}</Text>
        <Text style={theme.styles.mutedText}>{formatAddress(organization?.address)}</Text>
      </View>

      {tab === 'business' ? (
        <Section title="Inicio operativo" icon="storefront-outline">
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
            <Text style={theme.styles.mutedText}>Este codigo se comparte con clientes y admins invitados. Los datos del negocio ahora viven en Configuracion.</Text>
          </View>
        </Section>
      ) : null}

      {tab === 'agenda' ? (
        <>
          <Section title="Agenda activa" icon="calendar-outline">
            <PrimaryButton icon="add-circle" label="Agregar cita manual" onPress={() => setManualAppointmentOpen(true)} />
            <LabeledInput label="Buscar en agenda" placeholder="Cliente, nota, fecha u hora" value={agendaQuery} onChangeText={setAgendaQuery} />
            <AgendaSnapshot appointments={activeAppointments} />
            <Text style={theme.styles.mutedText}>Las citas terminadas, perdidas o canceladas salen automaticamente de esta vista y pasan al historial.</Text>
            {filteredActiveAppointments.length ? (
              filteredActiveAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  services={services}
                  employees={employees}
                  onStatus={(status) => apiPatch(`/organizations/${profile.organizationId}/appointments/${appointment.id}`, { status })}
                  onCompletePayment={(method) =>
                    apiPatch(`/organizations/${profile.organizationId}/appointments/${appointment.id}`, {
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
                        <SmallButton label="Editar / reprogramar" onPress={() => setAppointmentDraft(appointment)} />
                        <SmallButton
                          label="Avisar demora"
                          onPress={() =>
                            apiPatch(`/organizations/${profile.organizationId}/appointments/${appointment.id}`, {
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
                          employeeBlocks,
                          settings,
                        ).map((employee) => (
                            <Pill
                              key={employee.id}
                              label={`Asignar a ${employee.name}`}
                              active={appointment.employeeId === employee.id}
                              onPress={() => apiPatch(`/organizations/${profile.organizationId}/appointments/${appointment.id}`, { employeeId: employee.id })}
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
          historyQuery={historyQuery}
          setHistoryQuery={setHistoryQuery}
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
          onDelete={(id) => apiDelete(`/organizations/${profile.organizationId}/day-notes/${id}`)}
        />
      ) : null}

      {tab === 'services' ? (
        <Section title="Servicios y precios" icon="cut-outline">
          <View style={theme.styles.row}>
            <View style={theme.styles.grow}>
              <PrimaryButton icon="add-circle" label="Nuevo servicio" onPress={() => setServiceDraft({ id: '', name: '', price: 0, duration: 45, active: true, categoryId: serviceCategories[0]?.id })} />
            </View>
            <View style={theme.styles.grow}>
              <PrimaryButton icon="folder-open" label="Nueva categoria" onPress={() => setCategoryDraft({ id: '', name: '', slug: '', active: true, sortOrder: serviceCategories.length + 1 })} />
            </View>
          </View>
          <LabeledInput label="Buscar servicios" placeholder="Nombre, categoria o precio" value={serviceQuery} onChangeText={setServiceQuery} />
          <ServiceCategoriesList
            categories={serviceCategories}
            services={services}
            onEdit={setCategoryDraft}
            onDelete={(category) => apiDelete(`/organizations/${profile.organizationId}/service-categories/${category.id}`)}
          />
          {services.filter((service) => matchesQuery([service.name, service.price, serviceCategories.find((category) => category.id === service.categoryId)?.name], serviceQuery)).length ? (
            services.filter((service) => matchesQuery([service.name, service.price, serviceCategories.find((category) => category.id === service.categoryId)?.name], serviceQuery)).map((service) => (
              <View key={service.id} style={theme.styles.rowCard}>
                <Ionicons name={service.active ? 'checkmark-circle-outline' : 'pause-circle-outline'} size={22} color={service.active ? brandColors.primary : theme.colors.muted} />
                <View style={theme.styles.grow}>
                  <Text style={theme.styles.text}>{service.name}</Text>
                  <Text style={theme.styles.mutedText}>
                    ${service.price} MXN · {service.duration} min{service.categoryId ? ` · ${serviceCategories.find((category) => category.id === service.categoryId)?.name ?? 'categoria'}` : ''}
                  </Text>
                </View>
                <IconButton icon="create-outline" onPress={() => setServiceDraft(service)} />
                <IconButton icon="trash-outline" onPress={() => apiDelete(`/organizations/${profile.organizationId}/services/${service.id}`)} />
              </View>
            ))
          ) : (
            <EmptyState text="Crea servicios para que los clientes puedan agendar." />
          )}
          <PortfolioAdmin
            items={portfolioItems}
            categories={serviceCategories}
            employees={employees}
            onNew={() => setPortfolioDraft({ id: '', title: '', description: '', categoryId: serviceCategories[0]?.id, employeeId: '', imageUrl: '', active: true })}
            onEdit={setPortfolioDraft}
            onDelete={(item) => apiDelete(`/organizations/${profile.organizationId}/portfolio/${item.id}`)}
          />
          <PromotionsAdmin
            promotions={promotions}
            services={services}
            onNew={() => setPromotionDraft({ id: '', title: '', description: '', active: true, startsAt: toDateId(new Date()), endsAt: toDateId(new Date()), discountType: 'percent', discountValue: 10, serviceIds: [] })}
            onEdit={setPromotionDraft}
            onDelete={(promotion) => apiDelete(`/organizations/${profile.organizationId}/promotions/${promotion.id}`)}
          />
        </Section>
      ) : null}

      {tab === 'employees' ? (
        <Section title="Empleados" icon="people-outline">
          <PrimaryButton icon="person-add" label="Registrar empleado" onPress={() => setEmployeeDraft({ id: '', name: '', email: '', role: '', specialties: [], active: true, compensationMode: 'commission', fixedSalary: 0, commissionPercent: 0 })} />
          <PrimaryButton icon="ban" label="Bloquear horario" onPress={() => setEmployeeBlockDraft({ id: '', employeeId: employees[0]?.id ?? '', type: 'permission', date: toDateId(new Date()), startsAt: '09:00', endsAt: '10:00', note: '' })} />
          <LabeledInput label="Buscar empleados" placeholder="Nombre, correo, puesto o especialidad" value={employeeQuery} onChangeText={setEmployeeQuery} />
          {employees.filter((employee) => matchesQuery([employee.name, employee.email, employee.role, ...(employee.specialties ?? [])], employeeQuery)).length ? (
            employees.filter((employee) => matchesQuery([employee.name, employee.email, employee.role, ...(employee.specialties ?? [])], employeeQuery)).map((employee) => {
              const performance = employeePerformance(employee, appointments);
              return (
                <View key={employee.id} style={theme.styles.rowCard}>
                  <Ionicons name={employee.active ? 'person-circle-outline' : 'pause-circle-outline'} size={24} color={employee.active ? brandColors.primary : theme.colors.muted} />
                  <View style={theme.styles.grow}>
                    <Text style={theme.styles.text}>{employee.name}</Text>
                    <Text style={theme.styles.mutedText}>{[employee.role, ...(employee.specialties ?? [])].filter(Boolean).join(' · ') || 'sin puesto'} · {employee.email || 'sin correo'}</Text>
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
          <EmployeeBlocksAdmin
            blocks={employeeBlocks}
            employees={employees}
            onDelete={(block) => apiDelete(`/organizations/${profile.organizationId}/employee-blocks/${block.id}`)}
          />
        </Section>
      ) : null}

      {tab === 'clients' ? (
        <ClientsAdmin
          clients={clientHistories}
          auditLogs={auditLogs}
          onSaveNotes={(client, notes) =>
            apiPut(`/organizations/${profile.organizationId}/client-histories/${client.clientId}`, {
              clientName: client.clientName ?? client.clientId,
              notes,
            })
          }
        />
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
          <Text style={theme.styles.sectionTitle}>Audiencia</Text>
          <View style={theme.styles.pillWrap}>
            <Pill label="Clientes" active={announcementDraft.audience === 'clients'} onPress={() => setAnnouncementDraft({ ...announcementDraft, audience: 'clients' })} />
            <Pill label="Empleados" active={announcementDraft.audience === 'employees'} onPress={() => setAnnouncementDraft({ ...announcementDraft, audience: 'employees' })} />
            <Pill label="Todos" active={announcementDraft.audience === 'all'} onPress={() => setAnnouncementDraft({ ...announcementDraft, audience: 'all' })} />
          </View>
          <PrimaryButton icon="send" label="Publicar aviso" onPress={addAnnouncement} />
          {announcements.map((announcement) => (
            <View key={announcement.id} style={theme.styles.card}>
              <View style={theme.styles.rowBetween}>
                <View style={theme.styles.grow}>
                  <Text style={theme.styles.sectionTitle}>{announcement.title}</Text>
                  <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Para: {announcement.audience === 'employees' ? 'empleados' : announcement.audience === 'clients' ? 'clientes' : 'todos'}</Text>
                  <Text style={theme.styles.mutedText}>{announcement.body}</Text>
                </View>
                <IconButton
                  icon={announcement.active ? 'eye-outline' : 'eye-off-outline'}
                  onPress={() => apiPatch(`/organizations/${profile.organizationId}/announcements/${announcement.id}`, { active: !announcement.active })}
                />
                <IconButton icon="trash-outline" onPress={() => apiDelete(`/organizations/${profile.organizationId}/announcements/${announcement.id}`)} />
              </View>
            </View>
          ))}
        </Section>
      ) : null}

      {tab === 'payments' ? (
        <PaymentsForm
          connection={mercadoPagoConnection}
          appointments={appointments}
          services={services}
          backendEnabled={false}
          onConnect={connectMercadoPago}
          onDisconnect={confirmDisconnectMercadoPago}
          onTestSqlServer={testSqlServerConnection}
          reportFrom={reportFrom}
          reportTo={reportTo}
          onReportFromChange={setReportFrom}
          onReportToChange={setReportTo}
          onLoadFinanceReport={loadFinanceReport}
          onExportFinanceCsv={() => Linking.openURL(financeReportCsvUrl(profile.organizationId, reportFrom, reportTo))}
          financeReport={financeReport}
          financeReportBusy={financeReportBusy}
        />
      ) : null}

      {tab === 'settings' ? (
        <SettingsHub
          businessDraft={businessDraft}
          setBusinessDraft={setBusinessDraft}
          onSaveBusiness={saveBusiness}
          appearance={appearanceDraft}
          onAppearanceChange={setAppearanceDraft}
          onSaveAppearance={saveAppearance}
          onPickLogo={pickAndUploadLogo}
          settings={settingsDraft}
          onSettingsChange={setSettingsDraft}
          onSaveSettings={saveSettings}
        />
      ) : null}

      <ServiceModal draft={serviceDraft} categories={serviceCategories} employees={employees} setDraft={setServiceDraft} onSave={saveService} />
      <AppointmentEditModal
        appointment={appointmentDraft}
        services={services}
        employees={employees}
        settings={settings}
        onClose={() => setAppointmentDraft(null)}
        onSave={async (payload) => {
          if (!appointmentDraft) return;
          await apiPatch(`/organizations/${profile.organizationId}/appointments/${appointmentDraft.id}`, payload);
          setAppointmentDraft(null);
        }}
      />
      <ServiceCategoryModal draft={categoryDraft} setDraft={setCategoryDraft} onSave={saveCategory} />
      <PortfolioModal draft={portfolioDraft} categories={serviceCategories} employees={employees} setDraft={setPortfolioDraft} onPickImage={pickPortfolioImage} onSave={savePortfolioItem} />
      <PromotionModal draft={promotionDraft} services={services} setDraft={setPromotionDraft} onSave={savePromotion} />
      <EmployeeBlockModal draft={employeeBlockDraft} employees={employees} setDraft={setEmployeeBlockDraft} onSave={saveEmployeeBlock} />
      <EmployeeModal draft={employeeDraft} setDraft={setEmployeeDraft} onSave={saveEmployee} />
      <ManualAppointmentModal
        visible={manualAppointmentOpen}
        organizationId={profile.organizationId}
        services={services}
        employees={employees}
        appointments={appointments}
        dayNotes={dayNotes}
        employeeBlocks={employeeBlocks}
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

function AgendaSnapshot({ appointments }: { appointments: Appointment[] }) {
  const brandColors = useBrandColors();
  const today = toDateId(new Date());
  const todayAppointments = appointments.filter((appointment) => appointment.date === today);
  const weekDates = relativeDates(0, 6);
  return (
    <View style={theme.styles.card}>
      <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Vista semanal</Text>
      <View style={theme.styles.statGrid}>
        <StatCard label="Hoy" value={todayAppointments.length} helper="citas" />
        <StatCard label="Semana" value={appointments.filter((appointment) => weekDates.includes(appointment.date)).length} helper="citas activas" />
      </View>
      <View style={theme.styles.pillWrap}>
        {weekDates.map((date) => (
          <Pill key={date} label={`${dateLabel(date)} (${appointments.filter((appointment) => appointment.date === date).length})`} active={date === today} onPress={() => undefined} />
        ))}
      </View>
    </View>
  );
}

function HistoryByDay({
  historyDate,
  setHistoryDate,
  historyQuery,
  setHistoryQuery,
  historyDateOptions,
  appointments,
  services,
  employees,
  onDelete,
}: {
  historyDate: string;
  setHistoryDate: (date: string) => void;
  historyQuery: string;
  setHistoryQuery: (query: string) => void;
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
      <View style={theme.styles.card}>
        <View style={theme.styles.rowBetween}>
          <View style={theme.styles.grow}>
            <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Calendario compacto</Text>
            <Text style={theme.styles.sectionTitle}>{dateLabel(historyDate)}</Text>
          </View>
          <Ionicons name="calendar-number-outline" size={28} color={brandColors.primary} />
        </View>
        <LabeledInput label="Ir a fecha" helper="AAAA-MM-DD" placeholder="2026-05-12" value={historyDate} onChangeText={setHistoryDate} />
        <LabeledInput label="Buscar en historial" placeholder="Cliente, estado o nota" value={historyQuery} onChangeText={setHistoryQuery} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={theme.styles.row}>
            {historyDateOptions.map((date) => (
              <Pill key={date} label={dateLabel(date)} active={historyDate === date} onPress={() => setHistoryDate(date)} />
            ))}
          </View>
        </ScrollView>
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
  const logoUri = apiAssetUrl(appearance.logoUrl);

  return (
    <Section title="Apariencia del negocio" icon="color-palette-outline">
      <View style={[theme.styles.heroCard, { backgroundColor: palette.primaryDark }]}>
        {logoUri ? <Image source={{ uri: logoUri }} style={appearanceStyles.logoPreview} /> : null}
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

function BusinessSettingsForm({
  draft,
  setDraft,
  onSave,
}: {
  draft: { name: string; address: OrganizationAddress };
  setDraft: (draft: { name: string; address: OrganizationAddress }) => void;
  onSave: () => void;
}) {
  return (
    <Section title="Datos del negocio" icon="business-outline">
      <LabeledInput label="Nombre del negocio" placeholder="Ej. Barbershop Centro" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
      <OrganizationAddressFields value={draft.address} onChange={(address) => setDraft({ ...draft, address })} />
      <PrimaryButton icon="save" label="Guardar datos del negocio" onPress={onSave} />
    </Section>
  );
}

function SettingsHub({
  businessDraft,
  setBusinessDraft,
  onSaveBusiness,
  appearance,
  onAppearanceChange,
  onSaveAppearance,
  onPickLogo,
  settings,
  onSettingsChange,
  onSaveSettings,
}: {
  businessDraft: { name: string; address: OrganizationAddress };
  setBusinessDraft: (draft: { name: string; address: OrganizationAddress }) => void;
  onSaveBusiness: () => void;
  appearance: AppearanceSettings;
  onAppearanceChange: (appearance: AppearanceSettings) => void;
  onSaveAppearance: () => void;
  onPickLogo: () => void;
  settings: BusinessSettings;
  onSettingsChange: (settings: BusinessSettings) => void;
  onSaveSettings: () => void;
}) {
  return (
    <View style={{ gap: 18 }}>
      <Section title="Configuracion del negocio" icon="settings-outline">
        <View style={theme.styles.card}>
          <Text style={theme.styles.sectionTitle}>Centro de control</Text>
          <Text style={theme.styles.mutedText}>Datos, identidad visual y reglas operativas quedan juntos para que no tengas que cazarlos por todo el panel.</Text>
        </View>
      </Section>
      <BusinessSettingsForm draft={businessDraft} setDraft={setBusinessDraft} onSave={onSaveBusiness} />
      <AppearanceForm appearance={appearance} onChange={onAppearanceChange} onSave={onSaveAppearance} onPickLogo={onPickLogo} />
      <SettingsForm settings={settings} onChange={onSettingsChange} onSave={onSaveSettings} />
    </View>
  );
}

function PaymentsForm({
  connection,
  appointments,
  services,
  backendEnabled,
  onConnect,
  onDisconnect,
  onTestSqlServer,
  reportFrom,
  reportTo,
  onReportFromChange,
  onReportToChange,
  onLoadFinanceReport,
  onExportFinanceCsv,
  financeReport,
  financeReportBusy,
}: {
  connection: MercadoPagoConnectionStatus;
  appointments: Appointment[];
  services: Service[];
  backendEnabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onTestSqlServer: () => void;
  reportFrom: string;
  reportTo: string;
  onReportFromChange: (value: string) => void;
  onReportToChange: (value: string) => void;
  onLoadFinanceReport: () => void;
  onExportFinanceCsv: () => void;
  financeReport: PaymentSummary | null;
  financeReportBusy: boolean;
}) {
  const brandColors = useBrandColors();
  const summary = useMemo(() => buildPaymentSummary(appointments, services), [appointments, services]);
  const reportSummary = financeReport ?? summary;
  return (
    <Section title="Panel financiero" icon="wallet-outline">
      <View style={theme.styles.statGrid}>
        <StatCard label="Ingresos" value={`$${Math.round(reportSummary.totalRevenue)}`} helper="Servicios completados o pagados" />
        <StatCard label="Anticipos" value={`$${Math.round(reportSummary.deposits)}`} helper="Anticipos confirmados" />
        <StatCard label="Pendiente" value={`$${Math.round(reportSummary.pendingPayments)}`} helper="Por cobrar" />
        <StatCard label="Comisiones" value={`$${Math.round(reportSummary.fees)}`} helper="Marketplace / pasarela" />
      </View>
      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Reporte por rango</Text>
        <Text style={theme.styles.mutedText}>Consulta directamente SQL Server para corte de caja y ventas por periodo.</Text>
        <View style={theme.styles.row}>
          <View style={theme.styles.grow}>
            <LabeledInput label="Desde" helper="AAAA-MM-DD" value={reportFrom} onChangeText={onReportFromChange} />
          </View>
          <View style={theme.styles.grow}>
            <LabeledInput label="Hasta" helper="AAAA-MM-DD" value={reportTo} onChangeText={onReportToChange} />
          </View>
        </View>
        <SmallButton label={financeReportBusy ? 'Cargando...' : 'Cargar reporte'} onPress={onLoadFinanceReport} />
        <SmallButton label="Exportar CSV" onPress={onExportFinanceCsv} />
      </View>
      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>Metodos de pago</Text>
        <Text style={theme.styles.mutedText}>Efectivo: ${Math.round(reportSummary.cash)} · Transferencia: ${Math.round(reportSummary.transfer)}</Text>
        <Text style={theme.styles.mutedText}>Mercado Pago: ${Math.round(reportSummary.mercadoPago)} · SPEI: ${Math.round(reportSummary.spei)} · OXXO: ${Math.round(reportSummary.oxxo)}</Text>
      </View>
      <View style={theme.styles.card}>
        <View style={theme.styles.rowBetween}>
          <View style={theme.styles.grow}>
            <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>SQL Server</Text>
            <Text style={theme.styles.sectionTitle}>Base operativa local</Text>
            <Text style={theme.styles.mutedText}>Valida que la API local pueda abrir conexion con la base ServiCitasStudio.</Text>
          </View>
          <Ionicons name="server-outline" size={28} color={brandColors.primary} />
        </View>
        <SmallButton label="Probar SQL Server" onPress={onTestSqlServer} />
      </View>
      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>Ingresos por servicio</Text>
        {Object.entries(reportSummary.byService).length ? (
          Object.entries(reportSummary.byService).map(([service, amount]) => (
            <Text key={service} style={theme.styles.mutedText}>{service}: ${Math.round(amount)}</Text>
          ))
        ) : (
          <EmptyState text="Aun no hay servicios pagados en el periodo cargado." />
        )}
      </View>
      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>Ingresos por empleado</Text>
        {Object.entries(reportSummary.byEmployee).length ? (
          Object.entries(reportSummary.byEmployee).map(([employee, amount]) => (
            <Text key={employee} style={theme.styles.mutedText}>{employee}: ${Math.round(amount)}</Text>
          ))
        ) : (
          <EmptyState text="Aun no hay ingresos por empleado en el periodo cargado." />
        )}
      </View>

      <Text style={theme.styles.sectionTitle}>Mercado Pago Marketplace</Text>
      {!backendEnabled ? (
        <View style={[theme.styles.card, { borderColor: brandColors.accent }]}>
          <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Modo self-hosted</Text>
          <Text style={theme.styles.sectionTitle}>Pagos automaticos desactivados temporalmente</Text>
          <Text style={theme.styles.mutedText}>
            Puedes seguir usando agenda, servicios, empleados, anticipos manuales y confirmacion en tiempo real. Mercado Pago OAuth,
            webhooks y SPEI/OXXO automatico quedan para una integracion posterior de tu API propia.
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
          <PrimaryButton icon="link-outline" label={backendEnabled ? 'Conectar Mercado Pago' : 'Pagos automaticos no activos'} onPress={onConnect} />
        )}
      </View>

      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>{backendEnabled ? 'Como funciona' : 'Mientras tanto'}</Text>
        {backendEnabled ? (
          <>
            <Text style={theme.styles.mutedText}>1. El administrador conecta su propia cuenta con OAuth.</Text>
            <Text style={theme.styles.mutedText}>2. El backend guarda tokens en una zona privada de SQL Server.</Text>
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
      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Politica de tardanza</Text>
        <Text style={theme.styles.mutedText}>Activa esta clausula solo si el negocio puede negar o marcar perdida la cita despues de la tolerancia.</Text>
        <View style={theme.styles.pillWrap}>
          <Pill label="Sin clausula" active={!settings.latePolicyEnabled} onPress={() => onChange({ ...settings, latePolicyEnabled: false })} />
          <Pill label="Aplicar tolerancia" active={settings.latePolicyEnabled} onPress={() => onChange({ ...settings, latePolicyEnabled: true })} />
        </View>
      </View>
      <LabeledInput
        label="Minutos de tolerancia"
        helper={settings.latePolicyEnabled ? 'Tiempo permitido antes de aplicar la clausula de tardanza.' : 'Se conserva para cuando actives la clausula.'}
        keyboardType="numeric"
        editable={settings.latePolicyEnabled}
        value={String(settings.toleranceMinutes)}
        onChangeText={(value) => onChange({ ...settings, toleranceMinutes: Number(value || 0) })}
      />
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
      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Plantillas rapidas</Text>
        <Text style={theme.styles.mutedText}>Elige una base y ajusta dias u horas abajo.</Text>
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
      </View>
      <View style={theme.styles.row}>
        <View style={theme.styles.grow}>
          <LabeledInput label="Apertura" helper="Ej. 09:00." value={settings.businessStart} onChangeText={(value) => onChange({ ...settings, businessStart: value })} />
        </View>
        <View style={theme.styles.grow}>
          <LabeledInput label="Cierre" helper="Ej. 18:00." value={settings.businessEnd} onChangeText={(value) => onChange({ ...settings, businessEnd: value })} />
        </View>
      </View>
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

const portfolioStyles = StyleSheet.create({
  thumb: {
    width: 58,
    height: 58,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceMuted,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceMuted,
  },
});

function AppointmentEditModal({
  appointment,
  services,
  employees,
  settings,
  onClose,
  onSave,
}: {
  appointment: Appointment | null;
  services: Service[];
  employees: Employee[];
  settings: BusinessSettings;
  onClose: () => void;
  onSave: (payload: Partial<Appointment>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Appointment | null>(appointment);
  const [specialPrice, setSpecialPrice] = useState('');

  useEffect(() => {
    setDraft(appointment);
    setSpecialPrice(appointment?.specialPrice == null ? '' : String(appointment.specialPrice));
  }, [appointment]);

  if (!draft) {
    return <Modal visible={false} transparent />;
  }

  const summary = selectedServiceSummaryForEmployee(draft.serviceIds, services, draft.employeeId);
  const finalTotal = specialPrice.trim() ? Number(specialPrice || 0) : summary.total;
  const discountAmount = Math.max(0, summary.total - finalTotal);

  function toggleService(serviceId: string) {
    setDraft((current) => current ? {
      ...current,
      serviceIds: current.serviceIds.includes(serviceId) ? current.serviceIds.filter((id) => id !== serviceId) : [...current.serviceIds, serviceId],
    } : current);
  }

  return (
    <Modal visible transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        <View style={[theme.styles.modalCard, { maxHeight: '94%' }]}>
          <ScrollView contentContainerStyle={{ gap: 12 }}>
            <View style={theme.styles.rowBetween}>
              <View style={theme.styles.grow}>
                <Text style={theme.styles.title}>Editar cita</Text>
                <Text style={theme.styles.mutedText}>{draft.clientName}</Text>
              </View>
              <SmallButton label="Cerrar" onPress={onClose} />
            </View>
            <View style={theme.styles.row}>
              <View style={theme.styles.grow}>
                <LabeledInput label="Fecha" helper="AAAA-MM-DD" value={draft.date} onChangeText={(date) => setDraft({ ...draft, date })} />
              </View>
              <View style={theme.styles.grow}>
                <LabeledInput label="Hora" helper="24 horas" value={draft.time} onChangeText={(time) => setDraft({ ...draft, time })} />
              </View>
            </View>
            <Text style={theme.styles.sectionTitle}>Servicios</Text>
            <View style={theme.styles.pillWrap}>
              {services.filter((service) => service.active || draft.serviceIds.includes(service.id)).map((service) => (
                <Pill key={service.id} label={service.name} active={draft.serviceIds.includes(service.id)} onPress={() => toggleService(service.id)} />
              ))}
            </View>
            <Text style={theme.styles.sectionTitle}>Empleado</Text>
            <View style={theme.styles.pillWrap}>
              {employees.filter((employee) => employee.active || employee.id === draft.employeeId).map((employee) => (
                <Pill key={employee.id} label={employee.name} active={draft.employeeId === employee.id} onPress={() => setDraft({ ...draft, employeeId: employee.id })} />
              ))}
            </View>
            <Text style={theme.styles.sectionTitle}>Estado</Text>
            <View style={theme.styles.pillWrap}>
              {(['pending', 'confirmed', 'waiting', 'in_service', 'completed', 'lost', 'cancelled'] as Appointment['status'][]).map((status) => (
                <Pill key={status} label={status} active={draft.status === status} onPress={() => setDraft({ ...draft, status })} />
              ))}
            </View>
            <LabeledInput label="Nota" style={theme.styles.textArea} value={draft.note} onChangeText={(note) => setDraft({ ...draft, note })} multiline />
            <View style={theme.styles.card}>
              <Text style={theme.styles.mutedText}>Horario negocio: {settings.businessStart}-{settings.businessEnd}</Text>
              <Text style={theme.styles.mutedText}>Subtotal: ${summary.total} · Duracion calculada: {summary.duration || draft.duration || 60} min</Text>
              <Text style={theme.styles.sectionTitle}>Total a cobrar: ${Number.isFinite(finalTotal) ? finalTotal : summary.total}</Text>
            </View>
            <LabeledInput label="Precio especial" helper="Opcional. Dejalo vacio para usar el subtotal actual." keyboardType="numeric" value={specialPrice} onChangeText={setSpecialPrice} />
            {specialPrice.trim() ? (
              <LabeledInput label="Motivo del ajuste" value={draft.discountReason ?? ''} onChangeText={(discountReason) => setDraft({ ...draft, discountReason })} />
            ) : null}
            <PrimaryButton
              icon="save"
              label="Guardar cambios"
              onPress={() => {
                if (!draft.serviceIds.length || !draft.employeeId || Number.isNaN(finalTotal) || finalTotal < 0) return;
                onSave({
                  date: draft.date,
                  time: draft.time,
                  employeeId: draft.employeeId,
                  serviceIds: draft.serviceIds,
                  status: draft.status,
                  note: draft.note,
                  duration: summary.duration || draft.duration || 60,
                  subtotal: summary.total,
                  total: specialPrice.trim() ? finalTotal : summary.total,
                  specialPrice: specialPrice.trim() ? finalTotal : null,
                  discountAmount,
                  discountReason: draft.discountReason,
                });
              }}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ServiceCategoriesList({
  categories,
  services,
  onEdit,
  onDelete,
}: {
  categories: ServiceCategory[];
  services: Service[];
  onEdit: (category: ServiceCategory) => void;
  onDelete: (category: ServiceCategory) => void;
}) {
  const brandColors = useBrandColors();
  if (!categories.length) {
    return (
      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Categorias</Text>
        <Text style={theme.styles.mutedText}>Agrupa servicios por area para que cliente y admin encuentren mas rapido lo que buscan.</Text>
      </View>
    );
  }

  return (
    <View style={theme.styles.card}>
      <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Categorias</Text>
      {categories.map((category) => (
        <View key={category.id} style={theme.styles.rowCard}>
          <Ionicons name={category.active ? 'folder-open-outline' : 'folder-outline'} size={22} color={category.active ? brandColors.primary : theme.colors.muted} />
          <View style={theme.styles.grow}>
            <Text style={theme.styles.text}>{category.name}</Text>
            <Text style={theme.styles.mutedText}>{services.filter((service) => service.categoryId === category.id).length} servicio(s)</Text>
          </View>
          <IconButton icon="create-outline" onPress={() => onEdit(category)} />
          <IconButton icon="trash-outline" onPress={() => onDelete(category)} />
        </View>
      ))}
    </View>
  );
}

function PortfolioAdmin({
  items,
  categories,
  employees,
  onNew,
  onEdit,
  onDelete,
}: {
  items: PortfolioItem[];
  categories: ServiceCategory[];
  employees: Employee[];
  onNew: () => void;
  onEdit: (item: PortfolioItem) => void;
  onDelete: (item: PortfolioItem) => void;
}) {
  const brandColors = useBrandColors();
  return (
    <View style={theme.styles.card}>
      <View style={theme.styles.rowBetween}>
        <View style={theme.styles.grow}>
          <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Portafolio</Text>
          <Text style={theme.styles.mutedText}>Muestra trabajos reales a clientes sin usar almacenamiento externo.</Text>
        </View>
        <SmallButton label="Nuevo trabajo" onPress={onNew} />
      </View>
      {items.length ? (
        items.map((item) => {
          const categoryName = categories.find((category) => category.id === item.categoryId)?.name;
          const employeeName = employees.find((employee) => employee.id === item.employeeId)?.name;
          return (
            <View key={item.id} style={theme.styles.rowCard}>
              {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={portfolioStyles.thumb} /> : <Ionicons name="image-outline" size={24} color={theme.colors.muted} />}
              <View style={theme.styles.grow}>
                <Text style={theme.styles.text}>{item.title}</Text>
                <Text style={theme.styles.mutedText}>{[categoryName, employeeName, item.active === false ? 'oculto' : 'visible'].filter(Boolean).join(' · ')}</Text>
              </View>
              <IconButton icon="create-outline" onPress={() => onEdit(item)} />
              <IconButton icon="trash-outline" onPress={() => onDelete(item)} />
            </View>
          );
        })
      ) : (
        <EmptyState text="Sube imagenes de trabajos terminados para que aparezcan en la pantalla del cliente." />
      )}
    </View>
  );
}

function PromotionsAdmin({
  promotions,
  services,
  onNew,
  onEdit,
  onDelete,
}: {
  promotions: Promotion[];
  services: Service[];
  onNew: () => void;
  onEdit: (promotion: Promotion) => void;
  onDelete: (promotion: Promotion) => void;
}) {
  const brandColors = useBrandColors();
  return (
    <View style={theme.styles.card}>
      <View style={theme.styles.rowBetween}>
        <View style={theme.styles.grow}>
          <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Promociones automaticas</Text>
          <Text style={theme.styles.mutedText}>Se aplican solas cuando el cliente agenda dentro del rango y servicios configurados.</Text>
        </View>
        <SmallButton label="Nueva promo" onPress={onNew} />
      </View>
      {promotions.length ? (
        promotions.map((promotion) => (
          <View key={promotion.id} style={theme.styles.rowCard}>
            <Ionicons name={promotion.active ? 'pricetag-outline' : 'pause-circle-outline'} size={22} color={promotion.active ? brandColors.primary : theme.colors.muted} />
            <View style={theme.styles.grow}>
              <Text style={theme.styles.text}>{promotion.title}</Text>
              <Text style={theme.styles.mutedText}>
                {promotion.startsAt} a {promotion.endsAt} · {promotion.discountType === 'percent' ? `${promotion.discountValue}%` : `$${promotion.discountValue}`} · {promotion.serviceIds.length ? `${promotion.serviceIds.length} servicio(s)` : 'todos los servicios'}
              </Text>
              {promotion.serviceIds.length ? <Text style={theme.styles.mutedText}>{promotion.serviceIds.map((id) => services.find((service) => service.id === id)?.name).filter(Boolean).join(', ')}</Text> : null}
            </View>
            <IconButton icon="create-outline" onPress={() => onEdit(promotion)} />
            <IconButton icon="trash-outline" onPress={() => onDelete(promotion)} />
          </View>
        ))
      ) : (
        <EmptyState text="No hay promociones activas o programadas." />
      )}
    </View>
  );
}

function EmployeeBlocksAdmin({ blocks, employees, onDelete }: { blocks: EmployeeBlock[]; employees: Employee[]; onDelete: (block: EmployeeBlock) => void }) {
  return (
    <View style={theme.styles.card}>
      <Text style={theme.styles.sectionTitle}>Bloqueos de horario</Text>
      {blocks.length ? (
        blocks.map((block) => (
          <View key={block.id} style={theme.styles.rowCard}>
            <Ionicons name="ban-outline" size={22} color={theme.colors.danger} />
            <View style={theme.styles.grow}>
              <Text style={theme.styles.text}>{employees.find((employee) => employee.id === block.employeeId)?.name ?? 'Empleado'}</Text>
              <Text style={theme.styles.mutedText}>{block.date} · {block.startsAt}-{block.endsAt} · {block.type}</Text>
              {block.note ? <Text style={theme.styles.mutedText}>{block.note}</Text> : null}
            </View>
            <IconButton icon="trash-outline" onPress={() => onDelete(block)} />
          </View>
        ))
      ) : (
        <EmptyState text="No hay bloqueos individuales registrados." />
      )}
    </View>
  );
}

function ClientsAdmin({
  clients,
  auditLogs,
  onSaveNotes,
}: {
  clients: ClientHistory[];
  auditLogs: AuditLog[];
  onSaveNotes: (client: ClientHistory, notes: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const filteredClients = clients.filter((client) => matchesQuery([client.clientName, client.clientId, client.rewardLevel, client.notes], query));
  return (
    <Section title="Clientes e historial" icon="heart-outline">
      <LabeledInput label="Buscar clientes" placeholder="Cliente, nivel o nota" value={query} onChangeText={setQuery} />
      {filteredClients.length ? (
        filteredClients.map((client) => (
          <View key={client.clientId} style={theme.styles.card}>
            <Text style={theme.styles.sectionTitle}>{client.clientName ?? client.clientId}</Text>
            <Text style={theme.styles.mutedText}>Citas: {client.totalAppointments} · Cancelaciones: {client.cancellations} · Perdidas: {client.noShows}</Text>
            <Text style={theme.styles.mutedText}>Gastado: ${client.totalSpent} · Puntos: {client.rewardPoints} · Nivel: {client.rewardLevel}</Text>
            <LabeledInput
              label="Notas internas"
              style={theme.styles.textArea}
              value={notesDraft[client.clientId] ?? client.notes ?? ''}
              onChangeText={(notes) => setNotesDraft({ ...notesDraft, [client.clientId]: notes })}
              multiline
            />
            <SmallButton label="Guardar notas" onPress={() => onSaveNotes(client, notesDraft[client.clientId] ?? client.notes ?? '')} />
          </View>
        ))
      ) : (
        <EmptyState text="Aun no hay historial de clientes." />
      )}
      <View style={theme.styles.card}>
        <Text style={theme.styles.sectionTitle}>Auditoria reciente</Text>
        {auditLogs.length ? (
          auditLogs.slice(0, 20).map((log) => (
            <Text key={log.id} style={theme.styles.mutedText}>{String(log.createdAt).slice(0, 19)} · {log.actorName ?? 'Sistema'} · {log.action} {log.entityType}</Text>
          ))
        ) : (
          <EmptyState text="Aun no hay movimientos auditados." />
        )}
      </View>
    </Section>
  );
}

function ServiceModal({ draft, categories, employees, setDraft, onSave }: { draft: Service | null; categories: ServiceCategory[]; employees: Employee[]; setDraft: (service: Service | null) => void; onSave: () => void }) {
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
          <View style={[theme.styles.modalCard, { maxHeight: '94%' }]}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
            <Text style={theme.styles.title}>{draft.id ? 'Editar servicio' : 'Nuevo servicio'}</Text>
            <LabeledInput label="Nombre del servicio" placeholder="Ej. Corte clasico" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <LabeledInput label="Precio del servicio" helper="Cantidad en pesos MXN. Ej. 50." keyboardType="numeric" value={String(draft.price)} onChangeText={(price) => setDraft({ ...draft, price: Number(price || 0) })} />
            <Text style={theme.styles.sectionTitle}>Categoria</Text>
            <View style={theme.styles.pillWrap}>
              <Pill label="Sin categoria" active={!draft.categoryId} onPress={() => setDraft({ ...draft, categoryId: '' })} />
              {categories.map((category) => (
                <Pill key={category.id} label={category.name} active={draft.categoryId === category.id} onPress={() => setDraft({ ...draft, categoryId: category.id })} />
              ))}
            </View>
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
            <Text style={theme.styles.sectionTitle}>Duracion por empleado</Text>
            <Text style={theme.styles.mutedText}>Opcional. Si se deja en blanco usa la duracion general.</Text>
            {employees.map((employee) => (
              <LabeledInput
                key={employee.id}
                label={employee.name}
                helper="Minutos para este empleado"
                keyboardType="numeric"
                value={draft.employeeDurations?.[employee.id] ? String(draft.employeeDurations[employee.id]) : ''}
                onChangeText={(value) => {
                  const next = { ...(draft.employeeDurations ?? {}) };
                  if (value.trim()) next[employee.id] = Number(value || 0);
                  else delete next[employee.id];
                  setDraft({ ...draft, employeeDurations: next });
                }}
              />
            ))}
            <Pressable style={theme.styles.row} onPress={() => setDraft({ ...draft, active: !draft.active })}>
              <Ionicons name={draft.active ? 'checkbox' : 'square-outline'} size={22} color={brandColors.primaryDark} />
              <Text style={theme.styles.text}>Servicio activo</Text>
            </Pressable>
            <View style={theme.styles.row}>
              <SmallButton label="Cancelar" onPress={() => setDraft(null)} />
              <SmallButton label="Guardar" onPress={onSave} />
            </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function ServiceCategoryModal({ draft, setDraft, onSave }: { draft: ServiceCategory | null; setDraft: (category: ServiceCategory | null) => void; onSave: () => void }) {
  const brandColors = useBrandColors();
  return (
    <Modal visible={!!draft} transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        {draft ? (
          <View style={theme.styles.modalCard}>
            <Text style={theme.styles.title}>{draft.id ? 'Editar categoria' : 'Nueva categoria'}</Text>
            <LabeledInput label="Nombre" placeholder="Ej. Cortes, Color, Uñas" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <LabeledInput label="Orden" helper="Numero menor aparece primero." keyboardType="numeric" value={String(draft.sortOrder ?? 0)} onChangeText={(sortOrder) => setDraft({ ...draft, sortOrder: Number(sortOrder || 0) })} />
            <Pressable style={theme.styles.row} onPress={() => setDraft({ ...draft, active: !draft.active })}>
              <Ionicons name={draft.active ? 'checkbox' : 'square-outline'} size={22} color={brandColors.primaryDark} />
              <Text style={theme.styles.text}>Categoria visible</Text>
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

function PortfolioModal({
  draft,
  categories,
  employees,
  setDraft,
  onPickImage,
  onSave,
}: {
  draft: PortfolioItem | null;
  categories: ServiceCategory[];
  employees: Employee[];
  setDraft: (item: PortfolioItem | null) => void;
  onPickImage: () => void;
  onSave: () => void;
}) {
  const brandColors = useBrandColors();
  return (
    <Modal visible={!!draft} transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        {draft ? (
          <View style={[theme.styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <Text style={theme.styles.title}>{draft.id ? 'Editar trabajo' : 'Nuevo trabajo'}</Text>
              {draft.imageUrl ? <Image source={{ uri: apiAssetUrl(draft.imageUrl) }} style={portfolioStyles.preview} /> : null}
              <PrimaryButton icon="image-outline" label={draft.imageUrl ? 'Cambiar imagen' : 'Subir imagen'} onPress={onPickImage} />
              <LabeledInput label="Titulo" placeholder="Ej. Corte degradado, uñas gel" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
              <LabeledInput label="Descripcion" style={theme.styles.textArea} placeholder="Detalle corto del trabajo" value={draft.description ?? ''} onChangeText={(description) => setDraft({ ...draft, description })} multiline />
              <Text style={theme.styles.sectionTitle}>Categoria</Text>
              <View style={theme.styles.pillWrap}>
                <Pill label="Sin categoria" active={!draft.categoryId} onPress={() => setDraft({ ...draft, categoryId: '' })} />
                {categories.map((category) => (
                  <Pill key={category.id} label={category.name} active={draft.categoryId === category.id} onPress={() => setDraft({ ...draft, categoryId: category.id })} />
                ))}
              </View>
              <Text style={theme.styles.sectionTitle}>Empleado</Text>
              <View style={theme.styles.pillWrap}>
                <Pill label="Sin empleado" active={!draft.employeeId} onPress={() => setDraft({ ...draft, employeeId: '' })} />
                {employees.map((employee) => (
                  <Pill key={employee.id} label={employee.name} active={draft.employeeId === employee.id} onPress={() => setDraft({ ...draft, employeeId: employee.id })} />
                ))}
              </View>
              <Pressable style={theme.styles.row} onPress={() => setDraft({ ...draft, active: draft.active === false })}>
                <Ionicons name={draft.active === false ? 'square-outline' : 'checkbox'} size={22} color={brandColors.primaryDark} />
                <Text style={theme.styles.text}>Trabajo visible para clientes</Text>
              </Pressable>
              <View style={theme.styles.row}>
                <SmallButton label="Cancelar" onPress={() => setDraft(null)} />
                <SmallButton label="Guardar" onPress={onSave} />
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function PromotionModal({ draft, services, setDraft, onSave }: { draft: Promotion | null; services: Service[]; setDraft: (promotion: Promotion | null) => void; onSave: () => void }) {
  function toggleService(serviceId: string) {
    if (!draft) return;
    setDraft({ ...draft, serviceIds: draft.serviceIds.includes(serviceId) ? draft.serviceIds.filter((id) => id !== serviceId) : [...draft.serviceIds, serviceId] });
  }
  return (
    <Modal visible={!!draft} transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        {draft ? (
          <View style={[theme.styles.modalCard, { maxHeight: '92%' }]}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <Text style={theme.styles.title}>{draft.id ? 'Editar promocion' : 'Nueva promocion'}</Text>
              <LabeledInput label="Titulo" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
              <LabeledInput label="Descripcion" value={draft.description ?? ''} onChangeText={(description) => setDraft({ ...draft, description })} />
              <View style={theme.styles.row}>
                <View style={theme.styles.grow}>
                  <LabeledInput label="Inicia" helper="AAAA-MM-DD" value={draft.startsAt} onChangeText={(startsAt) => setDraft({ ...draft, startsAt })} />
                </View>
                <View style={theme.styles.grow}>
                  <LabeledInput label="Termina" helper="AAAA-MM-DD" value={draft.endsAt} onChangeText={(endsAt) => setDraft({ ...draft, endsAt })} />
                </View>
              </View>
              <Text style={theme.styles.sectionTitle}>Tipo de descuento</Text>
              <View style={theme.styles.pillWrap}>
                <Pill label="Porcentaje" active={draft.discountType === 'percent'} onPress={() => setDraft({ ...draft, discountType: 'percent' })} />
                <Pill label="Monto fijo" active={draft.discountType === 'fixed'} onPress={() => setDraft({ ...draft, discountType: 'fixed' })} />
              </View>
              <LabeledInput label="Valor" keyboardType="numeric" value={String(draft.discountValue)} onChangeText={(discountValue) => setDraft({ ...draft, discountValue: Number(discountValue || 0) })} />
              <Text style={theme.styles.sectionTitle}>Servicios</Text>
              <Text style={theme.styles.mutedText}>Si no eliges servicios, aplica a todos.</Text>
              <View style={theme.styles.pillWrap}>
                {services.map((service) => (
                  <Pill key={service.id} label={service.name} active={draft.serviceIds.includes(service.id)} onPress={() => toggleService(service.id)} />
                ))}
              </View>
              <Pressable style={theme.styles.row} onPress={() => setDraft({ ...draft, active: !draft.active })}>
                <Ionicons name={draft.active ? 'checkbox' : 'square-outline'} size={22} color={theme.colors.primaryDark} />
                <Text style={theme.styles.text}>Promocion activa</Text>
              </Pressable>
              <View style={theme.styles.row}>
                <SmallButton label="Cancelar" onPress={() => setDraft(null)} />
                <SmallButton label="Guardar" onPress={onSave} />
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function EmployeeBlockModal({ draft, employees, setDraft, onSave }: { draft: EmployeeBlock | null; employees: Employee[]; setDraft: (block: EmployeeBlock | null) => void; onSave: () => void }) {
  return (
    <Modal visible={!!draft} transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        {draft ? (
          <View style={theme.styles.modalCard}>
            <Text style={theme.styles.title}>Bloquear horario</Text>
            <Text style={theme.styles.sectionTitle}>Empleado</Text>
            <View style={theme.styles.pillWrap}>
              {employees.map((employee) => (
                <Pill key={employee.id} label={employee.name} active={draft.employeeId === employee.id} onPress={() => setDraft({ ...draft, employeeId: employee.id })} />
              ))}
            </View>
            <LabeledInput label="Fecha" helper="AAAA-MM-DD" value={draft.date ?? ''} onChangeText={(date) => setDraft({ ...draft, date })} />
            <View style={theme.styles.row}>
              <View style={theme.styles.grow}>
                <LabeledInput label="Inicio" value={draft.startsAt} onChangeText={(startsAt) => setDraft({ ...draft, startsAt })} />
              </View>
              <View style={theme.styles.grow}>
                <LabeledInput label="Fin" value={draft.endsAt} onChangeText={(endsAt) => setDraft({ ...draft, endsAt })} />
              </View>
            </View>
            <Text style={theme.styles.sectionTitle}>Motivo</Text>
            <View style={theme.styles.pillWrap}>
              {(['permission', 'meal', 'vacation', 'sick_leave', 'custom_schedule'] as EmployeeBlock['type'][]).map((type) => (
                <Pill key={type} label={type} active={draft.type === type} onPress={() => setDraft({ ...draft, type })} />
              ))}
            </View>
            <LabeledInput label="Nota" value={draft.note ?? ''} onChangeText={(note) => setDraft({ ...draft, note })} />
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
  const [customSpecialty, setCustomSpecialty] = useState('');
  const specialtyOptions = ['Barberia', 'Color', 'Manicure', 'Pedicure', 'Facial', 'Masaje', 'Recepcion', 'Ventas'];

  function toggleSpecialty(value: string) {
    if (!draft) return;
    const current = draft.specialties ?? [];
    setDraft({ ...draft, specialties: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  }

  function updateSchedule(dayId: number, value: Partial<NonNullable<Employee['scheduleOverrides']>[string]>) {
    if (!draft) return;
    const key = String(dayId);
    const current = draft.scheduleOverrides?.[key] ?? { enabled: true, start: '09:00', end: '18:00' };
    setDraft({ ...draft, scheduleOverrides: { ...(draft.scheduleOverrides ?? {}), [key]: { ...current, ...value } } });
  }

  return (
    <Modal visible={!!draft} transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        {draft ? (
          <View style={[theme.styles.modalCard, { maxHeight: '94%' }]}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
            <Text style={theme.styles.title}>{draft.id ? 'Editar empleado' : 'Nuevo empleado'}</Text>
            <LabeledInput label="Nombre del empleado" placeholder="Ej. Karen" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <LabeledInput label="Correo para vincular login" helper="Si ya existe como admin o empleado en este negocio, se vincula a esta ficha. Si no, debe coincidir con su registro." value={draft.email} autoCapitalize="none" keyboardType="email-address" onChangeText={(email) => setDraft({ ...draft, email })} />
            <LabeledInput label="Puesto principal" placeholder="Ej. Barbera, estilista, recepcion" value={draft.role} onChangeText={(role) => setDraft({ ...draft, role })} />
            <Text style={theme.styles.sectionTitle}>Especialidades</Text>
            <View style={theme.styles.pillWrap}>
              {specialtyOptions.map((specialty) => (
                <Pill key={specialty} label={specialty} active={(draft.specialties ?? []).includes(specialty)} onPress={() => toggleSpecialty(specialty)} />
              ))}
            </View>
            <LabeledInput
              label="Otra especialidad"
              helper="Escribe una y presiona agregar para sumarla al perfil."
              placeholder="Ej. cejas, uñas acrilicas"
              value={customSpecialty}
              onChangeText={setCustomSpecialty}
            />
            <SmallButton
              label="Agregar especialidad escrita"
              onPress={() => {
                if (!draft || !customSpecialty.trim()) return;
                const value = customSpecialty.trim();
                if (!(draft.specialties ?? []).includes(value)) {
                  setDraft({ ...draft, specialties: [...(draft.specialties ?? []), value] });
                }
                setCustomSpecialty('');
              }}
            />
            <Text style={theme.styles.sectionTitle}>Horario semanal propio</Text>
            <Text style={theme.styles.mutedText}>Opcional. Al activarlo para un dia reemplaza el horario general del negocio para ese empleado.</Text>
            {weekDays.map((day) => {
              const override = draft.scheduleOverrides?.[String(day.id)];
              const enabled = override?.enabled !== false;
              return (
                <View key={day.id} style={theme.styles.card}>
                  <View style={theme.styles.rowBetween}>
                    <Text style={theme.styles.text}>{day.label}</Text>
                    <View style={theme.styles.pillWrap}>
                      <Pill label="General" active={!override} onPress={() => {
                        if (!draft) return;
                        const next = { ...(draft.scheduleOverrides ?? {}) };
                        delete next[String(day.id)];
                        setDraft({ ...draft, scheduleOverrides: next });
                      }} />
                      <Pill label="Personal" active={!!override && enabled} onPress={() => updateSchedule(day.id, { enabled: true })} />
                      <Pill label="No trabaja" active={!!override && !enabled} onPress={() => updateSchedule(day.id, { enabled: false })} />
                    </View>
                  </View>
                  {override && enabled ? (
                    <View style={theme.styles.row}>
                      <View style={theme.styles.grow}>
                        <LabeledInput label="Entrada" value={override.start} onChangeText={(start) => updateSchedule(day.id, { start })} />
                      </View>
                      <View style={theme.styles.grow}>
                        <LabeledInput label="Salida" value={override.end} onChangeText={(end) => updateSchedule(day.id, { end })} />
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
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
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
