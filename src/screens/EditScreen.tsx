import React, { useState } from 'react';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Chip, Field } from '../components/ui';
import { colors, radius } from '../theme';
import { CAMPOS, Luminaria, LuminariaBorrador } from '../types';

type Props = {
  inicial: LuminariaBorrador & { id?: number };
  aviso?: string;
  onSave: (l: LuminariaBorrador & { id?: number }) => Promise<void>;
  onDelete?: () => void;
  onCancel: () => void;
};

export function EditScreen({ inicial, aviso, onSave, onDelete, onCancel }: Props) {
  const [l, setL] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof Luminaria>(k: K, v: Luminaria[K]) => setL((p) => ({ ...p, [k]: v }));

  const num = (t: string): number | null => {
    const n = parseFloat(t.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const guardar = async () => {
    setGuardando(true);
    try { await onSave(l); } finally { setGuardando(false); }
  };

  const confirmarBorrado = () =>
    Alert.alert('Eliminar luminaria', '¿Seguro que quieres eliminar este registro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: onDelete },
    ]);

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingTop: 56, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>{inicial.id ? `Luminaria #${inicial.id}` : 'Nueva luminaria'}</Text>
      <Image source={{ uri: l.fotoUri }} style={s.photo} resizeMode="cover" />

      {!!aviso && <Text style={s.aviso}>{aviso}</Text>}
      {!!l.confianza && (
        <View style={{ flexDirection: 'row', marginBottom: 12 }}>
          <Chip text={`Confianza IA: ${l.confianza} — verifica los datos`} color={l.confianza === 'alta' ? colors.ok : l.confianza === 'media' ? colors.warn : colors.danger} />
        </View>
      )}

      <Text style={s.section}>Ubicación</Text>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Field label="Latitud" keyboardType="numeric" value={l.latitud?.toString() ?? ''} onChangeText={(t) => set('latitud', num(t))} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Longitud" keyboardType="numeric" value={l.longitud?.toString() ?? ''} onChangeText={(t) => set('longitud', num(t))} />
        </View>
      </View>
      {l.precisionM != null && <Text style={s.small}>Precisión GPS ≈ {Math.round(l.precisionM)} m</Text>}
      <Field label="Dirección / referencia" value={l.direccion} onChangeText={(t) => set('direccion', t)} />
      {l.latitud != null && l.longitud != null && (
        <Button title="Abrir en mapa" variant="secondary" style={{ marginBottom: 16 }}
          onPress={() => Linking.openURL(`https://maps.google.com/?q=${l.latitud},${l.longitud}`)} />
      )}

      <Text style={s.section}>Características</Text>
      {CAMPOS.map((c) => (
        <Field key={c.key} label={c.label} hint={c.hint} multiline={c.multiline}
          value={l[c.key]} onChangeText={(t) => set(c.key, t)} />
      ))}

      <Button title="Guardar" onPress={guardar} loading={guardando} style={{ marginTop: 8 }} />
      <Button title="Cancelar" variant="secondary" onPress={onCancel} style={{ marginTop: 10 }} />
      {onDelete && <Button title="Eliminar" variant="danger" onPress={confirmarBorrado} style={{ marginTop: 10 }} />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.primary, fontSize: 22, fontWeight: '800', marginBottom: 12 },
  photo: { width: '100%', height: 240, borderRadius: radius, backgroundColor: colors.surfaceAlt, marginBottom: 12 },
  aviso: { color: colors.warn, marginBottom: 10, lineHeight: 19 },
  section: { color: colors.text, fontSize: 17, fontWeight: '700', marginVertical: 10 },
  row: { flexDirection: 'row', gap: 10 },
  small: { color: colors.muted, fontSize: 12, marginBottom: 10, marginTop: -6 },
});
