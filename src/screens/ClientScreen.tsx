import { Ionicons } from '@expo/vector-icons';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { AppointmentCard } from '../components/AppointmentCard';
import { runtimeFeatures } from '../config/features';
import { db } from '../firebase';
import { useOrganizationData } from '../hooks/useOrganizationData';
import { createAppointment } from '../services/appointments';
import { readableFirebaseError } from '../services/errors';
import { createDepositPreference } from '../services/payments';
import { orgPath } from '../services/paths';
import { getAppearancePalette, theme } from '../theme';
import { useBrandColors } from '../theme-context';
import { Appointment, BusinessSettings, PaymentMethod, UserProfile } from '../types';
import { dateLabel, isWorkingDate, nextDates } from '../utils/dates';
import { addMinutes, availableEmployeesForSlot, availableTimeSlots, selectedServiceSummary } from '../utils/schedule';
import { EmptyState, LabeledInput, Pill, PrimaryButton, Section, SmallButton } from '../components/ui';

function getAppointmentStart(appointment: Appointment) {
  return new Date(`${appointment.date}T${appointment.time}:00`);
}

function hoursUntilAppointment(appointment: Appointment) {
  return (getAppointmentStart(appointment).getTime() - Date.now()) / 3600000;
}

function canClientCancel(appointment: Appointment) {
  return ['pending', 'confirmed', 'waiting'].includes(appointment.status) && hoursUntilAppointment(appointment) > 0;
}

function getCancellationTiming(appointment: Appointment, cancellationLimitHours: number) {
  return hoursUntilAppointment(appointment) >= Math.max(0, Number(cancellationLimitHours || 0)) ? 'on_time' : 'late';
}

