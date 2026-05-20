import AsyncStorage from '@react-native-async-storage/async-storage';
import { OrganizationAddress, PaymentSummary, UserProfile, UserRole } from '../types';
import { notifyAuthChanged } from './authEvents';
import { notifyOrganizationDataChanged } from './dataEvents';

const tokenKey = 'servicitas.apiToken';
const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const requestTimeoutMs = 15000;

type AuthResponse = {
  token: string;
  profile: UserProfile;
};

async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const token = await AsyncStorage.getItem(tokenKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload.message ?? 'No se pudo completar la solicitud.'));
    }
    if (init.method && init.method !== 'GET' && path.startsWith('/organizations/')) {
      notifyOrganizationDataChanged();
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al conectar con el backend.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function apiGet<T>(path: string) {
  return apiRequest<T>(path);
}

export function apiPost<T>(path: string, body: unknown) {
  return apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown) {
  return apiRequest<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown) {
  return apiRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string) {
  return apiRequest<T>(path, { method: 'DELETE' });
}

export function apiAssetUrl(value?: string) {
  if (!value) return undefined;
  if (/^(data:|https?:\/\/)/i.test(value)) return value;
  return `${apiUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

export function apiStoredAssetPath(value?: string) {
  if (!value) return '';
  return value.startsWith(`${apiUrl}/`) ? value.slice(apiUrl.length) : value;
}

export async function apiUploadOrganizationLogo(input: { organizationId: string; uri: string; fileName?: string; mimeType?: string }) {
  const token = await AsyncStorage.getItem(tokenKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const formData = new FormData();
  formData.append('logo', {
    uri: input.uri,
    name: input.fileName || 'logo.jpg',
    type: input.mimeType || 'image/jpeg',
  } as unknown as Blob);

  try {
    const response = await fetch(`${apiUrl}/organizations/${input.organizationId}/logo`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload.message ?? 'No se pudo subir el logo.'));
    }
    notifyOrganizationDataChanged();
    return { logoUrl: String(payload.logoUrl ?? '') };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al subir el logo.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiLogin(email: string, password: string) {
  const payload = await apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await AsyncStorage.setItem(tokenKey, payload.token);
  notifyAuthChanged();
  return payload.profile;
}

export async function apiRegister(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  organizationName?: string;
  organizationCode?: string;
  organizationAddress?: OrganizationAddress;
  employeeInviteCode?: string;
}) {
  const payload = await apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  await AsyncStorage.setItem(tokenKey, payload.token);
  notifyAuthChanged();
  return payload.profile;
}

export async function apiMe() {
  const token = await AsyncStorage.getItem(tokenKey);
  if (!token) return null;
  const payload = await apiRequest<{ profile: UserProfile }>('/auth/me');
  return payload.profile;
}

export async function apiLogout() {
  await AsyncStorage.removeItem(tokenKey);
  notifyAuthChanged();
}

export async function apiOrganizationBootstrap(organizationId: string) {
  return apiRequest<{
    organization: Record<string, unknown> | null;
    settings: Record<string, unknown> | null;
    appearance: Record<string, unknown> | null;
    services: Record<string, unknown>[];
    employees: Record<string, unknown>[];
    appointments: Record<string, unknown>[];
    dayNotes: Record<string, unknown>[];
    announcements: Record<string, unknown>[];
  }>(`/organizations/${organizationId}/bootstrap`);
}

export async function apiSqlServerHealth() {
  return apiGet<{ ok: boolean; serverName: string; databaseName: string; checkedAt: string }>('/health');
}

export async function apiFinanceReport(organizationId: string, from: string, to: string) {
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return apiGet<{ from: string; to: string; summary: PaymentSummary }>(`/organizations/${organizationId}/reports/finance?${query}`);
}
