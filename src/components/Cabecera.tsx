import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { toque } from './ui';
import { useTema } from '../theme';

export interface Accion { icono: keyof typeof Ionicons.glyphMap; etiqueta: string; onPress: () => void; badge?: number }

export function Cabecera({ titulo, subtitulo, acciones = [], onSubtitulo }: {
  titulo: string; subtitulo?: string; acciones?: Accion[]; onSubtitulo?: () => void;
}) {
  const { c } = useTema();
  const { top } = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: top + 8, paddingHorizontal: 18, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={{ color: c.primary, fontSize: 22, fontWeight: '800', letterSpacing: 0.5 }}>{titulo}</Text>
        {!!subtitulo && (
          <Pressable onPress={onSubtitulo} disabled={!onSubtitulo} accessibilityRole={onSubtitulo ? 'button' : 'text'}>
            <Text numberOfLines={1} style={{ color: c.muted, marginTop: 2 }}>{subtitulo}{onSubtitulo ? '  ▾' : ''}</Text>
          </Pressable>
        )}
      </View>
      {acciones.map((a) => (
        <Pressable key={a.etiqueta} accessibilityRole="button" accessibilityLabel={a.etiqueta} hitSlop={8}
          onPress={() => { toque(); a.onPress(); }} style={{ padding: 8, marginLeft: 2 }}>
          <Ionicons name={a.icono} size={24} color={c.text} />
          {!!a.badge && (
            <View style={{ position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <Text style={{ color: c.primaryText, fontSize: 11, fontWeight: '800' }}>{a.badge > 99 ? '99+' : a.badge}</Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}
