import { StyleSheet } from 'react-native';
import type { AppearancePreset, AppearanceSettings } from './types';

const colors = {
  background: '#f6f8fb',
  surface: '#ffffff',
  surfaceMuted: '#f3f4f6',
  ink: '#111827',
  muted: '#5f6f7a',
  line: '#e5e7eb',
  primary: '#475569',
  primaryDark: '#111827',
  accent: '#64748b',
  danger: '#dc2626',
  info: '#475569',
};

export const appearancePresets: Record<AppearancePreset, { label: string; primary: string; primaryDark: string; accent: string; background: string }> = {
  studio: { label: 'Esmeralda coral', primary: '#10a37f', primaryDark: '#064e3b', accent: '#f97316', background: '#f0fbf7' },
  barber: { label: 'Barber neon', primary: '#f43f5e', primaryDark: '#18181b', accent: '#facc15', background: '#f8fafc' },
  salon: { label: 'Rosa editorial', primary: '#ec4899', primaryDark: '#831843', accent: '#14b8a6', background: '#fff1f6' },
  clinic: { label: 'Azul fresco', primary: '#2563eb', primaryDark: '#1e3a8a', accent: '#84cc16', background: '#eff6ff' },
  minimal: { label: 'Grafito solar', primary: '#475569', primaryDark: '#111827', accent: '#f59e0b', background: '#f8fafc' },
};

export const defaultAppearance: AppearanceSettings = {
  preset: 'studio',
  displayName: 'ServiCitas Studio',
  tagline: 'Agenda simple para negocios de servicio',
  welcomeMessage: 'Selecciona tus servicios, elige horario y solicita tu cita.',
  logoUrl: '',
};

export function getAppearancePalette(appearance?: Partial<AppearanceSettings>) {
  return appearancePresets[appearance?.preset ?? defaultAppearance.preset] ?? appearancePresets.studio;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 36,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  screenTitle: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '800',
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  text: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
  },
  mutedText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 15,
    gap: 10,
    boxShadow: '0 8px 24px rgba(17, 24, 39, 0.07)',
  },
  heroCard: {
    borderRadius: 8,
    padding: 18,
    gap: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    boxShadow: '0 10px 30px rgba(17, 24, 39, 0.12)',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 82,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 12,
    gap: 4,
    boxShadow: '0 5px 16px rgba(17, 24, 39, 0.05)',
  },
  statValue: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowCard: {
    minHeight: 64,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 5px 18px rgba(17, 24, 39, 0.05)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  grow: {
    flex: 1,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 15,
  },
  textArea: {
    minHeight: 86,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalShade: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(24,32,38,0.38)',
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    gap: 12,
  },
});

export const theme = { colors, styles };
