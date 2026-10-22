import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './ui';
import { useJornada } from '../context/JornadaContext';
import { haAceptado, registrarConsentimiento } from '../services/jornada';
import { cargarAjustes } from '../services/settings';
import { useTema } from '../theme';

const hora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const AVISO =
  'Mientras la jornada esté ACTIVA y la app abierta, tu empresa recibirá tu ubicación aproximada, la hora y cuántas luminarias llevas, cada 5 minutos.\n\n' +
  '• Al pausar o terminar, se deja de enviar tu ubicación.\n' +
  '• Fuera de la jornada tu ubicación no se comparte.\n' +
  '• Verás siempre que la jornada está activa.\n\n¿Aceptas?';

export function TarjetaJornada() {
  const { c } = useTema();
  const { estado, ultimoEnvio, iniciar, pausar, reanudar, terminar } = useJornada();
  const [ocupado, setOcupado] = useState(false);
  if (!estado) return null;

  const correr = async (f: () => Promise<void>) => { setOcupado(true); try { await f(); } finally { setOcupado(false); } };

  const empezar = async () => {
    if (!(await cargarAjustes()).syncUrl) {
      Alert.alert('Jornada', 'Tu empresa aún no ha configurado el servidor de sincronización. Importa tu enlace de configuración en Ajustes.');
      return;
    }
    const lanzar = () => correr(iniciar);
    if (await haAceptado()) { lanzar(); return; }
    Alert.alert('Aviso de ubicación', AVISO, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Acepto', onPress: async () => { await registrarConsentimiento(); lanzar(); } },
    ]);
  };

  const confirmarFin = () => Alert.alert('Terminar jornada', '¿Terminar la jornada? Se dejará de enviar tu ubicación.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Terminar', style: 'destructive', onPress: () => correr(terminar) },
  ]);

  const enJornada = estado.fase === 'activa' || estado.fase === 'pausada';
  const activa = estado.fase === 'activa';
  const minutos = ultimoEnvio ? Math.max(0, Math.round((Date.now() - ultimoEnvio.getTime()) / 60000)) : null;

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: activa ? c.ok : c.border, backgroundColor: c.surface }}>
      {!enJornada ? (
        <Button title="Iniciar jornada" variant="secondary" loading={ocupado} onPress={empezar}
          icon={<Ionicons name="play-circle-outline" size={20} color={c.text} />} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: activa ? c.ok : c.warn }} />
            <Text style={{ color: c.text, fontWeight: '700', flex: 1 }}>
              {activa ? 'Jornada activa' : 'Jornada en pausa'} · desde {hora(estado.inicio)}
            </Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>
            {activa
              ? `Mantén la app abierta. ${minutos != null ? `Última señal enviada hace ${minutos} min.` : 'Enviando primera señal…'}`
              : 'En pausa: no se envía tu ubicación.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Button title={activa ? 'Pausar' : 'Reanudar'} variant="secondary" loading={ocupado} style={{ flex: 1 }} onPress={() => correr(activa ? pausar : reanudar)} />
            <Button title="Terminar" variant="danger" style={{ flex: 1 }} onPress={confirmarFin} />
          </View>
        </>
      )}
      {estado.fase === 'terminada' && estado.sinEnviar && (
        <Text style={{ color: c.warn, fontSize: 12, marginTop: 8 }}>El cierre de la jornada se enviará cuando haya conexión.</Text>
      )}
    </View>
  );
}
