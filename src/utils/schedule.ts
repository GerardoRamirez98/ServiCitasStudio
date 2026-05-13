import { Appointment, Employee, Service } from '../types';
import { buildTimeSlots, isWorkingDate } from './dates';

type ScheduleSettings = Parameters<typeof buildTimeSlots>[0];

export function selectedServiceSummary(serviceIds: string[], services: Service[]) {
  const selected = services.filter((service) => serviceIds.includes(service.id));
  return {
    selected,
    total: selected.reduce((sum, service) => sum + Number(service.price || 0), 0),
    duration: selected.reduce((sum, service) => sum + Number(service.duration || 0), 0),
  };
}

export function addMinutes(time: string, minutesToAdd: number) {
  return formatMinutes(parseTime(time) + minutesToAdd);
}

export function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  return `${minutes} min`;
}

export function appointmentDuration(appointment: Appointment, services: Service[]) {
  if (appointment.duration) return appointment.duration;
  return selectedServiceSummary(appointment.serviceIds, services).duration || 60;
}

export function hasScheduleConflict(
  appointments: Appointment[],
  services: Service[],
  employeeId: string,
  date: string,
  startTime: string,
  duration: number,
  ignoreAppointmentId?: string,
) {
  const start = parseTime(startTime);
  const end = start + duration;

  return appointments.some((appointment) => {
    if (appointment.id === ignoreAppointmentId) return false;
    if (appointment.employeeId !== employeeId || appointment.date !== date) return false;
    if (['completed', 'lost', 'cancelled'].includes(appointment.status)) return false;

    const appointmentStart = parseTime(appointment.time);
    const appointmentEnd = appointmentStart + appointmentDuration(appointment, services);
    return start < appointmentEnd && end > appointmentStart;
  });
}

export function employeeIsAvailable(
  employeeId: string,
  date: string,
  time: string,
  duration: number,
  appointments: Appointment[],
  services: Service[],
  ignoreAppointmentId?: string,
) {
  return !hasScheduleConflict(appointments, services, employeeId, date, time, duration, ignoreAppointmentId);
}

export function availableTimeSlots(
  settings: ScheduleSettings,
  date: string,
  duration: number,
  employees: Employee[],
  appointments: Appointment[],
  services: Service[],
  forcedEmployeeId?: string,
) {
  if (!isWorkingDate(date, settings)) return [];
  const closeTime = parseTime(settings.businessEnd);
  const activeEmployees = employees.filter((employee) => employee.active && (!forcedEmployeeId || employee.id === forcedEmployeeId));
  return buildTimeSlots(settings).filter((time) => {
    const slotStart = parseTime(time);
    const slotEnd = slotStart + duration;
    if (!activeEmployees.length) return false;
    if (slotEnd > closeTime) return false;
    if (settings.breakEnabled) {
      const breakStart = parseTime(settings.breakStart);
      const breakEnd = parseTime(settings.breakEnd);
      if (breakStart < breakEnd && slotStart < breakEnd && slotEnd > breakStart) return false;
    }
    return activeEmployees.some((employee) => employeeIsAvailable(employee.id, date, time, duration, appointments, services));
  });
}

export function availableEmployeesForSlot(
  employees: Employee[],
  appointments: Appointment[],
  services: Service[],
  date: string,
  time: string,
  duration: number,
  ignoreAppointmentId?: string,
) {
  return employees.filter(
    (employee) => employee.active && employeeIsAvailable(employee.id, date, time, duration, appointments, services, ignoreAppointmentId),
  );
}

function parseTime(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
