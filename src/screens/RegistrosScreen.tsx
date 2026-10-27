import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cabecera } from '../components/Cabecera';
import { TarjetaJornada } from '../components/TarjetaJornada';
import { Chip, exito, HojaAcciones, toque } from '../components/ui';
import { useApp } from '../context/AppContext';
import { borrarLuminaria } from '../services/db';
import { borrarFotos } from '../services/fotos';
import { exportar, Formato } from '../services/exporter';
import { resumenSync, sincronizar } from '../services/sync';
import { cargarAjustes } from '../services/settings';
import { confianzaColor, radius, useTema } from '../theme';
import { Luminaria } from '../types';
import type { RootStackParams } from '../navigation';

type Filtro = 'todas' | 'pendientes' | 'sinGps';

export function RegistrosScreen({ irAProyectos }: { irAProyectos: () => void }) {
  const { c } = useTema();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { items, proyecto, refrescar } = useApp();
  const { bottom } = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [ocupado, setOcupado] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [menuExportar, setMenuExportar] = useState(false);

  const pendientes = items.filter((l) => !l.sincronizado).length;
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((l) => {
      if (filtro === 'pendientes' && l.sincronizado) return false;
      if (filtro === 'sinGps' && l.latitud != null) return false;
      if (!t) return true;
      return [l.codigo, l.codigoPoste, l.fabricante, l.tecnologia, l.direccion, String(l.id)]
        .some((x) => x.toLowerCase().includes(t));
    });
  }, [items, q, filtro]);

  const opcionesExportar = (['csv', 'geojson', 'kml'] as Formato[]).map((f) => ({
    texto: f === 'csv' ? 'CSV (Excel)' : f === 'geojson' ? 'GeoJSON (QGIS / ArcGIS)' : 'KML (Google Earth)',
    onPress: async () => {
      try { await exportar(f, items, proyecto ?? undefined); } catch (e: any) { Alert.alert('No se pudo exportar', e.message ?? String(e)); }
    },
  }));

  const sync = async () => {
    if (!proyecto) return;
    const a = await cargarAjustes();
    if (!a.syncUrl) {
      Alert.alert('Sincronización', 'Aún no has configurado el destino (Google Sheets o servidor). Hazlo en Ajustes → Sincronización.');
      return;
    }
    setOcupado(true);
    try {
      const r = await sincronizar(proyecto);
      await refrescar();
      exito();
      Alert.alert('Sincronizado', resumenSync(r));
    } catch (e: any) {
      Alert.alert('No se pudo sincronizar', e.message ?? String(e));
    } finally { setOcupado(false); }
  };

  const confirmarBorrado = (l: Luminaria) =>
    Alert.alert('Eliminar', `¿Eliminar la luminaria #${l.id}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        await borrarLuminaria(l); borrarFotos(l.fotos); await refrescar();
      } },
    ]);

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, marginHorizontal: 16, paddingHorizontal: 12 },
    input: { flex: 1, color: c.text, paddingVertical: 10, fontSize: 16 },
    card: { flexDirection: 'row', gap: 12, backgroundColor: c.surface, borderRadius: radius, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: c.border },
    thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: c.surfaceAlt },
    t: { color: c.text, fontSize: 16, fontWeight: '700' }, sub: { color: c.muted, marginTop: 3 },
    coord: { color: c.primary, marginTop: 3, fontSize: 12 },
    fab: { position: 'absolute', right: 20, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 30, paddingHorizontal: 22, paddingVertical: 16, elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  }), [c]);

  return (
    <View style={s.root}>
      <Cabecera titulo="ELI-LUMINARIA" subtitulo={proyecto ? `${proyecto.nombre} · ${items.length} luminarias` : ' '} onSubtitulo={irAProyectos}
        acciones={[
          { icono: 'cloud-upload-outline', etiqueta: 'Sincronizar', onPress: sync, badge: pendientes },
          { icono: 'share-outline', etiqueta: 'Exportar', onPress: () => setMenuExportar(true) },
        ]} />
      <TarjetaJornada />
      <View style={s.search}>
        <Ionicons name="search" size={18} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Buscar fabricante, código, dirección…" placeholderTextColor={c.muted} style={s.input} accessibilityLabel="Buscar" />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
        {([['todas', 'Todas'], ['pendientes', `Sin sincronizar (${pendientes})`], ['sinGps', 'Sin coordenada']] as [Filtro, string][]).map(([f, t]) => (
          <Pressable key={f} onPress={() => { toque(); setFiltro(f); }} accessibilityRole="button" accessibilityState={{ selected: filtro === f }}>
            <Chip text={t} color={filtro === f ? c.primary : undefined} />
          </Pressable>
        ))}
      </View>

      <FlatList
        data={visibles}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 + bottom }}
        refreshControl={<RefreshControl refreshing={refrescando || ocupado} tintColor={c.primary} onRefresh={async () => {
          setRefrescando(true);
          try { if (proyecto && (await cargarAjustes()).syncUrl) await sincronizar(proyecto); } catch { /* sin señal: se muestra lo local */ }
          await refrescar();
          setRefrescando(false);
        }} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Ionicons name="bulb-outline" size={64} color={c.primary} />
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '700', marginTop: 12 }}>{items.length ? 'Sin resultados' : 'Aún no hay luminarias'}</Text>
            <Text style={{ color: c.muted, textAlign: 'center', marginTop: 6, paddingHorizontal: 30, lineHeight: 20 }}>
              {items.length ? 'Prueba con otro texto o filtro.' : 'Toma una foto y la app identificará fabricante, tecnología, potencia, fotocelda y más, junto con la coordenada.'}
            </Text>
          </View>
        }
        renderItem={({ item: l }) => (
          <Pressable onPress={() => nav.navigate('Editar', { id: l.id })} onLongPress={() => confirmarBorrado(l)} style={s.card}
            accessibilityRole="button" accessibilityLabel={`Luminaria ${l.id}, ${l.fabricante}`}>
            {l.fotos[0] ? <Image source={{ uri: l.fotos[0] }} style={s.thumb} /> : <View style={s.thumb} />}
            <View style={{ flex: 1 }}>
              <Text style={s.t} numberOfLines={1}>{l.codigo || `#${l.id}`} · {l.fabricante || 'Sin identificar'}</Text>
              <Text style={s.sub} numberOfLines={1}>
                {[l.tecnologia, l.potenciaW && `${l.potenciaW} W`, l.fotocelda === 'Sí' && 'con fotocelda'].filter(Boolean).join(' · ') || '—'}
              </Text>
              {!!l.tecnico && <Text style={[s.sub, { fontSize: 12 }]} numberOfLines={1}>Por {l.tecnico}</Text>}
              <Text style={s.coord} numberOfLines={1}>
                {l.latitud != null ? `📍 ${l.latitud.toFixed(6)}, ${l.longitud?.toFixed(6)}` : '📍 sin coordenada'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                {!!l.confianza && <Chip text={`IA ${l.confianza}`} color={confianzaColor(c, l.confianza)} />}
                {!l.sincronizado && <Chip text="Pendiente" color={c.warn} />}
              </View>
            </View>
          </Pressable>
        )}
      />

      <HojaAcciones visible={menuExportar} onClose={() => setMenuExportar(false)} titulo="Exportar proyecto" subtitulo={`${items.length} luminarias`} opciones={opcionesExportar} />
      <Pressable onPress={() => { toque(); nav.navigate('Capturar'); }} style={[s.fab, { bottom: 16 + bottom * 0 }]} accessibilityRole="button" accessibilityLabel="Nueva luminaria">
        <Ionicons name="camera" size={24} color={c.primaryText} />
        <Text style={{ color: c.primaryText, fontWeight: '800', fontSize: 16 }}>Nueva</Text>
      </Pressable>
    </View>
  );
}
