import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colores, radius, useTema } from '../theme';

export const toque = () => Haptics.selectionAsync().catch(() => {});
export const exito = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

const estilos = (c: Colores) => StyleSheet.create({
  btn: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnText: { fontSize: 16, fontWeight: '700' },
  label: { color: c.muted, fontSize: 12, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: c.surface, color: c.text, borderRadius: 10, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, minHeight: 46 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  card: { backgroundColor: c.surface, borderRadius: radius, borderWidth: 1, borderColor: c.border, padding: 14 },
  seg: { flexDirection: 'row', backgroundColor: c.surfaceAlt, borderRadius: 12, padding: 3 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  section: { color: c.text, fontSize: 17, fontWeight: '700', marginTop: 14, marginBottom: 10 },
});

export function useEstilos() {
  const { c } = useTema();
  return useMemo(() => estilos(c), [c]);
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style, icon }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean;
  loading?: boolean; style?: ViewStyle; icon?: React.ReactNode;
}) {
  const { c } = useTema();
  const s = useEstilos();
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? 'transparent' : c.surfaceAlt;
  const fg = variant === 'primary' ? c.primaryText : variant === 'danger' ? c.danger : c.text;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      onPress={() => { toque(); onPress(); }} disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: c.danger }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (<>{icon}<Text style={[s.btnText, { color: fg }]}>{title}</Text></>)}
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, hint, multiline, numeric, secure, url }: {
  label: string; value: string; onChangeText: (t: string) => void; hint?: string; multiline?: boolean;
  numeric?: boolean; secure?: boolean; url?: boolean;
}) {
  const { c } = useTema();
  const s = useEstilos();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={hint}
        placeholderTextColor={c.muted} multiline={multiline} secureTextEntry={secure}
        keyboardType={numeric ? 'decimal-pad' : url ? 'url' : 'default'}
        autoCapitalize={url || secure || numeric ? 'none' : 'sentences'} autoCorrect={false}
        style={[s.input, multiline && { height: 90, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function Chip({ text, color }: { text: string; color?: string }) {
  const { c } = useTema();
  const s = useEstilos();
  return (
    <View style={[s.chip, { borderColor: color ?? c.border }]}>
      <Text style={{ color: color ?? c.muted, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const s = useEstilos();
  return <View style={[s.card, style]}>{children}</View>;
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const { c } = useTema();
  const s = useEstilos();
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => { toque(); onChange(o.value); }} accessibilityRole="tab"
          accessibilityState={{ selected: o.value === value }} style={[s.segItem, o.value === value && { backgroundColor: c.primary }]}>
          <Text style={{ color: o.value === value ? c.primaryText : c.text, fontWeight: '600' }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Seccion({ children }: { children: string }) {
  const s = useEstilos();
  return <Text style={s.section} accessibilityRole="header">{children}</Text>;
}
