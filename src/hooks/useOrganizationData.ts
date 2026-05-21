import { useCallback, useEffect, useState } from 'react';
import { apiAssetUrl, apiOrganizationBootstrap } from '../services/api';
import { subscribeToOrganizationDataChanges } from '../services/dataEvents';
import { defaultAppearance } from '../theme';
import { AuditLog, Announcement, AppearanceSettings, Appointment, BusinessSettings, ClientHistory, DayNote, Employee, EmployeeBlock, MercadoPagoConnectionStatus, Organization, PortfolioItem, Promotion, Service, ServiceCategory } from '../types';

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
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [clientHistories, setClientHistories] = useState<ClientHistory[]>([]);
  const [employeeBlocks, setEmployeeBlocks] = useState<EmployeeBlock[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
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
            employeeDurations: parseJson<Record<string, number>>(item.EmployeeDurationsJson, {}),
          })),
        );
        setServiceCategories(
          (data.serviceCategories ?? []).map((item) => ({
            id: String(item.Id),
            name: String(item.Name),
            slug: String(item.Slug ?? ''),
            active: Boolean(item.Active),
            sortOrder: Number(item.SortOrder ?? 0),
          })),
        );
        setEmployees(
          data.employees.map((item) => ({
            id: String(item.Id),
            userId: item.UserId ? String(item.UserId) : undefined,
            name: String(item.Name),
            email: item.Email ? String(item.Email) : undefined,
            role: String(item.Role),
            specialties: parseJson<string[]>(item.SpecialtiesJson, []),
            active: Boolean(item.Active),
            inviteCode: item.InviteCode ? String(item.InviteCode) : undefined,
            compensationMode: item.CompensationMode ? String(item.CompensationMode) as Employee['compensationMode'] : undefined,
            fixedSalary: Number(item.FixedSalary ?? 0),
            commissionPercent: Number(item.CommissionPercent ?? 0),
            serviceDurations: parseJson<Record<string, number>>(item.ServiceDurationsJson, {}),
            scheduleOverrides: parseJson<Employee['scheduleOverrides']>(item.ScheduleOverridesJson, {}),
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
        setAnnouncements(data.announcements.map((item) => ({ id: String(item.Id), title: String(item.Title), body: String(item.Body), audience: item.Audience ? String(item.Audience) as Announcement['audience'] : 'all', active: Boolean(item.Active) })));
        setPortfolioItems(
          (data.portfolioItems ?? []).map((item) => ({
            id: String(item.Id),
            title: String(item.Title),
            description: item.Description ? String(item.Description) : undefined,
            categoryId: item.CategoryId ? String(item.CategoryId) : undefined,
            employeeId: item.EmployeeId ? String(item.EmployeeId) : undefined,
            imageUrl: apiAssetUrl(String(item.ImageUrl ?? '')) ?? '',
            active: Boolean(item.Active),
            createdAt: item.CreatedAt,
          })),
        );
        setPromotions(
          (data.promotions ?? []).map((item) => ({
            id: String(item.Id),
            title: String(item.Title),
            description: item.Description ? String(item.Description) : undefined,
            active: Boolean(item.Active),
            startsAt: String(item.StartsAt).slice(0, 10),
            endsAt: String(item.EndsAt).slice(0, 10),
            discountType: String(item.DiscountType ?? 'percent') as Promotion['discountType'],
            discountValue: Number(item.DiscountValue ?? 0),
            serviceIds: parseJson<string[]>(item.ServiceIdsJson, []),
          })),
        );
        setClientHistories(
          (data.clientHistories ?? []).map((item) => ({
            clientId: String(item.ClientId),
            clientName: item.ClientName ? String(item.ClientName) : undefined,
            totalAppointments: Number(item.TotalAppointments ?? 0),
            cancellations: Number(item.Cancellations ?? 0),
            noShows: Number(item.NoShows ?? 0),
            totalSpent: Number(item.TotalSpent ?? 0),
            favoriteServiceIds: parseJson<string[]>(item.FavoriteServiceIdsJson, []),
            rewardPoints: Number(item.RewardPoints ?? 0),
            rewardLevel: String(item.RewardLevel ?? 'bronze') as ClientHistory['rewardLevel'],
            lastVisitAt: item.LastVisitAt,
            notes: item.Notes ? String(item.Notes) : undefined,
          })),
        );
        setEmployeeBlocks(
          (data.employeeBlocks ?? []).map((item) => ({
            id: String(item.Id),
            employeeId: String(item.EmployeeId),
            type: String(item.Type ?? 'permission') as EmployeeBlock['type'],
            date: String(item.BlockDate).slice(0, 10),
            startsAt: String(item.StartsAt).slice(0, 5),
            endsAt: String(item.EndsAt).slice(0, 5),
            note: item.Note ? String(item.Note) : undefined,
          })),
        );
        setAuditLogs(
          (data.auditLogs ?? []).map((item) => ({
            id: String(item.Id),
            actorId: item.ActorId ? String(item.ActorId) : undefined,
            actorName: item.ActorName ? String(item.ActorName) : undefined,
            action: String(item.Action),
            entityType: String(item.EntityType),
            entityId: item.EntityId ? String(item.EntityId) : undefined,
            detail: item.Detail ? String(item.Detail) : undefined,
            createdAt: item.CreatedAt,
          })),
        );
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

  return { organization, serviceCategories, services, employees, appointments, dayNotes, announcements, portfolioItems, promotions, clientHistories, employeeBlocks, auditLogs, settings, appearance, mercadoPagoConnection, error, refetch: () => loadOrganizationData(() => true) };
}
