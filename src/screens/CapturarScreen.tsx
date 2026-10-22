import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Button, exito, toque } from '../components/ui';
import { useApp } from '../context/AppContext';
import { analizarFotos } from '../services/analyzer';
import { direccionDe, Foto, obtenerPosicion, Posicion, tomarFoto } from '../services/captura';
import { nuevoUuid } from '../services/db';
import { cargarAjustes } from '../services/settings';
import { persistirFoto } from '../services/fotos';
import { radius, useTema } from '../theme';
import { caracteristicasVacias, LuminariaBorrador } from '../types';
import type { RootStackParams } from '../navigation';

const RANURAS = [
  { titulo: 'General', ayuda: 'La luminaria completa, con el poste y el brazo' },
  { titulo: 'Placa / etiqueta', ayuda: 'Acércate a la placa con marca, modelo y potencia' },
  { titulo: 'Fotocelda', ayuda: 'El receptáculo de la fotocelda, para contar sus pines' },
];

export function CapturarScreen() {
  const { c } = useTema();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { proyecto } = useApp();
  const [fotos, setFotos] = useState<(Foto | null)[]>([null, null, null]);
  const [pos, setPos] = useState<(Posicion & { exif?: boolean }) | null>(null);
  const [buscandoGps, setBuscandoGps] = useState(true);
  const [fase, setFase] = useState<string | null>(null);

  const refrescarGps = useCallback(async () => {
    setBuscandoGps(true);
    setPos(await obtenerPosicion());
    setBuscandoGps(false);
  }, []);
  useEffect(() => { refrescarGps(); }, [refrescarGps]);

  const poner = async (i: number, origen: 'camara' | 'galeria') => {
    try {
      const f = await tomarFoto(origen);
      if (!f) return;
      setFotos((p) => p.map((x, j) => (j === i ? f : x)));
      if (origen === 'galeria' && f.exifLat != null && f.exifLng != null) {
        setPos({ latitud: f.exifLat, longitud: f.exifLng, precisionM: null, exif: true });
      }
    } catch (e: any) { Alert.alert('Foto', e.message ?? String(e)); }
  };

  const elegir = (i: number) =>
    Alert.alert(RANURAS[i].titulo, RANURAS[i].ayuda, [
      { text: 'Cámara', onPress: () => poner(i, 'camara') },
      { text: 'Galería', onPress: () => poner(i, 'galeria') },
      ...(fotos[i] ? [{ text: 'Quitar', style: 'destructive' as const, onPress: () => setFotos((p) => p.map((x, j) => (j === i ? null : x))) }] : []),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);

  const tomadas = fotos.filter((f): f is Foto => !!f);

  const continuar = async (conIA: boolean) => {
    if (!tomadas.length || !proyecto) return;
    let aviso = '';
    let car = caracteristicasVacias();
    let confianza: LuminariaBorrador['confianza'] = '';
    try {
      if (conIA) {
        setFase('Analizando la luminaria con IA…');
        try {
          const r = await analizarFotos(tomadas.map((f) => f.base64));
          car = r.caracteristicas; confianza = r.confianza;
        } catch (e: any) { aviso += `${e.message ?? 'No se pudo analizar la foto.'} `; }
      }
      setFase('Guardando fotos…');
      const uris = tomadas.map((f) => persistirFoto(f.uri));
      const p = pos;
      if (!p) aviso += 'No se obtuvo la coordenada: ingrésala manualmente. ';
      const ahora = new Date().toISOString();
      const tecnico = (await cargarAjustes()).tecnico;
      const borrador: LuminariaBorrador = {
        ...car, uuid: nuevoUuid(), proyectoId: proyecto.id, creadoEn: ahora, actualizadoEn: ahora, fotos: uris, confianza,
        latitud: p?.latitud ?? null, longitud: p?.longitud ?? null, precisionM: p?.precisionM ?? null,
        direccion: p ? await direccionDe(p.latitud, p.longitud) : '', codigo: '', tecnico,
      };
      exito();
      nav.replace('Editar', { borrador, aviso: aviso.trim() || undefined });
    } finally { setFase(null); }
  };

  const s = useMemo(() => StyleSheet.create({
    slot: { flex: 1, aspectRatio: 0.85, borderRadius: radius, borderWidth: 1.5, borderColor: c.border, borderStyle: 'dashed', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    gps: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, marginBottom: 16 },
  }), [c]);

  const calidadGps = pos?.precisionM == null ? null : pos.precisionM <= 10 ? c.ok : pos.precisionM <= 30 ? c.warn : c.danger;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ color: c.muted, lineHeight: 20, marginBottom: 14 }}>
        Con una foto general basta. Si añades la <Text style={{ color: c.text, fontWeight: '700' }}>placa</Text> y la <Text style={{ color: c.text, fontWeight: '700' }}>fotocelda</Text>, la IA identifica mucho mejor marca, potencia y pines.
      </Text>

      <View style={s.gps}>
        {buscandoGps ? <ActivityIndicator color={c.primary} /> : <Ionicons name="location" size={22} color={calidadGps ?? c.muted} />}
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '700' }}>
            {buscandoGps ? 'Buscando señal GPS…' : pos ? `${pos.latitud.toFixed(6)}, ${pos.longitud.toFixed(6)}` : 'Sin coordenada'}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {pos?.exif ? 'Tomada de los datos de la foto' : pos?.precisionM != null ? `Precisión ≈ ${Math.round(pos.precisionM)} m` : 'Activa la ubicación del teléfono'}
          </Text>
        </View>
        <Pressable onPress={() => { toque(); refrescarGps(); }} accessibilityRole="button" accessibilityLabel="Actualizar GPS" hitSlop={10}>
          <Ionicons name="refresh" size={22} color={c.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {RANURAS.map((r, i) => (
          <View key={r.titulo} style={{ flex: 1 }}>
            <Pressable onPress={() => { toque(); elegir(i); }} style={s.slot} accessibilityRole="button" accessibilityLabel={`Foto ${r.titulo}`}>
              {fotos[i] ? <Image source={{ uri: fotos[i]!.uri }} style={{ width: '100%', height: '100%' }} /> : (
                <><Ionicons name={i === 0 ? 'camera' : i === 1 ? 'document-text-outline' : 'sunny-outline'} size={30} color={c.primary} />
                  <Text style={{ color: c.muted, fontSize: 11, marginTop: 4 }}>Añadir</Text></>
              )}
            </Pressable>
            <Text style={{ color: c.text, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 6 }}>{r.titulo}</Text>
          </View>
        ))}
      </View>

      <Button title="Analizar con IA" icon={<Ionicons name="sparkles" size={20} color={c.primaryText} />} onPress={() => continuar(true)}
        disabled={!tomadas.length} style={{ marginTop: 24 }} />
      <Button title="Llenar manualmente" variant="secondary" onPress={() => continuar(false)} disabled={!tomadas.length} style={{ marginTop: 10 }} />

    </ScrollView>
      {fase && (
        <View style={{ ...StyleSheet.absoluteFill, backgroundColor: c.overlay, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={{ color: c.text, fontSize: 17, fontWeight: "600" }}>{fase}</Text>
        </View>
      )}
    </View>
  );
}
