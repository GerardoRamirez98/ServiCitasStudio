import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AppointmentCard } from '../components/AppointmentCard';
import { ManualAppointmentModal } from '../components/ManualAppointmentModal';
import { EmptyState, PrimaryButton, Section, SmallButton } from '../components/ui';
import { useOrganizationData } from '../hooks/useOrganizationData';
import { apiPatch } from '../services/api';
import { theme } from '../theme';
import { useBrandColors } from '../theme-context';
import { Appointment, UserProfile } from '../types';

export function EmployeeScreen({ profile }: { profile: UserProfile }) {
  const { organization, services, employees, appointments, dayNotes, settings, announcements, employeeBlocks } = useOrganizationData(profile.organizationId);
  const brandColors = useBrandColors();
  const [manualAppointmentOpen, setManualAppointmentOpen] = useState(false);
  const employee = employees.find((item) => item.userId === profile.id || item.id === profile.employeeId || item.email === profile.email);
  const visibleAppointments = appointments.filter(
    (appointment) => appointment.employeeId === employee?.id && !['completed', 'lost', 'cancelled'].includes(appointment.status),
  );
  const pendingCount = visibleAppointments.filter((appointment) => appointment.status === 'pending').length;
  const waitingCount = visibleAppointments.filter((appointment) => appointment.status === 'waiting').length;
  const completedAppointments = appointments.filter((appointment) => appointment.employeeId === employee?.id && appointment.status === 'completed');
  const generated = completedAppointments.reduce((sum, appointment) => sum + Number(appointment.total || 0), 0);
  const commission = Math.round((generated * Number(employee?.commissionPercent || 0)) / 100);

  async function updateAppointment(appointment: Appointment, payload: Partial<Appointment>) {
    await apiPatch(`/organizations/${profile.organizationId}/appointments/${appointment.id}`, payload);
  }

  async function markDepositReceived(appointment: Appointment, method: 'cash' | 'transfer') {
    await updateAppointment(appointment, {
      status: appointment.status === 'pending' ? 'confirmed' : appointment.status,
      paymentStatus: 'paid',
      paymentMethod: method,
      paymentProvider: 'none',
      paymentStatusDetail: method === 'cash' ? 'Anticipo recibido en efectivo.' : 'Anticipo recibido por transferencia/SPEI.',
      paymentReference: `Confirmado manualmente por empleado - ${new Date().toISOString()}`,
    });
  }

  return (
    <ScrollView contentContainerStyle={[theme.styles.scrollContent, { backgroundColor: brandColors.background }]}>
      {employee ? (
        <View style={theme.styles.card}>
          <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Turno de trabajo</Text>
          <View style={theme.styles.statGrid}>
            <View style={theme.styles.statCard}>
              <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Activas</Text>
              <Text style={[theme.styles.statValue, { color: brandColors.primaryDark }]}>{visibleAppointments.length}</Text>
              <Text style={theme.styles.mutedText}>por atender</Text>
            </View>
            <View style={theme.styles.statCard}>
              <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Pendientes</Text>
              <Text style={[theme.styles.statValue, { color: brandColors.primaryDark }]}>{pendingCount}</Text>
              <Text style={theme.styles.mutedText}>por confirmar</Text>
            </View>
            <View style={theme.styles.statCard}>
              <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Espera</Text>
              <Text style={[theme.styles.statValue, { color: brandColors.primaryDark }]}>{waitingCount}</Text>
              <Text style={theme.styles.mutedText}>con demora</Text>
            </View>
            <View style={theme.styles.statCard}>
              <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Atendidos</Text>
              <Text style={[theme.styles.statValue, { color: brandColors.primaryDark }]}>{completedAppointments.length}</Text>
              <Text style={theme.styles.mutedText}>destajo ${commission}</Text>
            </View>
          </View>
        </View>
      ) : null}
      <View style={theme.styles.card}>
        <Text style={[theme.styles.eyebrow, { color: brandColors.primary }]}>Codigo para clientes</Text>
        <Text style={theme.styles.screenTitle}>{organization?.publicCode ?? 'Generando...'}</Text>
        <Text style={theme.styles.mutedText}>Comparte este codigo con clientes para que entren al negocio y agenden.</Text>
      </View>
      <Section title="Avisos internos" icon="megaphone-outline">
        {announcements.filter((item) => item.active && (item.audience === 'employees' || item.audience === 'all')).length ? (
          announcements
            .filter((item) => item.active && (item.audience === 'employees' || item.audience === 'all'))
            .map((announcement) => (
              <View key={announcement.id} style={theme.styles.card}>
                <Text style={theme.styles.sectionTitle}>{announcement.title}</Text>
                <Text style={theme.styles.mutedText}>{announcement.body}</Text>
              </View>
            ))
        ) : (
          <EmptyState text="No hay avisos internos activos." />
        )}
      </Section>
      <Section title="Mis citas" icon="id-card-outline">
        {!employee ? (
          <View style={theme.styles.card}>
            <Text style={theme.styles.sectionTitle}>Empleado no vinculado</Text>
            <Text style={theme.styles.mutedText}>Pide al administrador que registre tu correo en empleados o que revise tu cuenta.</Text>
          </View>
        ) : visibleAppointments.length ? (
          <>
            <PrimaryButton icon="add-circle" label="Agregar cita manual" onPress={() => setManualAppointmentOpen(true)} />
            {visibleAppointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                services={services}
                employees={employees}
                onStatus={(status) => updateAppointment(appointment, { status })}
                onCompletePayment={(method) =>
                  updateAppointment(appointment, {
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
                          updateAppointment(appointment, {
                            status: 'waiting',
                            delayMinutes: 10,
                            delayNotice: 'Estoy atendiendo a otro cliente. Te pido una disculpa por la demora, en breve te atiendo.',
                          })
                        }
                      />
                    </View>
                  </View>
                }
              />
            ))}
          </>
        ) : (
          <>
            <PrimaryButton icon="add-circle" label="Agregar cita manual" onPress={() => setManualAppointmentOpen(true)} />
            <EmptyState text="No tienes citas asignadas." />
          </>
        )}
      </Section>
      {employee ? (
        <ManualAppointmentModal
          visible={manualAppointmentOpen}
          organizationId={profile.organizationId}
          services={services}
          employees={employees}
          appointments={appointments}
          dayNotes={dayNotes}
          employeeBlocks={employeeBlocks}
          settings={settings}
          forcedEmployeeId={employee.id}
          onClose={() => setManualAppointmentOpen(false)}
        />
      ) : null}
    </ScrollView>
  );
}
