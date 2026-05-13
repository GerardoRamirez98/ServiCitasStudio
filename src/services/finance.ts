import { Appointment, PaymentSummary, Service } from '../types';

export type FinanceRange = 'week' | 'month' | 'year' | 'custom';

export function buildPaymentSummary(appointments: Appointment[], services: Service[]): PaymentSummary {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  return appointments.reduce<PaymentSummary>(
    (summary, appointment) => {
      const total = Number(appointment.total || 0);
      const deposit = Number(appointment.deposit || 0);
      const fee = Number(appointment.marketplaceFee || 0);
      const completed = appointment.status === 'completed' || appointment.paymentStatus === 'paid' || appointment.servicePaymentStatus === 'paid';
      const pending = appointment.paymentStatus === 'pending' || appointment.servicePaymentStatus === 'pending';

      if (completed) summary.completedPayments += total;
      if (pending) summary.pendingPayments += Math.max(0, total - deposit);
      summary.totalRevenue += completed ? total : 0;
      summary.deposits += appointment.paymentStatus === 'paid' ? deposit : 0;
      summary.fees += fee;
      summary.byEmployee[appointment.employeeId] = (summary.byEmployee[appointment.employeeId] ?? 0) + (completed ? total : 0);

      const method = appointment.servicePaymentMethod ?? appointment.paymentMethod;
      if (method === 'cash') summary.cash += total;
      if (method === 'transfer') summary.transfer += total;
      if (method === 'mercado_pago' || appointment.paymentProvider === 'mercado_pago') summary.mercadoPago += total;
      if (method === 'spei') summary.spei += total;
      if (method === 'oxxo') summary.oxxo += total;

      appointment.serviceIds.forEach((serviceId) => {
        const service = serviceMap.get(serviceId);
        const key = service?.name ?? serviceId;
        summary.byService[key] = (summary.byService[key] ?? 0) + (completed ? total / Math.max(1, appointment.serviceIds.length) : 0);
      });
      return summary;
    },
    {
      totalRevenue: 0,
      deposits: 0,
      pendingPayments: 0,
      completedPayments: 0,
      cash: 0,
      transfer: 0,
      mercadoPago: 0,
      spei: 0,
      oxxo: 0,
      fees: 0,
      byEmployee: {},
      byService: {},
    },
  );
}
