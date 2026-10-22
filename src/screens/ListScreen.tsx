import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Chip } from '../components/ui';
import { colors, radius } from '../theme';
import { Luminaria } from '../types';

export function ListScreen({
  items, onNew, onOpen, onExport, onSettings, exporting,
}: {
  items: Luminaria[]; onNew: () => void; onOpen: (l: Luminaria) => void;
  onExport: () => void; onSettings: () => void; exporting: boolean;
}) {
  return (
    <View style={s.root}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>ELI-LUMINARIA</Text>
          <Text style={s.sub}>{items.length} luminaria{items.length === 1 ? '' : 's'} registrada{items.length === 1 ? '' : 's'}</Text>
        </View>
        <Pressable onPress={onSettings} hitSlop={12}><Text style={s.gear}>⚙︎</Text></Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 80 }}>
            <Text style={{ fontSize: 56 }}>💡</Text>
            <Text style={s.emptyT}>Aún no hay luminarias</Text>
            <Text style={s.emptyS}>Toma una foto y la app identificará marca, tecnología, potencia, fotocelda y más, junto con la coordenada.</Text>
          </View>
        }
        renderItem={({ item: l }) => (
          <Pressable onPress={() => onOpen(l)} style={s.card}>
            <Image source={{ uri: l.fotoUri }} style={s.thumb} />
            <View style={{ flex: 1 }}>
              <Text style={s.cardT} numberOfLines={1}>
                #{l.id} · {[l.marca, l.modelo].filter(Boolean).join(' ') || 'Sin identificar'}
              </Text>
              <Text style={s.cardS} numberOfLines={1}>
                {[l.tecnologia, l.potenciaW && `${l.potenciaW} W`, l.pinesFotocelda && `fotocelda ${l.pinesFotocelda}p`]
                  .filter(Boolean).join(' · ') || l.tipoLuminaria || '—'}
              </Text>
              <Text style={s.coord} numberOfLines={1}>
                {l.latitud != null ? `📍 ${l.latitud.toFixed(6)}, ${l.longitud?.toFixed(6)}` : '📍 sin coordenada'}
              </Text>
              {!!l.confianza && (
                <View style={{ flexDirection: 'row', marginTop: 6 }}>
                  <Chip text={`IA ${l.confianza}`} color={l.confianza === 'alta' ? colors.ok : l.confianza === 'media' ? colors.warn : colors.danger} />
                </View>
              )}
            </View>
          </Pressable>
        )}
      />

      <View style={s.bar}>
        <Button title="Exportar CSV" variant="secondary" onPress={onExport} disabled={!items.length} loading={exporting} style={{ flex: 1 }} />
        <Button title="📷  Nueva" onPress={onNew} style={{ flex: 1.4 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.primary, fontSize: 24, fontWeight: '800', letterSpacing: 1 },
  sub: { color: colors.muted, marginTop: 2 },
  gear: { color: colors.text, fontSize: 28 },
  card: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: radius, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  cardT: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardS: { color: colors.muted, marginTop: 3 },
  coord: { color: colors.primary, marginTop: 3, fontSize: 12 },
  emptyT: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 12 },
  emptyS: { color: colors.muted, textAlign: 'center', marginTop: 6, paddingHorizontal: 30, lineHeight: 20 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, padding: 16, paddingBottom: 28, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
});
