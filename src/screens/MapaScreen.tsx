import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Cabecera } from '../components/Cabecera';
import { toque } from '../components/ui';
import { useApp } from '../context/AppContext';
import { coordenadaValida } from '../lib/geo';
import { MAPA_HTML, PuntoMapa } from '../lib/mapHtml';
import { obtenerPosicion } from '../services/captura';
import { useTema } from '../theme';
import type { RootStackParams } from '../navigation';

export function MapaScreen() {
  const { c } = useTema();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { items, proyecto } = useApp();
  const web = useRef<any>(null);
  const [listo, setListo] = useState(false);

  const puntos = useMemo<PuntoMapa[]>(() => items
    .filter((l) => coordenadaValida(l.latitud, l.longitud))
    .map((l) => ({
      id: l.id, lat: l.latitud!, lng: l.longitud!, tec: l.tecnologia,
      titulo: l.codigo || l.codigoPoste || [l.fabricante, l.modelo].filter(Boolean).join(' ') || `Luminaria #${l.id}`,
      detalle: [l.tecnologia, l.potenciaW && `${l.potenciaW} W`].filter(Boolean).join(' · '),
    })), [items]);

  const enviar = useCallback((fit: boolean) => {
    web.current?.injectJavaScript(`window.setData && window.setData(${JSON.stringify(puntos)}, ${fit}); true;`);
  }, [puntos]);

  useEffect(() => { if (listo) enviar(true); }, [listo, enviar]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.ready) setListo(true);
      else if (m.id) nav.navigate('Editar', { id: m.id });
    } catch { /* mensaje ajeno */ }
  };

  const centrarEnMi = async () => {
    const p = await obtenerPosicion();
    if (!p) { Alert.alert('Ubicación', 'No se pudo obtener tu ubicación. Revisa el permiso de ubicación.'); return; }
    web.current?.injectJavaScript(`window.setMe && window.setMe(${p.latitud}, ${p.longitud}); true;`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Cabecera titulo="Mapa" subtitulo={`${proyecto?.nombre ?? ''} · ${puntos.length} con coordenada`}
        acciones={[{ icono: 'scan-outline', etiqueta: 'Ajustar a todas', onPress: () => enviar(true) }]} />
      <View style={{ flex: 1 }}>
        <WebView ref={web as any} originWhitelist={['*']} source={{ html: MAPA_HTML, baseUrl: 'https://localhost' }} onMessage={onMessage}
          javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false} style={{ backgroundColor: c.bg }} />
        <Pressable onPress={() => { toque(); centrarEnMi(); }} accessibilityRole="button" accessibilityLabel="Centrar en mi ubicación"
          style={{ position: 'absolute', right: 16, bottom: 24, width: 52, height: 52, borderRadius: 26, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', elevation: 5 }}>
          <Ionicons name="locate" size={26} color={c.primaryText} />
        </Pressable>
      </View>
    </View>
  );
}
