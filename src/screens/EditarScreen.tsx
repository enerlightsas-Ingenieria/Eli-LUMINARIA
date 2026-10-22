import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chip, exito, Field, Seccion } from '../components/ui';
import { useApp } from '../context/AppContext';
import { coordenadaValida, enlaceMapa, masCercano } from '../lib/geo';
import { analizarFotos } from '../services/analyzer';
import { tomarFoto } from '../services/captura';
import { borrarLuminaria, guardarLuminaria } from '../services/db';
import { borrarFotos, leerBase64, persistirFoto } from '../services/fotos';
import { hayConexion } from '../services/red';
import { confianzaColor, radius, useTema } from '../theme';
import { CAMPOS, LuminariaBorrador } from '../types';
import type { RootStackParams } from '../navigation';

export function EditarScreen() {
  const { c } = useTema();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { params } = useRoute<NativeStackScreenProps<RootStackParams, 'Editar'>['route']>();
  const { items, refrescar } = useApp();
  const existente = params.id ? items.find((l) => l.id === params.id) : undefined;
  const esNuevo = !existente;

  const [l, setL] = useState<LuminariaBorrador | null>(existente ?? params.borrador ?? null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState(params.aviso);
  const guardado = useRef(false); // ref: el listener de beforeRemove debe ver el valor al instante
  const fotosOriginales = existente?.fotos ?? [];

  useLayoutEffect(() => {
    nav.setOptions({ title: esNuevo ? 'Nueva luminaria' : `Luminaria #${params.id}` });
  }, [nav, esNuevo, params.id]);

  // Si el usuario sale sin guardar una luminaria nueva, se descartan las fotos copiadas.
  useEffect(() => nav.addListener('beforeRemove', () => {
    if (!guardado.current && esNuevo && l) borrarFotos(l.fotos);
  }), [nav, esNuevo, l]);

  if (!l) return null;
  const set = <K extends keyof LuminariaBorrador>(k: K, v: LuminariaBorrador[K]) => setL((p) => (p ? { ...p, [k]: v } : p));
  const num = (t: string): number | null => { const n = parseFloat(t.replace(',', '.')); return Number.isFinite(n) ? n : null; };

  const agregarFoto = async () => {
    if (l.fotos.length >= 3) { Alert.alert('Máximo 3 fotos', 'Quita una para añadir otra.'); return; }
    try {
      const f = await tomarFoto('camara');
      if (f) set('fotos', [...l.fotos, persistirFoto(f.uri)]);
    } catch (e: any) { Alert.alert('Foto', e.message ?? String(e)); }
  };

  const quitarFoto = (uri: string) => {
    set('fotos', l.fotos.filter((x) => x !== uri));
    if (!fotosOriginales.includes(uri)) borrarFotos([uri]); // las originales se borran al guardar
  };

  const reanalizar = async () => {
    if (!(await hayConexion())) { Alert.alert('Sin conexión', 'Necesitas internet para el análisis con IA. Las fotos quedan guardadas; inténtalo cuando tengas señal.'); return; }
    setOcupado('Analizando con IA…');
    try {
      const r = await analizarFotos(await Promise.all(l.fotos.slice(0, 3).map(leerBase64)));
      const nuevos = Object.entries(r.caracteristicas).filter(([, v]) => v);
      if (!nuevos.length) { Alert.alert('IA', 'La IA no pudo identificar datos en estas fotos.'); return; }
      setL((p) => (p ? { ...p, ...r.caracteristicas, confianza: r.confianza } : p));
      setAviso(undefined);
      exito();
    } catch (e: any) { Alert.alert('No se pudo analizar', e.message ?? String(e)); }
    finally { setOcupado(null); }
  };

  const anterior = esNuevo ? items[0] : undefined;
  const copiarDelAnterior = () => {
    if (!anterior) return;
    const copia = Object.fromEntries(CAMPOS.filter((f) => f.key !== 'observaciones' && f.key !== 'estado').map((f) => [f.key, anterior[f.key]]));
    setL((p) => (p ? { ...p, ...copia } : p));
  };

  const persistir = async (siguiente: boolean) => {
    setOcupado('Guardando…');
    try {
      if (l.latitud != null && !coordenadaValida(l.latitud, l.longitud)) {
        Alert.alert('Coordenada inválida', 'Revisa la latitud (−90 a 90) y la longitud (−180 a 180).');
        return;
      }
      await guardarLuminaria(l);
      borrarFotos(fotosOriginales.filter((u) => !l.fotos.includes(u)));
      guardado.current = true;
      exito();
      await refrescar();
      if (siguiente) nav.replace('Capturar'); else nav.goBack();
    } finally { setOcupado(null); }
  };

  const guardar = (siguiente: boolean) => {
    if (coordenadaValida(l.latitud, l.longitud)) {
      const cerca = masCercano({ latitud: l.latitud!, longitud: l.longitud! }, items.filter((x) => x.id !== l.id), 8);
      if (cerca) {
        Alert.alert('Posible duplicado', `Ya hay una luminaria (#${cerca.item.id}${cerca.item.codigo ? ' · ' + cerca.item.codigo : ''}) a ${Math.round(cerca.metros)} m de esta coordenada.`, [
          { text: 'Ver la otra', onPress: () => nav.push('Editar', { id: cerca.item.id }) },
          { text: 'Guardar igual', onPress: () => persistir(siguiente) },
          { text: 'Cancelar', style: 'cancel' },
        ]);
        return;
      }
    }
    persistir(siguiente);
  };

  const eliminar = () =>
    Alert.alert('Eliminar luminaria', '¿Seguro que quieres eliminar este registro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        if (existente) { await borrarLuminaria(existente); borrarFotos(existente.fotos); }
        guardado.current = true; await refrescar(); nav.goBack();
      } },
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ marginBottom: 12 }}>
          {l.fotos.map((u) => (
            <View key={u}>
              <Image source={{ uri: u }} style={{ width: 220, height: 200, borderRadius: radius, backgroundColor: c.surfaceAlt }} />
              <Pressable onPress={() => quitarFoto(u)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quitar foto"
                style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, padding: 4 }}>
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>
          ))}
          {l.fotos.length < 3 && (
            <Pressable onPress={agregarFoto} accessibilityRole="button" accessibilityLabel="Añadir foto"
              style={{ width: 120, height: 200, borderRadius: radius, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={34} color={c.primary} />
            </Pressable>
          )}
        </ScrollView>

        {!!l.tecnico && <Text style={{ color: c.muted, marginBottom: 6 }}>Registrada por {l.tecnico}</Text>}
        {!!aviso && <Text style={{ color: c.warn, marginBottom: 10, lineHeight: 19 }}>{aviso}</Text>}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          {!!l.confianza && <Chip text={`Confianza IA: ${l.confianza} — verifica los datos`} color={confianzaColor(c, l.confianza)} />}
        </View>
        <Button title="Re-analizar con IA" variant="secondary" loading={!!ocupado} disabled={!l.fotos.length}
          icon={<Ionicons name="sparkles" size={18} color={c.text} />} onPress={reanalizar} />

        {!!anterior && (
          <Button title="Copiar datos del último registro" variant="secondary" style={{ marginTop: 8 }}
            icon={<Ionicons name="copy-outline" size={18} color={c.text} />} onPress={copiarDelAnterior} />
        )}

        <Seccion>Identificación y ubicación</Seccion>
        <Field label="Código del activo / n.º de poste" value={l.codigo} onChangeText={(t) => set('codigo', t)} hint="Opcional, el que use tu empresa" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Latitud" numeric value={l.latitud?.toString() ?? ''} onChangeText={(t) => set('latitud', num(t))} /></View>
          <View style={{ flex: 1 }}><Field label="Longitud" numeric value={l.longitud?.toString() ?? ''} onChangeText={(t) => set('longitud', num(t))} /></View>
        </View>
        {l.precisionM != null && <Text style={{ color: c.muted, fontSize: 12, marginBottom: 10, marginTop: -6 }}>Precisión GPS ≈ {Math.round(l.precisionM)} m</Text>}
        <Field label="Dirección / referencia" value={l.direccion} onChangeText={(t) => set('direccion', t)} />
        {coordenadaValida(l.latitud, l.longitud) && (
          <Button title="Abrir en mapa" variant="secondary" icon={<Ionicons name="map-outline" size={18} color={c.text} />}
            onPress={() => Linking.openURL(enlaceMapa(l.latitud!, l.longitud!))} />
        )}

        <Seccion>Características</Seccion>
        {CAMPOS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint} multiline={f.multiline} numeric={f.numeric} opciones={f.opciones}
            value={l[f.key]} onChangeText={(t) => set(f.key, t)} />
        ))}

        <Button title="Guardar" loading={ocupado === 'Guardando…'} onPress={() => guardar(false)} style={{ marginTop: 8 }} />
        {esNuevo && <Button title="Guardar y capturar otra" variant="secondary" onPress={() => guardar(true)} style={{ marginTop: 10 }} />}
        {!esNuevo && <Button title="Eliminar" variant="danger" onPress={eliminar} style={{ marginTop: 10 }} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
