import { normalizeCode } from '../utils/codes';

export async function createPublicOrganizationCode(_organizationId: string, organizationName: string) {
  return normalizeCode(organizationName).slice(0, 8);
}

export async function resolveOrganizationCode(code: string) {
  const normalized = normalizeCode(code);
  return {
    organizationId: '',
    organizationName: 'Organizacion',
    publicCode: normalized,
  };
}

export async function resolveEmployeeInvite(code: string) {
  const normalized = normalizeCode(code);
  return {
    inviteCode: normalized,
    organizationId: '',
    organizationName: 'Organizacion',
    employeeId: '',
    email: '',
    used: false,
  };
}
