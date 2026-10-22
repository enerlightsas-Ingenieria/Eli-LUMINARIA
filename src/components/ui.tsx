import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { colors, radius } from '../theme';

export function Button({
  title, onPress, variant = 'primary', disabled, loading, style,
}: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? 'transparent' : colors.surfaceAlt;
  const fg = variant === 'primary' ? colors.primaryText : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: colors.danger }, style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({
  label, value, onChangeText, hint, multiline, keyboardType, secure,
}: {
  label: string; value: string; onChangeText: (t: string) => void; hint?: string;
  multiline?: boolean; keyboardType?: 'default' | 'numeric' | 'url'; secure?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={hint}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.input, multiline && { height: 90, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

export function Chip({ text, color }: { text: string; color?: string }) {
  return (
    <View style={[s.chip, { borderColor: color ?? colors.border }]}>
      <Text style={{ color: color ?? colors.muted, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.surface, color: colors.text, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16,
  },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
});
