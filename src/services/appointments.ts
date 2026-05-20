import { PaymentMethod } from '../types';
import { apiPost } from './api';

export type CreateAppointmentInput = {
  organizationId: string;
  clientId?: string;
  clientName: string;
  date: string;
  time: string;
  duration: number;
  serviceIds: string[];
  employeeId?: string;
  note?: string;
  source: 'client' | 'manual';
  total: number;
  subtotal?: number;
  deposit?: number;
  requiresDeposit?: boolean;
  depositPercent?: number;
  paymentMethod?: PaymentMethod;
  requestedDepositPaymentMethod?: PaymentMethod;
  specialPrice?: number | null;
  discountAmount?: number;
  discountReason?: string;
  termsAccepted: boolean;
};

export type CreateAppointmentResponse = {
  appointmentId: string;
  employeeId: string;
};

export function createAppointment(input: CreateAppointmentInput) {
  return apiPost<CreateAppointmentResponse>(`/organizations/${input.organizationId}/appointments`, input);
}
