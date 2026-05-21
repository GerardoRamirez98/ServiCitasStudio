export type UserRole = 'client' | 'employee' | 'receptionist' | 'manager' | 'admin' | 'owner';
export type AppearancePreset = 'studio' | 'barber' | 'salon' | 'clinic' | 'minimal' | 'tattoo' | 'spa' | 'fitness' | 'dental' | 'pet';
export type StaffRole = Extract<UserRole, 'employee' | 'receptionist' | 'manager' | 'admin' | 'owner'>;

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  employeeId?: string;
  clientOrganizationId?: string;
  clientOrganizationName?: string;
};

export type Organization = {
  id: string;
  name: string;
  ownerId: string;
  publicCode?: string;
  slug?: string;
  address?: OrganizationAddress;
};

export type ClientOrganization = {
  id: string;
  name: string;
  publicCode?: string;
  active?: boolean;
  followed?: boolean;
  city?: string;
  state?: string;
};

export type ClientAppointmentOverview = {
  id: string;
  organizationId: string;
  organizationName: string;
  date: string;
  time: string;
  status: AppointmentStatus;
  total: number;
};

export type OrganizationAddress = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  exteriorNumber: string;
  interiorNumber?: string;
  zipCode: string;
};

export type Service = {
  id: string;
  name: string;
  price: number;
  duration: number;
  active: boolean;
  categoryId?: string;
  employeeDurations?: Record<string, number>;
};

export type ServiceCategory = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  sortOrder?: number;
};

export type Employee = {
  id: string;
  userId?: string;
  name: string;
  email?: string;
  role: string;
  specialties?: string[];
  active: boolean;
  inviteCode?: string;
  compensationMode?: CompensationMode;
  fixedSalary?: number;
  commissionPercent?: number;
  serviceDurations?: Record<string, number>;
  scheduleOverrides?: Record<string, { enabled?: boolean; start: string; end: string; breakStart?: string; breakEnd?: string }>;
};

export type EmployeeBlockType = 'vacation' | 'sick_leave' | 'meal' | 'permission' | 'custom_schedule';

export type EmployeeBlock = {
  id: string;
  employeeId: string;
  type: EmployeeBlockType;
  date?: string;
  startsAt: string;
  endsAt: string;
  note?: string;
};

export type AppointmentStatus = 'pending' | 'confirmed' | 'waiting' | 'in_service' | 'completed' | 'lost' | 'cancelled';
export type PaymentStatus = 'not_required' | 'pending' | 'paid' | 'offline' | 'refunded';
export type PaymentMethod = 'none' | 'card' | 'cash' | 'transfer' | 'mercado_pago' | 'spei' | 'oxxo';
export type PaymentProvider = 'none' | 'mercado_pago';
export type CompensationMode = 'fixed' | 'commission' | 'mixed';
export type RefundStatus = 'not_applicable' | 'non_refundable' | 'refunded';
export type CancellationTiming = 'on_time' | 'late';

export type Appointment = {
  id: string;
  clientId: string;
  clientName: string;
  date: string;
  time: string;
  endTime?: string;
  duration?: number;
  serviceIds: string[];
  employeeId: string;
  status: AppointmentStatus;
  note: string;
  delayNotice?: string;
  delayMinutes?: number;
  deposit: number;
  requiresDeposit?: boolean;
  depositPercent?: number;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  paymentProvider?: PaymentProvider;
  requestedDepositPaymentMethod?: PaymentMethod;
  paymentReference?: string;
  paymentStatusDetail?: string;
  mercadoPagoPreferenceId?: string;
  mercadoPagoPaymentId?: string;
  marketplaceFee?: number;
  refundStatus?: RefundStatus;
  subtotal?: number;
  discountAmount?: number;
  specialPrice?: number | null;
  discountReason?: string;
  total: number;
  termsAccepted: boolean;
  cancelledAt?: unknown;
  cancelledBy?: UserRole | 'system';
  cancellationReason?: string;
  cancellationTiming?: CancellationTiming;
  serviceRightForfeited?: boolean;
  servicePaymentMethod?: 'cash' | 'transfer' | 'mercado_pago';
  servicePaymentStatus?: 'pending' | 'paid';
  servicePaidAt?: unknown;
  source?: 'client' | 'manual';
  promotionId?: string;
  categoryIds?: string[];
};

export type PromotionDiscountType = 'percent' | 'fixed';

export type Promotion = {
  id: string;
  title: string;
  description?: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
  discountType: PromotionDiscountType;
  discountValue: number;
  serviceIds: string[];
};

export type AuditLog = {
  id: string;
  actorId?: string;
  actorName?: string;
  action: string;
  entityType: string;
  entityId?: string;
  detail?: string;
  createdAt?: unknown;
};

export type PortfolioItem = {
  id: string;
  title: string;
  description?: string;
  categoryId?: string;
  employeeId?: string;
  imageUrl: string;
  active?: boolean;
  createdAt?: unknown;
};

export type ClientRewardLevel = 'bronze' | 'silver' | 'gold' | 'vip';

export type ClientHistory = {
  clientId: string;
  clientName?: string;
  totalAppointments: number;
  cancellations: number;
  noShows: number;
  totalSpent: number;
  favoriteServiceIds: string[];
  rewardPoints: number;
  rewardLevel: ClientRewardLevel;
  lastVisitAt?: unknown;
  notes?: string;
};

export type PaymentSummary = {
  totalRevenue: number;
  deposits: number;
  pendingPayments: number;
  completedPayments: number;
  cash: number;
  transfer: number;
  mercadoPago: number;
  spei: number;
  oxxo: number;
  fees: number;
  byEmployee: Record<string, number>;
  byService: Record<string, number>;
};

export type DayNote = {
  id: string;
  date: string;
  type: 'closed' | 'delay' | 'issue';
  note: string;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  audience?: 'clients' | 'employees' | 'all';
};

export type BusinessSettings = {
  requireDeposit: boolean;
  depositPercent: number;
  latePolicyEnabled: boolean;
  toleranceMinutes: number;
  cancellationLimitHours: number;
  businessStart: string;
  businessEnd: string;
  breakEnabled: boolean;
  breakStart: string;
  breakEnd: string;
  slotMinutes: number;
  workingDays: number[];
};

export type AppearanceSettings = {
  preset: AppearancePreset;
  displayName: string;
  tagline: string;
  welcomeMessage: string;
  logoUrl?: string;
};

export type MercadoPagoConnectionStatus = {
  connected: boolean;
  userId?: string;
  publicKey?: string;
  connectedAt?: unknown;
  disconnectedAt?: unknown;
  expiresAt?: unknown;
  lastRefreshAt?: unknown;
};
