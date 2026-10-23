import React, { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Cabecera } from '../components/Cabecera';
import { Button, Field, Segmented, Seccion } from '../components/ui';
import { useApp } from '../context/AppContext';
import { Ajustes, cargarAjustes, ENDPOINT_POR_DEFECTO, guardarAjustes, MODELO_POR_DEFECTO } from '../services/settings';
import { pedirYAplicar } from '../services/configuracion';
import { resumenSync, sincronizar } from '../services/sync';
import { useTema } from '../theme';

export function AjustesScreen() {
  const { c, setPref } = useTema();
  const { proyecto, refrescar, versionConfig, configCambiada } = useApp();
  const [a, setA] = useState<Ajustes | null>(null);
  const [sync, setSync] = useState(false);
  const [codigo, setCodigo] = useState('');
  // Se recarga al abrir y cada vez que se importa una configuración: si no, "Guardar" pisaría con valores viejos lo recién importado.
  useEffect(() => { cargarAjustes().then(setA); }, [versionConfig]);
  if (!a) return null;

  const cambiar = (p: Partial<Ajustes>) => setA((x) => ({ ...x!, ...p }));
  const guardar = async () => { await guardarAjustes(a); Alert.alert('Listo', 'Ajustes guardados.'); };

  const sincronizarYa = async () => {
    if (!proyecto) return;
    await guardarAjustes(a);
    setSync(true);
    try {
      const r = await sincronizar(proyecto);
      await refrescar();
      Alert.alert('Sincronizado', resumenSync(r));
    } catch (e: any) { Alert.alert('No se pudo sincronizar', e.message ?? String(e)); }
    finally { setSync(false); }
  };

  const p = { color: c.muted, lineHeight: 20, marginBottom: 14 } as const;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Cabecera titulo="Ajustes" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Seccion>Técnico y configuración de flota</Seccion>
        <Text style={p}>Tu nombre se registra en cada luminaria. Si tu empresa te dio un enlace o código de configuración, ábrelo o pégalo aquí: deja la app lista sin escribir claves.</Text>
        <Field label="Nombre del técnico" value={a.tecnico} hint="Ej. Juan Pérez" onChangeText={(t) => cambiar({ tecnico: t })} />
        <Field label="Código de configuración" url value={codigo} hint="ELI1.…  o  eliluminaria://config?c=…" onChangeText={setCodigo} />
        <Button title="Importar configuración" variant="secondary" disabled={!codigo.trim()}
          onPress={() => pedirYAplicar(codigo, async () => { setCodigo(''); configCambiada(); await refrescar(); })} />

        <Seccion>Apariencia</Seccion>
        <Segmented value={a.tema} onChange={(tema) => { cambiar({ tema }); setPref(tema); }}
          options={[{ value: 'auto', label: 'Automático' }, { value: 'claro', label: 'Claro' }, { value: 'oscuro', label: 'Oscuro' }]} />

        <Seccion>Análisis con IA</Seccion>
        <Text style={p}>Usa Claude (visión) para leer la foto. Tu API key se guarda cifrada en el llavero del teléfono. En producción es mejor apuntar al proxy propio (ver carpeta server/) y no repartir la clave.</Text>
        <Field label="API key de Anthropic" value={a.apiKey} secure hint="sk-ant-..." onChangeText={(t) => cambiar({ apiKey: t })} />
        <Field label="Endpoint" url value={a.endpoint} onChangeText={(t) => cambiar({ endpoint: t })} />
        <Field label="Modelo" value={a.modelo} onChangeText={(t) => cambiar({ modelo: t })} />
        <Button title="Restablecer endpoint y modelo" variant="secondary" onPress={() => cambiar({ endpoint: ENDPOINT_POR_DEFECTO, modelo: MODELO_POR_DEFECTO })} />

        <Seccion>Sincronización (Google Sheets / servidor)</Seccion>
        <Text style={p}>Pega la URL de tu Web App de Google Apps Script (ver docs/google-sheets.md). Cada proyecto crea su pestaña y cada luminaria se actualiza sin duplicarse.</Text>
        <Field label="URL de sincronización" url value={a.syncUrl} hint="https://script.google.com/macros/s/.../exec" onChangeText={(t) => cambiar({ syncUrl: t })} />
        <Field label="Token secreto" secure value={a.syncToken} onChangeText={(t) => cambiar({ syncToken: t })} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ color: c.text, flex: 1, paddingRight: 12 }}>Incluir la primera foto (guarda en Drive)</Text>
          <Switch value={a.syncFotos} onValueChange={(syncFotos) => cambiar({ syncFotos })} trackColor={{ true: c.primary }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text style={{ color: c.text, flex: 1, paddingRight: 12 }}>Sincronizar automáticamente cuando haya conexión</Text>
          <Switch value={a.autoSync} onValueChange={(autoSync) => cambiar({ autoSync })} trackColor={{ true: c.primary }} />
        </View>
        <Button title={`Sincronizar "${proyecto?.nombre ?? ''}" ahora`} variant="secondary" loading={sync} disabled={!a.syncUrl} onPress={sincronizarYa} />

        <Button title="Guardar ajustes" onPress={guardar} style={{ marginTop: 22 }} />

        <Seccion>Acerca de</Seccion>
        <Text style={{ color: c.muted, lineHeight: 20 }}>
          ELI-LUMINARIA {Constants.expoConfig?.version ?? ''}{'\n'}Inventario de luminarias con IA y GPS.{'\n'}Los datos viven en tu teléfono; sólo salen las fotos que envías a analizar y lo que sincronizas.{'\n'}Tu ubicación solo se comparte con tu empresa mientras tienes una jornada ACTIVA (botón en la lista); al pausar o terminar deja de enviarse.
        </Text>
        <Button title="Ver código y documentación" variant="secondary" style={{ marginTop: 12 }}
          onPress={() => Linking.openURL('https://github.com/enerlightsas-ingenieria/eli-luminaria')} />
      </ScrollView>
    </View>
  );
}
