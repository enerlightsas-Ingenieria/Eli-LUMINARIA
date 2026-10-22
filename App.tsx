import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ListScreen } from './src/screens/ListScreen';
import { EditScreen } from './src/screens/EditScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { actualizar, borrar, insertar, listar } from './src/services/db';
import { analizarFoto } from './src/services/analyzer';
import { direccionDe, obtenerPosicion, tomarFoto } from './src/services/captura';
import { exportarCsv } from './src/services/exporter';
import { colors } from './src/theme';
import { caracteristicasVacias, Luminaria, LuminariaBorrador } from './src/types';

type Vista =
  | { name: 'lista' }
  | { name: 'ajustes' }
  | { name: 'editar'; item: LuminariaBorrador & { id?: number }; aviso?: string };

export default function App() {
  const [vista, setVista] = useState<Vista>({ name: 'lista' });
  const [items, setItems] = useState<Luminaria[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  const refrescar = useCallback(async () => setItems(await listar()), []);
  useEffect(() => { refrescar(); }, [refrescar]);

  // Botón atrás de Android: volver a la lista
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (vista.name !== 'lista') { setVista({ name: 'lista' }); return true; }
      return false;
    });
    return () => sub.remove();
  }, [vista.name]);

  const nueva = () =>
    Alert.alert('Nueva luminaria', 'Elige el origen de la foto', [
      { text: 'Cámara', onPress: () => procesar('camara') },
      { text: 'Galería', onPress: () => procesar('galeria') },
      { text: 'Cancelar', style: 'cancel' },
    ]);

  const procesar = async (origen: 'camara' | 'galeria') => {
    try {
      const foto = await tomarFoto(origen);
      if (!foto) return;

      setOcupado('Obteniendo coordenada…');
      let pos = await obtenerPosicion();
      let aviso = '';
      if (origen === 'galeria' && foto.exifLat != null && foto.exifLng != null) {
        pos = { latitud: foto.exifLat, longitud: foto.exifLng, precisionM: null }; // GPS embebido en la foto
      } else if (origen === 'galeria') {
        aviso += 'La foto de galería no trae GPS; se usó tu ubicación actual. Ajusta la coordenada si es necesario. ';
      }
      if (!pos) aviso += 'No se pudo obtener la coordenada: ingrésala manualmente. ';
      const direccion = pos ? await direccionDe(pos.latitud, pos.longitud) : '';

      setOcupado('Analizando luminaria con IA…');
      let car = caracteristicasVacias();
      let confianza: LuminariaBorrador['confianza'] = '';
      try {
        const r = await analizarFoto(foto.base64);
        car = r.caracteristicas;
        confianza = r.confianza;
      } catch (e: any) {
        aviso += `${e.message ?? 'No se pudo analizar la foto.'} `;
      }

      setVista({
        name: 'editar',
        aviso: aviso.trim() || undefined,
        item: {
          ...car, creadoEn: new Date().toISOString(), fotoUri: foto.uri, confianza, direccion,
          latitud: pos?.latitud ?? null, longitud: pos?.longitud ?? null, precisionM: pos?.precisionM ?? null,
        },
      });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setOcupado(null);
    }
  };

  const guardar = async (l: LuminariaBorrador & { id?: number }) => {
    if (l.id) await actualizar(l as Luminaria); else await insertar(l);
    await refrescar();
    setVista({ name: 'lista' });
  };

  const exportar = async () => {
    setExportando(true);
    try { await exportarCsv(items); } catch (e: any) { Alert.alert('No se pudo exportar', e.message ?? String(e)); }
    finally { setExportando(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      {vista.name === 'lista' && (
        <ListScreen items={items} onNew={nueva} onOpen={(l) => setVista({ name: 'editar', item: l })}
          onExport={exportar} exporting={exportando} onSettings={() => setVista({ name: 'ajustes' })} />
      )}
      {vista.name === 'editar' && (
        <EditScreen
          key={vista.item.id ?? 'nuevo'}
          inicial={vista.item}
          aviso={vista.aviso}
          onSave={guardar}
          onCancel={() => setVista({ name: 'lista' })}
          onDelete={vista.item.id ? async () => { await borrar(vista.item.id!); await refrescar(); setVista({ name: 'lista' }); } : undefined}
        />
      )}
      {vista.name === 'ajustes' && <SettingsScreen onClose={() => setVista({ name: 'lista' })} />}

      {ocupado && (
        <View style={s.overlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.overlayT}>{ocupado}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,27,45,0.92)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  overlayT: { color: colors.text, fontSize: 17, fontWeight: '600' },
});
