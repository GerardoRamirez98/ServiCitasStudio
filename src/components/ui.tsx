import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { theme } from '../theme';
import { useBrandColors } from '../theme-context';
import { AppointmentStatus } from '../types';

export function Section({ title, icon, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  const colors = useBrandColors();
  return (
    <View style={{ gap: 10 }}>
      <View style={localStyles.sectionHeader}>
        <Ionicons name={icon} size={20} color={colors.primary} />
        <Text style={theme.styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export function LabeledInput({
  label,
  helper,
  style,
  ...inputProps
}: TextInputProps & {
  label: string;
  helper?: string;
}) {
  const colors = useBrandColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[localStyles.inputLabel, { color: colors.ink }]}>{label}</Text>
      <TextInput style={[theme.styles.input, { borderColor: colors.line, backgroundColor: colors.surface, color: colors.ink }, style]} placeholderTextColor="#8b969e" {...inputProps} />
      {helper ? <Text style={theme.styles.mutedText}>{helper}</Text> : null}
    </View>
  );
}

export function PrimaryButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const colors = useBrandColors();
  return (
    <Pressable style={[localStyles.primaryButton, { backgroundColor: colors.primaryDark }]} onPress={onPress}>
      <Ionicons name={icon} size={18} color={colors.surface} />
      <Text style={localStyles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function SmallButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const colors = useBrandColors();
  return (
    <Pressable style={[localStyles.smallButton, { backgroundColor: colors.surfaceMuted }, danger && localStyles.dangerButton]} onPress={onPress}>
      <Text style={[localStyles.smallButtonText, { color: colors.primaryDark }, danger && localStyles.dangerButtonText]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  const colors = useBrandColors();
  return (
    <Pressable style={[localStyles.iconButton, { borderColor: colors.line, backgroundColor: colors.surface }]} onPress={onPress}>
      <Ionicons name={icon} size={19} color={colors.primaryDark} />
    </Pressable>
  );
}

export function Pill({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useBrandColors();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        localStyles.pill,
        { borderColor: colors.line, backgroundColor: colors.surface },
        active && { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
        disabled && localStyles.pillDisabled,
      ]}
    >
      <Text style={[localStyles.pillText, { color: colors.ink }, active && localStyles.pillTextActive, disabled && localStyles.disabledText]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const colors = useBrandColors();
  return (
    <View style={[localStyles.segmented, { backgroundColor: colors.surfaceMuted }]}>
      {options.map((option) => {
        const active = value === option.key;
        return (
          <Pressable key={option.key} style={[localStyles.segment, active && { backgroundColor: colors.primaryDark }]} onPress={() => onChange(option.key)}>
            <Ionicons name={option.icon} size={16} color={active ? colors.surface : colors.muted} />
            <Text style={[localStyles.segmentText, { color: active ? colors.surface : colors.muted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  const colors = useBrandColors();
  return (
    <View style={[localStyles.empty, { borderColor: colors.line, backgroundColor: colors.surface }]}>
      <Ionicons name="information-circle-outline" size={20} color={colors.muted} />
      <Text style={theme.styles.mutedText}>{text}</Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const colors = useBrandColors();
  const label = {
    pending: 'pendiente',
    confirmed: 'confirmada',
    waiting: 'en espera',
    in_service: 'atendiendo',
    completed: 'terminada',
    lost: 'perdida',
    cancelled: 'cancelada',
  }[status];
  const color =
    status === 'confirmed' || status === 'completed' || status === 'in_service'
      ? colors.primary
      : status === 'pending' || status === 'waiting'
        ? colors.accent
        : colors.danger;

  return (
    <View style={[localStyles.badge, { borderColor: color }]}>
      <Text style={[localStyles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const localStyles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputLabel: {
    color: theme.colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: theme.colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: theme.colors.surface,
    fontWeight: '800',
    fontSize: 15,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surface,
  },
  smallButton: {
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
  smallButtonText: {
    color: theme.colors.primaryDark,
    fontWeight: '800',
  },
  dangerButton: {
    backgroundColor: '#fdebed',
  },
  dangerButtonText: {
    color: theme.colors.danger,
  },
  pill: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.line,
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  pillActive: {
    backgroundColor: theme.colors.primaryDark,
    borderColor: theme.colors.primaryDark,
  },
  pillDisabled: {
    backgroundColor: '#e9edf0',
  },
  pillText: {
    color: theme.colors.ink,
    fontWeight: '700',
    fontSize: 13,
  },
  pillTextActive: {
    color: theme.colors.surface,
  },
  disabledText: {
    color: '#9aa3aa',
  },
  segmented: {
    minHeight: 44,
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minWidth: 96,
    minHeight: 36,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
  },
  segmentActive: {
    backgroundColor: theme.colors.primaryDark,
  },
  segmentText: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: theme.colors.surface,
  },
  empty: {
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontWeight: '800',
    fontSize: 12,
  },
});