export function ClientScreen({ profile }: { profile: UserProfile }) {
  const { services, employees, appointments, dayNotes, announcements, settings, appearance } = useOrganizationData(profile.organizationId);
  const brandColors = useBrandColors();
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(nextDates(14)[0]);
  const [selectedTime, setSelectedTime] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const automaticPaymentsEnabled = runtimeFeatures.firebaseFunctions && runtimeFeatures.mercadoPagoCheckout;
  const [depositPaymentMethod, setDepositPaymentMethod] = useState<PaymentMethod>(automaticPaymentsEnabled ? 'mercado_pago' : 'transfer');
  const [cancelDraft, setCancelDraft] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const dates = useMemo(() => nextDates(14), []);
  const activeServices = services.filter((service) => service.active);
  const activeEmployees = employees.filter((employee) => employee.active);
  const { total: selectedTotal, duration: selectedDuration } = selectedServiceSummary(selectedServiceIds, services);
  const effectiveDuration = selectedDuration || settings.slotMinutes;
  const safeDepositPercent = Math.max(0, Math.min(100, Number(settings.depositPercent || 0)));
  const requiresDeposit = Boolean(settings.requireDeposit);
  const deposit = requiresDeposit ? Math.round((selectedTotal * safeDepositPercent) / 100) : 0;
  const blockedDay = dayNotes.find((day) => day.date === selectedDate && day.type === 'closed');
  const isSelectedWorkingDay = isWorkingDate(selectedDate, settings);
  const availableTimes = useMemo(
    () => availableTimeSlots(settings, selectedDate, effectiveDuration, activeEmployees, appointments, services),
    [activeEmployees, appointments, effectiveDuration, selectedDate, services, settings],
  );
  const myAppointments = appointments.filter((appointment) => appointment.clientId === profile.id || appointment.clientName === profile.name);
  const palette = getAppearancePalette(appearance);

  useEffect(() => {
    if (!availableTimes.includes(selectedTime)) {
      setSelectedTime(availableTimes[0] ?? '');
    }
  }, [availableTimes, selectedTime]);

  useEffect(() => {
    if (isSelectedWorkingDay && !blockedDay) return;
    const nextAvailableDate = dates.find((date) => isWorkingDate(date, settings) && !dayNotes.some((day) => day.date === date && day.type === 'closed'));
    if (nextAvailableDate) setSelectedDate(nextAvailableDate);
  }, [blockedDay, dates, dayNotes, isSelectedWorkingDay, settings]);

  useEffect(() => {
    if (!automaticPaymentsEnabled && !['transfer', 'cash'].includes(depositPaymentMethod)) {
      setDepositPaymentMethod('transfer');
    }
  }, [automaticPaymentsEnabled, depositPaymentMethod]);

  function toggleService(id: string) {
    setSelectedServiceIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function openCancelAppointment(appointment: Appointment) {
    if (!canClientCancel(appointment)) {
      Alert.alert('No se puede cancelar', 'Esta cita ya inicio o ya tiene un estado final. Contacta al negocio si necesitas ayuda.');
      return;
    }
    setCancelReason('');
    setCancelDraft(appointment);
  }

  async function cancelAppointment() {
    if (!cancelDraft) return;
    try {
      await updateDoc(doc(db, orgPath(profile.organizationId, 'appointments'), cancelDraft.id), {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelledBy: 'client',
        cancellationReason: cancelReason.trim() || 'Cancelada por el cliente.',
        cancellationTiming: getCancellationTiming(cancelDraft, settings.cancellationLimitHours),
        refundStatus: cancelDraft.deposit > 0 ? 'non_refundable' : 'not_applicable',
        serviceRightForfeited: true,
      });
      const hadDeposit = cancelDraft.deposit > 0;
      setCancelDraft(null);
      setCancelReason('');
      Alert.alert('Cita cancelada', hadDeposit ? 'El anticipo queda marcado como no reembolsable y la cita no conserva derecho al servicio.' : 'La cita fue cancelada.');
    } catch (error) {
      Alert.alert('No se pudo cancelar', readableFirebaseError(error));
    }
  }

  async function bookAppointment() {
    if (!selectedServiceIds.length) {
      Alert.alert('Selecciona servicios', 'Elige al menos un servicio.');
      return;
    }
    if (blockedDay) {
      Alert.alert('Dia cerrado', 'El negocio marco este dia como descanso.');
      return;
    }
    if (!isSelectedWorkingDay) {
      Alert.alert('Dia no laboral', 'Selecciona un dia dentro del horario laboral del negocio.');
      return;
    }
    if (!selectedTime) {
      Alert.alert('Sin horarios', 'Selecciona otro dia con horarios disponibles.');
      return;
    }
    if (!acceptedTerms) {
      Alert.alert('Terminos pendientes', 'Acepta la politica de puntualidad.');
      return;
    }
    const assignedEmployee = availableEmployeesForSlot(activeEmployees, appointments, services, selectedDate, selectedTime, effectiveDuration)[0];
    if (!assignedEmployee) {
      Alert.alert('Horario ocupado', 'Ese horario acaba de ocuparse. Selecciona otro disponible.');
      return;
    }

    const effectiveDepositPaymentMethod =
      automaticPaymentsEnabled || ['transfer', 'cash'].includes(depositPaymentMethod) ? depositPaymentMethod : 'transfer';

    try {
      const appointment = await createAppointment({
        organizationId: profile.organizationId,
        clientId: profile.id,
        clientName: profile.name,
        date: selectedDate,
        time: selectedTime,
        duration: effectiveDuration,
        serviceIds: selectedServiceIds,
        employeeId: assignedEmployee.id,
        note: clientNote.trim() || 'Sin nota.',
        deposit,
        requiresDeposit,
        depositPercent: requiresDeposit ? safeDepositPercent : 0,
        paymentMethod: requiresDeposit && deposit > 0 ? effectiveDepositPaymentMethod : 'none',
        requestedDepositPaymentMethod: requiresDeposit && deposit > 0 ? effectiveDepositPaymentMethod : 'none',
        total: selectedTotal,
        termsAccepted: true,
        source: 'client',
      });
      if (requiresDeposit && deposit > 0 && automaticPaymentsEnabled && !['transfer', 'cash'].includes(effectiveDepositPaymentMethod)) {
        const preference = await createDepositPreference(profile.organizationId, appointment.appointmentId);
        if (preference.checkoutUrl) {
          await Linking.openURL(preference.checkoutUrl);
        }
      }
      setSelectedServiceIds([]);
      setClientNote('');
      setAcceptedTerms(false);
      Alert.alert(
        'Cita solicitada',
        requiresDeposit
          ? automaticPaymentsEnabled && !['transfer', 'cash'].includes(effectiveDepositPaymentMethod)
            ? 'Se abrio Mercado Pago para completar el anticipo.'
            : effectiveDepositPaymentMethod === 'cash'
              ? 'Quedo pendiente hasta que el negocio confirme el anticipo en efectivo.'
              : 'Quedo pendiente hasta que el negocio confirme la transferencia o SPEI.'
          : 'Quedo pendiente de confirmacion.',
      );
    } catch (error) {
      Alert.alert('No se pudo guardar', readableFirebaseError(error));
    }
  }

  return (
    <ScrollView contentContainerStyle={[theme.styles.scrollContent, { backgroundColor: brandColors.background }]}>
      <View style={[theme.styles.heroCard, { backgroundColor: palette.primaryDark }]}>
        {appearance.logoUrl ? <Image source={{ uri: appearance.logoUrl }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: theme.colors.surface }} /> : null}
        <Text style={[theme.styles.eyebrow, { color: theme.colors.surface }]}>{appearance.displayName}</Text>
        <Text style={[theme.styles.screenTitle, { color: theme.colors.surface }]}>{appearance.tagline}</Text>
        <Text style={[theme.styles.mutedText, { color: 'rgba(255,255,255,0.82)' }]}>{appearance.welcomeMessage}</Text>
      </View>

      <Section title="Mis citas en tiempo real" icon="time-outline">
        {myAppointments.length ? (
          myAppointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              services={services}
              employees={employees}
              extraActions={
                canClientCancel(appointment) ? (
                  <View style={theme.styles.row}>
                    <SmallButton label="Cancelar cita" danger onPress={() => openCancelAppointment(appointment)} />
                  </View>
                ) : null
              }
            />
          ))
        ) : (
          <EmptyState text="Aun no tienes citas registradas." />
        )}
      </Section>

      <Section title="Avisos" icon="megaphone-outline">
        {announcements.filter((item) => item.active).length ? (
          announcements
            .filter((item) => item.active)
            .map((announcement) => (
              <View key={announcement.id} style={theme.styles.card}>
                <Text style={theme.styles.sectionTitle}>{announcement.title}</Text>
                <Text style={theme.styles.mutedText}>{announcement.body}</Text>
              </View>
            ))
        ) : (
          <EmptyState text="No hay avisos activos." />
        )}
      </Section>

      <Section title="Servicios" icon="sparkles-outline">
        {activeServices.length ? (
          activeServices.map((service) => {
            const selected = selectedServiceIds.includes(service.id);
            return (
              <Pressable
                key={service.id}
                style={[theme.styles.rowCard, selected && { borderColor: brandColors.primary, backgroundColor: brandColors.surfaceMuted }]}
                onPress={() => toggleService(service.id)}
              >
                <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? brandColors.primary : theme.colors.muted} />
                <View style={theme.styles.grow}>
                  <Text style={theme.styles.text}>{service.name}</Text>
                  <Text style={theme.styles.mutedText}>
                    ${service.price} MXN · {service.duration} min
                  </Text>
                </View>
              </Pressable>
            );
          })
        ) : (
          <EmptyState text="Esta organizacion aun no tiene servicios activos." />
        )}
      </Section>

      <Section title="Agenda" icon="calendar-outline">
        <View style={theme.styles.pillWrap}>
          {dates.map((date) => {
            const closed = dayNotes.some((day) => day.date === date && day.type === 'closed');
            const working = isWorkingDate(date, settings);
            return (
              <Pill
                key={date}
                label={!working ? `${dateLabel(date)} descanso` : closed ? `${dateLabel(date)} cerrado` : dateLabel(date)}
                active={selectedDate === date}
                disabled={!working || closed}
                onPress={() => setSelectedDate(date)}
              />
            );
          })}
        </View>
        {blockedDay ? <Text style={{ color: brandColors.accent, fontWeight: '800' }}>{blockedDay.note}</Text> : null}
        <View style={theme.styles.pillWrap}>
          {availableTimes.map((time) => {
            const available = availableTimes.includes(time);
            return <Pill key={time} label={available ? time : `${time} ocupado`} active={selectedTime === time} disabled={!available} onPress={() => setSelectedTime(time)} />;
          })}
        </View>
        {!availableTimes.length ? <EmptyState text="No hay horarios para la duracion de los servicios seleccionados." /> : null}
      </Section>

      <Section title="Apartar" icon="card-outline">
        <LabeledInput label="Nota para el negocio" style={theme.styles.textArea} placeholder="Ej. quiero corte bajo, o aviso que llego con nina" value={clientNote} onChangeText={setClientNote} multiline />
        <View style={theme.styles.card}>
          <Text style={theme.styles.mutedText}>Total estimado</Text>
          <Text style={theme.styles.screenTitle}>${selectedTotal} MXN</Text>
          {requiresDeposit ? (
            <Text style={theme.styles.mutedText}>
              Anticipo requerido ({safeDepositPercent}%): ${deposit} MXN
            </Text>
          ) : (
            <Text style={theme.styles.mutedText}>Este negocio no pide anticipo para apartar.</Text>
          )}
          <Text style={theme.styles.mutedText}>
            Duracion estimada: {effectiveDuration} min{selectedTime ? ` · Termina aprox: ${addMinutes(selectedTime, effectiveDuration)}` : ''}
          </Text>
        </View>
        {requiresDeposit ? (
          <View style={theme.styles.card}>
            <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Forma de pago del anticipo</Text>
            <Text style={theme.styles.mutedText}>
              {automaticPaymentsEnabled
                ? 'Mercado Pago, SPEI y OXXO se confirman por webhook cuando Mercado Pago acredite el pago.'
                : 'Por ahora el anticipo queda pendiente y el negocio lo confirma manualmente al recibir transferencia, SPEI o efectivo.'}
            </Text>
            <View style={theme.styles.pillWrap}>
              {automaticPaymentsEnabled ? (
                <>
                  <Pill label="Mercado Pago" active={depositPaymentMethod === 'mercado_pago'} onPress={() => setDepositPaymentMethod('mercado_pago')} />
                  <Pill label="SPEI automatico" active={depositPaymentMethod === 'spei'} onPress={() => setDepositPaymentMethod('spei')} />
                  <Pill label="OXXO Pay" active={depositPaymentMethod === 'oxxo'} onPress={() => setDepositPaymentMethod('oxxo')} />
                </>
              ) : null}
              <Pill label="Transferencia o SPEI" active={depositPaymentMethod === 'transfer'} onPress={() => setDepositPaymentMethod('transfer')} />
              <Pill label="Efectivo con el negocio" active={depositPaymentMethod === 'cash'} onPress={() => setDepositPaymentMethod('cash')} />
            </View>
            {depositPaymentMethod === 'transfer' || depositPaymentMethod === 'cash' || !automaticPaymentsEnabled ? (
              <Text style={theme.styles.mutedText}>
                Esta forma de pago no se confirma automaticamente. Admin o empleado debe marcar el anticipo como recibido.
              </Text>
            ) : null}
          </View>
        ) : null}
        <Pressable style={theme.styles.row} onPress={() => setAcceptedTerms(!acceptedTerms)}>
          <Ionicons name={acceptedTerms ? 'checkbox' : 'square-outline'} size={22} color={brandColors.primaryDark} />
          <Text style={[theme.styles.mutedText, theme.styles.grow]}>
            Acepto que si llego despues de {settings.toleranceMinutes} minutos de tolerancia, la cita puede marcarse como perdida. Si cancelo una cita con anticipo pagado, el anticipo no sera devuelto y no podre exigir el servicio de esa cita.
          </Text>
        </Pressable>
        <PrimaryButton
          icon={requiresDeposit ? 'card' : 'calendar'}
          label={requiresDeposit && automaticPaymentsEnabled ? 'Solicitar y pagar anticipo' : requiresDeposit ? 'Solicitar cita con anticipo pendiente' : 'Solicitar cita'}
          onPress={bookAppointment}
        />
      </Section>

      <CancelAppointmentModal
        appointment={cancelDraft}
        settings={settings}
        reason={cancelReason}
        setReason={setCancelReason}
        onClose={() => setCancelDraft(null)}
        onConfirm={cancelAppointment}
      />
    </ScrollView>
  );
}

