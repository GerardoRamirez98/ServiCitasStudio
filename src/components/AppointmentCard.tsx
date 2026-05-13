import { Text, View } from 'react-native';
import { theme } from '../theme';
import { useBrandColors } from '../theme-context';
import { Appointment, AppointmentStatus, Employee, Service } from '../types';
import { SmallButton, StatusBadge } from './ui';

export function AppointmentCard({
  appointment,
  services,
  employees,
  onStatus,
  onCompletePayment,
  extraActions,
}: {
  appointment: Appointment;
  services: Service[];
  employees: Employee[];
  onStatus?: (status: AppointmentStatus) => void;
  onCompletePayment?: (method: 'cash' | 'transfer') => void;
  extraActions?: React.ReactNode;
}) {
  const brandColors = useBrandColors();
  const names = appointment.serviceIds
    .map((id) => services.find((service) => service.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  const employee = employees.find((item) => item.id === appointment.employeeId)?.name || 'Sin asignar';
  const paymentLabel = {
    not_required: 'sin anticipo',
    pending: 'anticipo pendiente',
    paid: 'pagado',
    offline: 'pago en local',
    refunded: 'reembolsado',
  }[appointment.paymentStatus ?? (appointment.deposit > 0 ? 'pending' : 'not_required')];

  return (
    <View style={theme.styles.card}>
      <View style={theme.styles.rowBetween}>
        <View style={theme.styles.grow}>
          <Text style={theme.styles.sectionTitle}>{appointment.clientName}</Text>
          <Text style={theme.styles.mutedText}>
            {appointment.date} · {appointment.time}
          </Text>
        </View>
        <StatusBadge status={appointment.status} />
      </View>
      <Text style={theme.styles.text}>{names || 'Servicios no encontrados'}</Text>
      <Text style={theme.styles.mutedText}>Empleado: {employee}</Text>
      <Text style={theme.styles.mutedText}>Total: ${appointment.total} · {paymentLabel}</Text>
      {appointment.requiresDeposit || appointment.deposit > 0 ? (
        <Text style={theme.styles.mutedText}>
          Anticipo: ${appointment.deposit}
          {appointment.depositPercent ? ` · ${appointment.depositPercent}%` : ''}
        </Text>
      ) : null}
      {appointment.discountAmount ? (
        <Text style={theme.styles.mutedText}>
          Precio normal: ${appointment.subtotal ?? appointment.total + appointment.discountAmount} · Descuento especial: ${appointment.discountAmount}
          {appointment.discountReason ? ` · ${appointment.discountReason}` : ''}
        </Text>
      ) : null}
      {appointment.status === 'cancelled' ? (
        <View style={{ gap: 6 }}>
          <Text style={[theme.styles.text, { color: theme.colors.danger }]}>Cancelada: {appointment.cancellationReason || 'Sin motivo registrado.'}</Text>
          {appointment.refundStatus === 'non_refundable' ? (
            <Text style={theme.styles.mutedText}>Anticipo no reembolsable. Sin derecho a exigir el servicio de esta cita.</Text>
          ) : null}
        </View>
      ) : null}
      {appointment.duration ? <Text style={theme.styles.mutedText}>Duracion: {appointment.duration} min{appointment.endTime ? ` · Termina aprox: ${appointment.endTime}` : ''}</Text> : null}
      <Text style={[theme.styles.text, { backgroundColor: brandColors.surfaceMuted, padding: 10, borderRadius: 8 }]}>{appointment.note}</Text>
      {appointment.delayNotice ? (
        <Text style={[theme.styles.text, { borderColor: brandColors.accent, borderWidth: 1, padding: 10, borderRadius: 8 }]}>
          {appointment.delayNotice}
        </Text>
      ) : null}
      {onStatus ? (
        <View style={theme.styles.row}>
          <SmallButton label="Aceptar" onPress={() => onStatus('confirmed')} />
          <SmallButton label="En espera" onPress={() => onStatus('waiting')} />
          <SmallButton label="Atender" onPress={() => onStatus('in_service')} />
          {onCompletePayment ? (
            <>
              <SmallButton label="Terminar contado" onPress={() => onCompletePayment('cash')} />
              <SmallButton label="Terminar transferencia" onPress={() => onCompletePayment('transfer')} />
            </>
          ) : (
            <SmallButton label="Terminar" onPress={() => onStatus('completed')} />
          )}
          <SmallButton label="Perdida" onPress={() => onStatus('lost')} danger />
        </View>
      ) : null}
      {extraActions}
    </View>
  );
}
