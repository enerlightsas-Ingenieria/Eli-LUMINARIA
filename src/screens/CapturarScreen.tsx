import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Button, exito, HojaAcciones, toque } from '../components/ui';
import { useEmpezarJornada } from '../components/TarjetaJornada';
import { useApp } from '../context/AppContext';
import { useJornada } from '../context/JornadaContext';
import { evaluarCaptura, galeriaPermitida } from '../lib/politicas';
import { analizarFotos } from '../services/analyzer';
import { direccionDe, Foto, obtenerPosicion, Posicion, tomarFoto } from '../services/captura';
import { nuevoUuid } from '../services/db';
import { cargarAjustes } from '../services/settings';
import { persistirFoto } from '../services/fotos';
import { hayConexion } from '../services/red';
import { radius, useTema } from '../theme';
import { caracteristicasVacias, LuminariaBorrador } from '../types';
import type { RootStackParams } from '../navigation';

const RANURAS = [
  { titulo: 'General', ayuda: 'La luminaria completa, con el poste y el brazo' },
  { titulo: 'Placa / etiqueta', ayuda: 'Acércate a la placa con fabricante, modelo y potencia' },
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
  const [hoja, setHoja] = useState<number | null>(null);
  const [avisoGps, setAvisoGps] = useState('');
  const cancelar = useRef<AbortController | null>(null);
  const { estado, reanudar } = useJornada();
  const { empezar, ocupado: iniciando } = useEmpezarJornada();
  // null = ajustes aún sin cargar: hasta entonces no se muestra nada (evita que el modo terceros esté "abierto" unos instantes)
  const [cfgCargada, setCfg] = useState<{ modoTerceros: boolean; precisionMaxM: number } | null>(null);
  const cfg = cfgCargada ?? { modoTerceros: true, precisionMaxM: 20 };
  useEffect(() => { cargarAjustes().then((a) => setCfg({ modoTerceros: a.modoTerceros, precisionMaxM: a.precisionMaxM })); }, []);
  const jornadaActiva = estado?.fase === 'activa';

  const refrescarGps = useCallback(async () => {
    setBuscandoGps(true);
    setPos(await obtenerPosicion());
    setBuscandoGps(false);
  }, []);
  useEffect(() => { refrescarGps(); }, [refrescarGps]);

  // Reglas del modo terceros (jornada activa, GPS preciso, sin ubicación simulada)
  const evaluacion = evaluarCaptura({ modoTerceros: cfg.modoTerceros, jornadaActiva, posicion: buscandoGps ? null : pos, precisionMaxM: cfg.precisionMaxM });

  // Si falta precisión, reintenta el GPS solo cada 4 s hasta lograrla.
  // (dependencias primitivas: un objeto nuevo en cada render reiniciaría el temporizador sin llegar nunca a reintentar)
  const motivo = evaluacion.ok ? null : evaluacion.motivo;
  useEffect(() => {
    if (!cfgCargada?.modoTerceros || !jornadaActiva || buscandoGps) return;
    if (motivo !== 'SIN_GPS' && motivo !== 'GPS_IMPRECISO') return;
    const t = setTimeout(refrescarGps, 4000);
    return () => clearTimeout(t);
  }, [cfgCargada, jornadaActiva, buscandoGps, motivo, refrescarGps]);

  const poner = async (i: number, origen: 'camara' | 'galeria') => {
    if (origen === 'galeria' && !galeriaPermitida(cfg.modoTerceros)) return;
    try {
      const f = await tomarFoto(origen);
      if (!f) return;
      setFotos((p) => p.map((x, j) => (j === i ? f : x)));
      if (origen === 'galeria') {
        if (f.exifLat != null && f.exifLng != null) {
          setPos({ latitud: f.exifLat, longitud: f.exifLng, precisionM: null, exif: true });
          setAvisoGps('');
        } else {
          // En Android, las fotos de galería suelen venir sin GPS: la coordenada será donde estás ahora.
          setAvisoGps('La foto de galería no trae GPS: se usará tu ubicación actual. Corrígela en el formulario si hace falta.');
        }
      }
    } catch (e: any) { Alert.alert('Foto', e.message ?? String(e)); }
  };

  const quitar = (i: number) => setFotos((p) => p.map((x, j) => (j === i ? null : x)));

  const tomadas = fotos.filter((f): f is Foto => !!f);

  const continuar = async (conIA: boolean) => {
    if (!tomadas.length || !proyecto) return;
    // En modo terceros se vuelve a medir el GPS justo ahora: no basta con la lectura de hace un rato.
    let posFinal = pos;
    if (cfg.modoTerceros) {
      setFase('Verificando ubicación…');
      posFinal = await obtenerPosicion('alta');
      setFase(null);
      const v = evaluarCaptura({ modoTerceros: true, jornadaActiva, posicion: posFinal, precisionMaxM: cfg.precisionMaxM });
      if (!v.ok) { setPos(posFinal); Alert.alert('No se puede capturar', v.mensaje); return; }
    }
    let aviso = '';
    let car = caracteristicasVacias();
    let confianza: LuminariaBorrador['confianza'] = '';
    try {
      if (conIA && !(await hayConexion())) {
        aviso += 'Sin conexión: llena los datos a mano (puedes usar las opciones rápidas). Con señal, toca "Re-analizar con IA". ';
      } else if (conIA) {
        setFase('Analizando la luminaria con IA…');
        cancelar.current = new AbortController();
        try {
          const r = await analizarFotos(tomadas.map((f) => f.base64), cancelar.current.signal);
          car = r.caracteristicas; confianza = r.confianza;
        } catch (e: any) { aviso += `${e.message ?? 'No se pudo analizar la foto.'} `; }
        cancelar.current = null;
      }
      setFase('Guardando fotos…');
      const uris = tomadas.map((f) => persistirFoto(f.uri));
      const p = posFinal;
      if (!p) aviso += 'No se obtuvo la coordenada: ingrésala manualmente. ';
      if (avisoGps) aviso += `${avisoGps} `;
      const ahora = new Date().toISOString();
      const tecnico = (await cargarAjustes()).tecnico;
      const borrador: LuminariaBorrador = {
        ...car, uuid: nuevoUuid(), proyectoId: proyecto.id, creadoEn: ahora, actualizadoEn: ahora, fotos: uris, confianza,
        latitud: p?.latitud ?? null, longitud: p?.longitud ?? null, precisionM: p?.precisionM ?? null,
        direccion: p ? await direccionDe(p.latitud, p.longitud) : '', sector: '', codigoPoste: '', codigo: '', tecnico,
        origen: tomadas.some((f) => f.origen === 'galeria') ? 'galeria' : 'camara',
        ubicacionSimulada: !!p?.simulada,
        jornadaId: jornadaActiva ? estado!.id : '',
      };
      exito();
      nav.replace('Editar', { borrador, aviso: aviso.trim() || undefined });
    } finally { setFase(null); }
  };

  const s = useMemo(() => StyleSheet.create({
    slot: { flex: 1, aspectRatio: 0.85, borderRadius: radius, borderWidth: 1.5, borderColor: c.border, borderStyle: 'dashed', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    gps: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, marginBottom: 16 },
  }), [c]);

  if (!cfgCargada) {
    return <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.primary} /></View>;
  }

  // Puerta del modo terceros: sin jornada activa no se puede capturar
  if (cfg.modoTerceros && !jornadaActiva) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 16 }}>
        <Ionicons name="time-outline" size={56} color={c.primary} style={{ alignSelf: 'center' }} />
        <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>Inicia tu jornada para capturar</Text>
        <Text style={{ color: c.muted, textAlign: 'center', lineHeight: 20 }}>
          Las luminarias se registran durante la jornada de trabajo. Al iniciarla, tu empresa recibe tu ubicación solo mientras esté activa y la app abierta.
        </Text>
        {estado?.fase === 'pausada'
          ? <Button title="Reanudar jornada" onPress={() => reanudar()} />
          : <Button title="Iniciar jornada" loading={iniciando} onPress={empezar} />}
      </View>
    );
  }

  const calidadGps = pos?.precisionM == null ? null : pos.precisionM <= 10 ? c.ok : pos.precisionM <= 30 ? c.warn : c.danger;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ color: c.muted, lineHeight: 20, marginBottom: 14 }}>
        Con una foto general basta. Si añades la <Text style={{ color: c.text, fontWeight: '700' }}>placa</Text> y la <Text style={{ color: c.text, fontWeight: '700' }}>fotocelda</Text>, la IA identifica mucho mejor fabricante, potencia y pines.
      </Text>

      {cfg.modoTerceros && !evaluacion.ok && <Text style={{ color: c.warn, marginBottom: 10, lineHeight: 19 }}>{evaluacion.mensaje}</Text>}
      {!!avisoGps && <Text style={{ color: c.warn, marginBottom: 10, lineHeight: 19 }}>{avisoGps}</Text>}
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
            <Pressable onPress={() => { toque(); setHoja(i); }} style={s.slot} accessibilityRole="button" accessibilityLabel={`Foto ${r.titulo}`}>
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
        disabled={!tomadas.length || !evaluacion.ok} style={{ marginTop: 24 }} />
      <Button title="Llenar manualmente" variant="secondary" onPress={() => continuar(false)} disabled={!tomadas.length || !evaluacion.ok} style={{ marginTop: 10 }} />

    </ScrollView>
      {fase && (
        <View style={{ ...StyleSheet.absoluteFill, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>{fase}</Text>
          {fase.startsWith('Analizando') && (
            <Button title="Omitir y llenar manualmente" variant="secondary" onPress={() => cancelar.current?.abort()} style={{ marginTop: 8 }} />
          )}
        </View>
      )}
      <HojaAcciones visible={hoja !== null} onClose={() => setHoja(null)} titulo={hoja !== null ? RANURAS[hoja].titulo : ''}
        subtitulo={hoja !== null ? RANURAS[hoja].ayuda : undefined}
        opciones={hoja === null ? [] : [
          { texto: 'Cámara', onPress: () => poner(hoja, 'camara') },
          ...(galeriaPermitida(cfg.modoTerceros) ? [{ texto: 'Galería', onPress: () => poner(hoja, 'galeria') }] : []),
          ...(fotos[hoja] ? [{ texto: 'Quitar foto', destructivo: true, onPress: () => quitar(hoja) }] : []),
        ]} />
    </View>
  );
}
