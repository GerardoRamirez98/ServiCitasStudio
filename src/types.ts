export type UserRole = 'client' | 'employee' | 'admin';
export type AppearancePreset = 'studio' | 'barber' | 'salon' | 'clinic' | 'minimal';

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  employeeId?: string;
};

export type Organization = {
  id: string;
  name: string;
  ownerId: string;
  publicCode?: string;
  slug?: string;
  address?: OrganizationAddress;
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
};

export type Employee = {
  id: string;
  userId?: string;
  name: string;
  email?: string;
  role: string;
  active: boolean;
  inviteCode?: string;
  compensationMode?: CompensationMode;
  fixedSalary?: number;
  commissionPercent?: number;
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
  specialPrice?: number;
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
};

export type BusinessSettings = {
  requireDeposit: boolean;
  depositPercent: number;
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
