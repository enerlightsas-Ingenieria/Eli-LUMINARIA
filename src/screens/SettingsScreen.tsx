import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { Button, Field } from '../components/ui';
import { Ajustes, cargarAjustes, ENDPOINT_POR_DEFECTO, guardarAjustes, MODELO_POR_DEFECTO } from '../services/settings';
import { colors } from '../theme';

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const [a, setA] = useState<Ajustes | null>(null);
  useEffect(() => { cargarAjustes().then(setA); }, []);
  if (!a) return null;

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingTop: 56 }} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Ajustes</Text>
      <Text style={s.p}>
        El análisis de la foto usa Claude (visión). Pega tu API key de Anthropic; se guarda cifrada en el
        almacén seguro del teléfono. Para producción es mejor apuntar a tu propio servidor/proxy (campo Endpoint)
        y no distribuir la clave en los dispositivos.
      </Text>
      <Field label="API key de Anthropic" value={a.apiKey} secure hint="sk-ant-..." onChangeText={(t) => setA({ ...a, apiKey: t })} />
      <Field label="Endpoint" value={a.endpoint} keyboardType="url" onChangeText={(t) => setA({ ...a, endpoint: t })} />
      <Field label="Modelo" value={a.modelo} onChangeText={(t) => setA({ ...a, modelo: t })} />
      <Button title="Guardar" onPress={async () => { await guardarAjustes(a); Alert.alert('Listo', 'Ajustes guardados.'); onClose(); }} />
      <Button title="Restablecer endpoint y modelo" variant="secondary" style={{ marginTop: 10 }}
        onPress={() => setA({ ...a, endpoint: ENDPOINT_POR_DEFECTO, modelo: MODELO_POR_DEFECTO })} />
      <Button title="Volver" variant="secondary" style={{ marginTop: 10 }} onPress={onClose} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.primary, fontSize: 22, fontWeight: '800', marginBottom: 10 },
  p: { color: colors.muted, lineHeight: 20, marginBottom: 16 },
});
