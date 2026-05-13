import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { createAppointment } from '../services/appointments';
import { readableFirebaseError } from '../services/errors';
import { theme } from '../theme';
import { useBrandColors } from '../theme-context';
import { Appointment, BusinessSettings, DayNote, Employee, Service } from '../types';
import { dateLabel, isWorkingDate, nextDates } from '../utils/dates';
import { addMinutes, availableEmployeesForSlot, availableTimeSlots, selectedServiceSummary } from '../utils/schedule';
import { EmptyState, LabeledInput, Pill, PrimaryButton, SmallButton } from './ui';

export function ManualAppointmentModal({
  visible,
  organizationId,
  services,
  employees,
  appointments,
  dayNotes,
  settings,
  forcedEmployeeId,
  onClose,
}: {
  visible: boolean;
  organizationId: string;
  services: Service[];
  employees: Employee[];
  appointments: Appointment[];
  dayNotes: DayNote[];
  settings: BusinessSettings;
  forcedEmployeeId?: string;
  onClose: () => void;
}) {
  const brandColors = useBrandColors();
  const dates = useMemo(() => nextDates(21), []);
  const activeServices = useMemo(() => services.filter((service) => service.active), [services]);
  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active && (!forcedEmployeeId || employee.id === forcedEmployeeId)),
    [employees, forcedEmployeeId],
  );
  const [clientName, setClientName] = useState('');
  const [note, setNote] = useState('');
  const [specialPrice, setSpecialPrice] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(forcedEmployeeId ?? '');
  const { total, duration } = selectedServiceSummary(selectedServiceIds, services);
  const finalTotal = specialPrice.trim() ? Number(specialPrice || 0) : total;
  const discountAmount = Math.max(0, total - finalTotal);
  const effectiveDuration = duration || settings.slotMinutes;
  const blockedDay = dayNotes.find((day) => day.date === selectedDate && day.type === 'closed');
  const isSelectedWorkingDay = isWorkingDate(selectedDate, settings);
  const timeOptions = useMemo(
    () => availableTimeSlots(settings, selectedDate, effectiveDuration, activeEmployees, appointments, services, forcedEmployeeId),
    [activeEmployees, appointments, effectiveDuration, forcedEmployeeId, selectedDate, services, settings],
  );
  const employeeOptions = useMemo(
    () => (selectedTime ? availableEmployeesForSlot(activeEmployees, appointments, services, selectedDate, selectedTime, effectiveDuration) : activeEmployees),
    [activeEmployees, appointments, effectiveDuration, selectedDate, selectedTime, services],
  );

  useEffect(() => {
    if (!visible) return;
    if (forcedEmployeeId) {
      setSelectedEmployeeId(forcedEmployeeId);
      return;
    }
    if (!employeeOptions.some((employee) => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(employeeOptions[0]?.id ?? '');
    }
  }, [employeeOptions, forcedEmployeeId, selectedEmployeeId, visible]);

  useEffect(() => {
    if (!timeOptions.includes(selectedTime)) {
      setSelectedTime(timeOptions[0] ?? '');
    }
  }, [selectedTime, timeOptions]);

  useEffect(() => {
    if (isSelectedWorkingDay && !blockedDay) return;
    const nextAvailableDate = dates.find((date) => isWorkingDate(date, settings) && !dayNotes.some((day) => day.date === date && day.type === 'closed'));
    if (nextAvailableDate) setSelectedDate(nextAvailableDate);
  }, [blockedDay, dates, dayNotes, isSelectedWorkingDay, settings]);

  function toggleService(serviceId: string) {
    setSelectedServiceIds((current) => (current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId]));
  }

  async function saveManualAppointment() {
    if (!clientName.trim()) {
      Alert.alert('Falta cliente', 'Agrega el nombre de la persona.');
      return;
    }
    if (!selectedServiceIds.length) {
      Alert.alert('Faltan servicios', 'Selecciona al menos un servicio.');
      return;
    }
    if (blockedDay) {
      Alert.alert('Dia cerrado', 'No se puede agendar en un dia marcado como descanso.');
      return;
    }
    if (!isSelectedWorkingDay) {
      Alert.alert('Dia no laboral', 'Selecciona un dia dentro del horario laboral del negocio.');
      return;
    }
    if (!selectedTime || !selectedEmployeeId) {
      Alert.alert('Sin disponibilidad', 'Selecciona un horario y empleado disponible.');
      return;
    }
    if (specialPrice.trim() && (Number.isNaN(finalTotal) || finalTotal < 0)) {
      Alert.alert('Precio invalido', 'El precio especial debe ser 0 o mayor.');
      return;
    }
    if (specialPrice.trim() && !discountReason.trim()) {
      Alert.alert('Falta motivo', 'Cuando admin o empleado aplica precio especial debe escribir el motivo.');
      return;
    }

    try {
      await createAppointment({
        organizationId,
        clientId: 'manual',
        clientName: clientName.trim(),
        date: selectedDate,
        time: selectedTime,
        duration: effectiveDuration,
        serviceIds: selectedServiceIds,
        employeeId: selectedEmployeeId,
        note: note.trim() || 'Cita creada manualmente en mostrador.',
        deposit: 0,
        requiresDeposit: false,
        depositPercent: 0,
        paymentMethod: 'cash',
        subtotal: total,
        specialPrice: specialPrice.trim() ? finalTotal : null,
        discountAmount,
        discountReason: discountReason.trim(),
        total: finalTotal,
        termsAccepted: true,
        source: 'manual',
      });
      setClientName('');
      setNote('');
      setSpecialPrice('');
      setDiscountReason('');
      setSelectedServiceIds([]);
      setSelectedTime('');
      onClose();
    } catch (error) {
      Alert.alert('No se pudo guardar', readableFirebaseError(error));
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={theme.styles.modalShade}>
        <View style={[theme.styles.modalCard, { maxHeight: '92%' }]}>
          <View style={theme.styles.rowBetween}>
            <View style={theme.styles.grow}>
              <Text style={theme.styles.title}>Agregar cita manual</Text>
              <Text style={theme.styles.mutedText}>Para clientes que llaman, llegan al negocio o no usan la app.</Text>
            </View>
            <SmallButton label="Cerrar" onPress={onClose} />
          </View>

          <ScrollView contentContainerStyle={{ gap: 12 }}>
            <LabeledInput label="Nombre del cliente" placeholder="Ej. Juan Perez" value={clientName} onChangeText={setClientName} />

            <Text style={theme.styles.sectionTitle}>Servicios</Text>
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
              <EmptyState text="Primero registra servicios activos." />
            )}

            <View style={theme.styles.card}>
              <Text style={theme.styles.mutedText}>Duracion total</Text>
              <Text style={theme.styles.screenTitle}>{effectiveDuration} min</Text>
              <Text style={theme.styles.mutedText}>Subtotal normal: ${total} MXN</Text>
              <Text style={theme.styles.sectionTitle}>Total a cobrar: ${finalTotal} MXN</Text>
              {discountAmount > 0 ? <Text style={theme.styles.mutedText}>Descuento especial: ${discountAmount} MXN</Text> : null}
              {selectedTime ? <Text style={theme.styles.mutedText}>Termina aprox: {addMinutes(selectedTime, effectiveDuration)}</Text> : null}
            </View>

            <Text style={theme.styles.sectionTitle}>Precio especial del personal</Text>
            <LabeledInput
              label="Total a cobrar"
              helper="Solo admin o empleado. El cliente no puede decidir este precio."
              placeholder="Total a cobrar, ej. 20 o 30"
              value={specialPrice}
              onChangeText={setSpecialPrice}
              keyboardType="numeric"
            />
            <LabeledInput
              label="Motivo del precio especial"
              helper="Obligatorio si se captura precio especial. Ej. familiar, cortesia, cliente frecuente."
              placeholder="Motivo, ej. familiar, cortesia, cliente frecuente"
              value={discountReason}
              onChangeText={setDiscountReason}
            />

            <Text style={theme.styles.sectionTitle}>Dia</Text>
            <View style={theme.styles.pillWrap}>
              {dates.map((date) => (
                <Pill
                  key={date}
                  label={!isWorkingDate(date, settings) ? `${dateLabel(date)} descanso` : dateLabel(date)}
                  active={selectedDate === date}
                  disabled={!isWorkingDate(date, settings) || dayNotes.some((day) => day.date === date && day.type === 'closed')}
                  onPress={() => setSelectedDate(date)}
                />
              ))}
            </View>
            {blockedDay ? <Text style={{ color: brandColors.accent, fontWeight: '800' }}>{blockedDay.note}</Text> : null}

            <Text style={theme.styles.sectionTitle}>Horario disponible</Text>
            <View style={theme.styles.pillWrap}>
              {timeOptions.map((time) => (
                <Pill key={time} label={time} active={selectedTime === time} onPress={() => setSelectedTime(time)} />
              ))}
            </View>
            {!timeOptions.length ? <EmptyState text="No hay horario disponible para la duracion seleccionada." /> : null}

            {!forcedEmployeeId ? (
              <>
                <Text style={theme.styles.sectionTitle}>Empleado</Text>
                <View style={theme.styles.pillWrap}>
                  {employeeOptions.map((employee) => (
                    <Pill key={employee.id} label={employee.name} active={selectedEmployeeId === employee.id} onPress={() => setSelectedEmployeeId(employee.id)} />
                  ))}
                </View>
              </>
            ) : null}

            <LabeledInput label="Nota de la cita" style={theme.styles.textArea} placeholder="Solicitud del cliente o nota interna" value={note} onChangeText={setNote} multiline />
            <PrimaryButton icon="calendar" label="Guardar cita manual" onPress={saveManualAppointment} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