function CancelAppointmentModal({
  appointment,
  settings,
  reason,
  setReason,
  onClose,
  onConfirm,
}: {
  appointment: Appointment | null;
  settings: BusinessSettings;
  reason: string;
  setReason: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const brandColors = useBrandColors();
  const isLate = appointment ? getCancellationTiming(appointment, settings.cancellationLimitHours) === 'late' : false;

  return (
    <Modal visible={!!appointment} transparent animationType="slide">
      <View style={theme.styles.modalShade}>
        {appointment ? (
          <View style={theme.styles.modalCard}>
            <Text style={theme.styles.title}>Cancelar cita</Text>
            <Text style={theme.styles.mutedText}>
              La cita quedara cancelada, pero no se borrara del historial.
            </Text>
            {isLate ? (
              <Text style={[theme.styles.text, { color: brandColors.accent }]}>
                Esta cancelacion ocurre dentro de las ultimas {settings.cancellationLimitHours} horas antes de la cita.
              </Text>
            ) : null}
            {appointment.deposit > 0 ? (
              <Text style={[theme.styles.text, { color: theme.colors.danger }]}>
                El anticipo de ${appointment.deposit} MXN no sera devuelto y no conserva derecho a exigir este servicio.
              </Text>
            ) : null}
            <LabeledInput
              label="Motivo de cancelacion"
              placeholder="Ej. no puedo asistir, tuve un imprevisto"
              style={theme.styles.textArea}
              value={reason}
              onChangeText={setReason}
              multiline
            />
            <View style={theme.styles.row}>
              <SmallButton label="Volver" onPress={onClose} />
              <SmallButton label="Confirmar cancelacion" danger onPress={onConfirm} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
