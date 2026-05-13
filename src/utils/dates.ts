import { BusinessSettings } from '../types';

export const weekDays = [
  { id: 0, short: 'Dom', label: 'Domingo' },
  { id: 1, short: 'Lun', label: 'Lunes' },
  { id: 2, short: 'Mar', label: 'Martes' },
  { id: 3, short: 'Mie', label: 'Miercoles' },
  { id: 4, short: 'Jue', label: 'Jueves' },
  { id: 5, short: 'Vie', label: 'Viernes' },
  { id: 6, short: 'Sab', label: 'Sabado' },
];

export function toDateId(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function nextDates(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return toDateId(date);
  });
}

export function buildTimeSlots(settings: BusinessSettings) {
  const start = parseTime(settings.businessStart);
  const end = parseTime(settings.businessEnd);
  const interval = Math.max(15, Number(settings.slotMinutes || 60));
  const slots: string[] = [];

  for (let current = start; current < end; current += interval) {
    slots.push(formatMinutes(current));
  }

  return slots;
}

export function isWorkingDate(dateId: string, settings: BusinessSettings) {
  const day = dayOfWeek(dateId);
  return (settings.workingDays?.length ? settings.workingDays : [1, 2, 3, 4, 5, 6]).includes(day);
}

export function dayOfWeek(dateId: string) {
  const [year, month, day] = dateId.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

export function dateLabel(dateId: string) {
  const day = weekDays[dayOfWeek(dateId)]?.short ?? '';
  return `${day} ${dateId}`;
}

export function monthTitle(year: number, monthIndex: number) {
  const formatter = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
  return formatter.format(new Date(year, monthIndex, 1));
}

export function monthMatrix(year: number, monthIndex: number) {
  const firstDay = new Date(year, monthIndex, 1);
  const start = new Date(year, monthIndex, 1 - firstDay.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      dateId: toDateId(date),
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      weekDay: date.getDay(),
    };
  });
}

function parseTime(value: string) {
  const [hours = '9', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
