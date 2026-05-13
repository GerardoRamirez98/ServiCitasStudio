import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { orgPath } from '../services/paths';
import { defaultAppearance } from '../theme';
import { Announcement, AppearanceSettings, Appointment, BusinessSettings, DayNote, Employee, MercadoPagoConnectionStatus, Organization, Service } from '../types';

export const defaultSettings: BusinessSettings = {
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
};

export function useOrganizationData(organizationId: string) {
  const [services, setServices] = useState<Service[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [appearance, setAppearance] = useState(defaultAppearance);
  const [mercadoPagoConnection, setMercadoPagoConnection] = useState<MercadoPagoConnectionStatus>({ connected: false });
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return undefined;
    setError(null);

    const unsubscribers = [
      onSnapshot(doc(db, 'organizations', organizationId), (snapshot) => {
        setOrganization(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Organization) : null);
      }, (snapshotError) => setError(snapshotError.message)),
      onSnapshot(query(collection(db, orgPath(organizationId, 'services')), orderBy('name')), (snapshot) => {
        setServices(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Service));
      }, (snapshotError) => setError(snapshotError.message)),
      onSnapshot(query(collection(db, orgPath(organizationId, 'employees')), orderBy('name')), (snapshot) => {
        setEmployees(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Employee));
      }, (snapshotError) => setError(snapshotError.message)),
      onSnapshot(query(collection(db, orgPath(organizationId, 'appointments')), orderBy('date', 'desc'), limit(1000)), (snapshot) => {
        setAppointments(
          snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }) as Appointment)
            .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
        );
      }, (snapshotError) => setError(snapshotError.message)),
      onSnapshot(query(collection(db, orgPath(organizationId, 'dayNotes')), orderBy('date')), (snapshot) => {
        setDayNotes(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as DayNote));
      }, (snapshotError) => setError(snapshotError.message)),
      onSnapshot(query(collection(db, orgPath(organizationId, 'announcements')), orderBy('title')), (snapshot) => {
        setAnnouncements(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Announcement));
      }, (snapshotError) => setError(snapshotError.message)),
      onSnapshot(doc(db, 'organizations', organizationId, 'settings', 'business'), (snapshot) => {
        setSettings({ ...defaultSettings, ...(snapshot.data() as Partial<BusinessSettings> | undefined) });
      }, (snapshotError) => setError(snapshotError.message)),
      onSnapshot(doc(db, 'organizations', organizationId, 'settings', 'appearance'), (snapshot) => {
        setAppearance({ ...defaultAppearance, ...(snapshot.data() as Partial<AppearanceSettings> | undefined) });
      }, (snapshotError) => setError(snapshotError.message)),
      onSnapshot(doc(db, 'organizations', organizationId, 'paymentConnections', 'mercadopago'), (snapshot) => {
        setMercadoPagoConnection(snapshot.exists() ? ({ connected: false, ...snapshot.data() } as MercadoPagoConnectionStatus) : { connected: false });
      }, (snapshotError) => setError(snapshotError.message)),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [organizationId]);

  return { organization, services, employees, appointments, dayNotes, announcements, settings, appearance, mercadoPagoConnection, error };
}
