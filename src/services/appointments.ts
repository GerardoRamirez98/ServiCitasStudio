import { httpsCallable } from 'firebase/functions';
import { runtimeFeatures } from '../config/features';
import { functions } from '../firebase';
import { PaymentMethod } from '../types';

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

export async function createAppointment(input: CreateAppointmentInput) {
  if (!runtimeFeatures.firebaseFunctions) {
    throw new Error('Las reservas atomicas requieren Firebase Functions activo.');
  }

  const callable = httpsCallable<CreateAppointmentInput, CreateAppointmentResponse>(functions, 'createAppointment');
  const result = await callable(input);
  return result.data;
}
