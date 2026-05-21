import { Appointment, Employee, EmployeeBlock, Service } from '../types';
import { buildTimeSlots, dayOfWeek, isWorkingDate } from './dates';

type ScheduleSettings = Parameters<typeof buildTimeSlots>[0];

export function selectedServiceSummary(serviceIds: string[], services: Service[]) {
  const selected = services.filter((service) => serviceIds.includes(service.id));
  return {
    selected,
    total: selected.reduce((sum, service) => sum + Number(service.price || 0), 0),
    duration: selected.reduce((sum, service) => sum + Number(service.duration || 0), 0),
  };
}

export function serviceDurationForEmployee(service: Service, employeeId?: string) {
  if (employeeId && service.employeeDurations?.[employeeId]) return Number(service.employeeDurations[employeeId]);
  return Number(service.duration || 0);
}

export function selectedServiceSummaryForEmployee(serviceIds: string[], services: Service[], employeeId?: string) {
  const selected = services.filter((service) => serviceIds.includes(service.id));
  return {
    selected,
    total: selected.reduce((sum, service) => sum + Number(service.price || 0), 0),
    duration: selected.reduce((sum, service) => sum + serviceDurationForEmployee(service, employeeId), 0),
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
  employeeBlocks: EmployeeBlock[] = [],
) {
  const start = parseTime(startTime);
  const end = start + duration;
  const blocked = employeeBlocks.some((block) => {
    if (block.employeeId !== employeeId || block.date !== date) return false;
    const blockStart = parseTime(block.startsAt);
    const blockEnd = parseTime(block.endsAt);
    return start < blockEnd && end > blockStart;
  });
  if (blocked) return true;

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
  employeeBlocks: EmployeeBlock[] = [],
) {
  return !hasScheduleConflict(appointments, services, employeeId, date, time, duration, ignoreAppointmentId, employeeBlocks);
}

export function availableTimeSlots(
  settings: ScheduleSettings,
  date: string,
  duration: number,
  employees: Employee[],
  appointments: Appointment[],
  services: Service[],
  forcedEmployeeId?: string,
  employeeBlocks: EmployeeBlock[] = [],
) {
  if (!isWorkingDate(date, settings)) return [];
  const activeEmployees = employees.filter((employee) => employee.active && (!forcedEmployeeId || employee.id === forcedEmployeeId));
  const employeeSlots = new Set(activeEmployees.flatMap((employee) => buildEmployeeTimeSlots(settings, employee, date)));
  return [...employeeSlots].sort().filter((time) => {
    const slotStart = parseTime(time);
    if (!activeEmployees.length) return false;
    return activeEmployees.some((employee) => employeeCanTakeSlot(settings, employee, date, slotStart, duration) && employeeIsAvailable(employee.id, date, time, duration, appointments, services, undefined, employeeBlocks));
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
  employeeBlocks: EmployeeBlock[] = [],
  settings?: ScheduleSettings,
) {
  return employees.filter(
    (employee) =>
      employee.active &&
      (!settings || employeeCanTakeSlot(settings, employee, date, parseTime(time), duration)) &&
      employeeIsAvailable(employee.id, date, time, duration, appointments, services, ignoreAppointmentId, employeeBlocks),
  );
}

export function employeeCanTakeSlot(settings: ScheduleSettings, employee: Employee, date: string, slotStart: number, duration: number) {
  const day = String(dayOfWeek(date));
  const override = employee.scheduleOverrides?.[day];
  if (override?.enabled === false) return false;
  const start = parseTime(override?.start || settings.businessStart);
  const end = parseTime(override?.end || settings.businessEnd);
  const slotEnd = slotStart + duration;
  if (slotStart < start || slotEnd > end) return false;
  const breakStart = parseTime(override?.breakStart || settings.breakStart);
  const breakEnd = parseTime(override?.breakEnd || settings.breakEnd);
  const usesBreak = Boolean(override?.breakStart && override?.breakEnd) || settings.breakEnabled;
  return !(usesBreak && breakStart < breakEnd && slotStart < breakEnd && slotEnd > breakStart);
}

function buildEmployeeTimeSlots(settings: ScheduleSettings, employee: Employee, date: string) {
  const day = String(dayOfWeek(date));
  const override = employee.scheduleOverrides?.[day];
  if (override?.enabled === false) return [];
  if (!override) return buildTimeSlots(settings);
  return buildTimeSlots({ ...settings, businessStart: override.start || settings.businessStart, businessEnd: override.end || settings.businessEnd });
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
