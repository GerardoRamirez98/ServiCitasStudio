import { useCallback, useEffect, useState } from 'react';
import { apiAssetUrl, apiOrganizationBootstrap } from '../services/api';
import { subscribeToOrganizationDataChanges } from '../services/dataEvents';
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

function parseJson<T>(value: unknown, fallback: T) {
  try {
    return value ? JSON.parse(String(value)) as T : fallback;
  } catch {
    return fallback;
  }
}

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

  const loadOrganizationData = useCallback(async (mounted: () => boolean) => {
    if (!organizationId) return;
    setError(null);

    await apiOrganizationBootstrap(organizationId)
      .then((data) => {
        if (!mounted()) return;
        const org = data.organization;
        const address = parseJson(org?.AddressJson, undefined);
        setOrganization(
          org
            ? {
                id: String(org.Id),
                name: String(org.Name),
                ownerId: String(org.OwnerId),
                publicCode: org.PublicCode ? String(org.PublicCode) : undefined,
                slug: org.Slug ? String(org.Slug) : undefined,
                address,
              }
            : null,
        );
        setServices(
          data.services.map((item) => ({
            id: String(item.Id),
            name: String(item.Name),
            price: Number(item.Price ?? 0),
            duration: Number(item.Duration ?? 0),
            active: Boolean(item.Active),
            categoryId: item.CategoryId ? String(item.CategoryId) : undefined,
          })),
        );
        setEmployees(
          data.employees.map((item) => ({
            id: String(item.Id),
            userId: item.UserId ? String(item.UserId) : undefined,
            name: String(item.Name),
            email: item.Email ? String(item.Email) : undefined,
            role: String(item.Role),
            active: Boolean(item.Active),
            inviteCode: item.InviteCode ? String(item.InviteCode) : undefined,
            compensationMode: item.CompensationMode ? String(item.CompensationMode) as Employee['compensationMode'] : undefined,
            fixedSalary: Number(item.FixedSalary ?? 0),
            commissionPercent: Number(item.CommissionPercent ?? 0),
          })),
        );
        setAppointments(
          data.appointments.map((item) => ({
            id: String(item.Id),
            clientId: String(item.ClientId),
            clientName: String(item.ClientName),
            date: String(item.AppointmentDate).slice(0, 10),
            time: String(item.AppointmentTime).slice(0, 5),
            duration: Number(item.Duration ?? 60),
            serviceIds: parseJson<string[]>(item.ServiceIdsJson, []),
            employeeId: String(item.EmployeeId),
            status: String(item.Status) as Appointment['status'],
            note: String(item.Note ?? ''),
            deposit: Number(item.Deposit ?? 0),
            requiresDeposit: Boolean(item.RequiresDeposit),
            depositPercent: Number(item.DepositPercent ?? 0),
            paymentStatus: item.PaymentStatus ? String(item.PaymentStatus) as Appointment['paymentStatus'] : undefined,
            paymentMethod: item.PaymentMethod ? String(item.PaymentMethod) as Appointment['paymentMethod'] : undefined,
            paymentProvider: item.PaymentProvider ? String(item.PaymentProvider) as Appointment['paymentProvider'] : undefined,
            requestedDepositPaymentMethod: item.RequestedDepositPaymentMethod ? String(item.RequestedDepositPaymentMethod) as Appointment['requestedDepositPaymentMethod'] : undefined,
            paymentReference: item.PaymentReference ? String(item.PaymentReference) : undefined,
            paymentStatusDetail: item.PaymentStatusDetail ? String(item.PaymentStatusDetail) : undefined,
            delayNotice: item.DelayNotice ? String(item.DelayNotice) : undefined,
            delayMinutes: item.DelayMinutes == null ? undefined : Number(item.DelayMinutes),
            cancelledAt: item.CancelledAt,
            cancelledBy: item.CancelledBy ? String(item.CancelledBy) as Appointment['cancelledBy'] : undefined,
            cancellationReason: item.CancellationReason ? String(item.CancellationReason) : undefined,
            cancellationTiming: item.CancellationTiming ? String(item.CancellationTiming) as Appointment['cancellationTiming'] : undefined,
            refundStatus: item.RefundStatus ? String(item.RefundStatus) as Appointment['refundStatus'] : undefined,
            serviceRightForfeited: item.ServiceRightForfeited == null ? undefined : Boolean(item.ServiceRightForfeited),
            servicePaymentMethod: item.ServicePaymentMethod ? String(item.ServicePaymentMethod) as Appointment['servicePaymentMethod'] : undefined,
            servicePaymentStatus: item.ServicePaymentStatus ? String(item.ServicePaymentStatus) as Appointment['servicePaymentStatus'] : undefined,
            servicePaidAt: item.ServicePaidAt,
            subtotal: Number(item.Subtotal ?? 0),
            discountAmount: Number(item.DiscountAmount ?? 0),
            specialPrice: item.SpecialPrice == null ? undefined : Number(item.SpecialPrice),
            discountReason: item.DiscountReason ? String(item.DiscountReason) : undefined,
            total: Number(item.Total ?? 0),
            termsAccepted: Boolean(item.TermsAccepted),
            source: item.Source ? String(item.Source) as Appointment['source'] : undefined,
          })),
        );
        setDayNotes(data.dayNotes.map((item) => ({ id: String(item.Id), date: String(item.NoteDate).slice(0, 10), type: String(item.Type) as DayNote['type'], note: String(item.Note) })));
        setAnnouncements(data.announcements.map((item) => ({ id: String(item.Id), title: String(item.Title), body: String(item.Body), active: Boolean(item.Active) })));
        const apiSettings = data.settings;
        if (apiSettings) {
          setSettings({
            requireDeposit: Boolean(apiSettings.RequireDeposit),
            depositPercent: Number(apiSettings.DepositPercent ?? 30),
            toleranceMinutes: Number(apiSettings.ToleranceMinutes ?? 10),
            cancellationLimitHours: Number(apiSettings.CancellationLimitHours ?? 24),
            businessStart: String(apiSettings.BusinessStart ?? '09:00').slice(0, 5),
            businessEnd: String(apiSettings.BusinessEnd ?? '18:00').slice(0, 5),
            breakEnabled: Boolean(apiSettings.BreakEnabled),
            breakStart: String(apiSettings.BreakStart ?? '14:00').slice(0, 5),
            breakEnd: String(apiSettings.BreakEnd ?? '15:00').slice(0, 5),
            slotMinutes: Number(apiSettings.SlotMinutes ?? 60),
            workingDays: parseJson<number[]>(apiSettings.WorkingDaysJson, [1, 2, 3, 4, 5, 6]),
          });
        }
        const apiAppearance = data.appearance;
        if (apiAppearance) {
          setAppearance({
            preset: String(apiAppearance.Preset ?? 'studio') as AppearanceSettings['preset'],
            displayName: String(apiAppearance.DisplayName ?? defaultAppearance.displayName),
            tagline: String(apiAppearance.Tagline ?? defaultAppearance.tagline),
            welcomeMessage: String(apiAppearance.WelcomeMessage ?? defaultAppearance.welcomeMessage),
            logoUrl: apiAssetUrl(apiAppearance.LogoUrl ? String(apiAppearance.LogoUrl) : undefined),
          });
        }
      })
      .catch((apiError) => {
        if (mounted()) setError(apiError instanceof Error ? apiError.message : 'No se pudo cargar la informacion.');
      });
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return undefined;
    let mounted = true;
    const isMounted = () => mounted;
    loadOrganizationData(isMounted);
    const unsubscribe = subscribeToOrganizationDataChanges(() => loadOrganizationData(isMounted));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [loadOrganizationData, organizationId]);

  return { organization, services, employees, appointments, dayNotes, announcements, settings, appearance, mercadoPagoConnection, error, refetch: () => loadOrganizationData(() => true) };
}
