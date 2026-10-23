import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Cabecera } from '../components/Cabecera';
import { Button, Card, Chip, Field, Seccion } from '../components/ui';
import { useApp } from '../context/AppContext';
import { resumir } from '../lib/stats';
import { borrarProyecto, crearProyecto, editarProyecto } from '../services/db';
import { borrarFotos } from '../services/fotos';
import { useTema } from '../theme';
import { Proyecto } from '../types';

function Barras({ datos, max }: { datos: { nombre: string; cantidad: number }[]; max: number }) {
  const { c } = useTema();
  return (
    <View style={{ gap: 8 }}>
      {datos.map((d) => (
        <View key={d.nombre}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: c.text }}>{d.nombre}</Text>
            <Text style={{ color: c.muted }}>{d.cantidad}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, marginTop: 3 }}>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: c.primary, width: `${Math.max(4, (d.cantidad / max) * 100)}%` }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ProyectosScreen() {
  const { c } = useTema();
  const { proyectos, proyecto, items, activar, refrescar } = useApp();
  const [editando, setEditando] = useState<Partial<Proyecto> | null>(null);
  const r = useMemo(() => resumir(items), [items]);

  const guardar = async () => {
    if (!editando?.nombre?.trim()) { Alert.alert('Falta el nombre', 'Escribe un nombre para el proyecto.'); return; }
    if (editando.id) await editarProyecto(editando.id, editando.nombre, editando.cliente ?? '', editando.notas ?? '');
    else await activar(await crearProyecto(editando.nombre, editando.cliente ?? '', editando.notas ?? ''));
    setEditando(null);
    await refrescar();
  };

  const eliminar = (p: Proyecto) => {
    if (proyectos.length <= 1) { Alert.alert('No se puede', 'Debe existir al menos un proyecto.'); return; }
    Alert.alert('Eliminar proyecto', `Se eliminarán "${p.nombre}" y todas sus luminarias del teléfono. Esta acción no se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        borrarFotos(await borrarProyecto(p.id));
        setEditando(null);
        await activar(proyectos.find((x) => x.id !== p.id)!.id);
      } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Cabecera titulo="Proyectos" subtitulo="Agrupa tus levantamientos por zona o cliente"
        acciones={[{ icono: 'add-circle-outline', etiqueta: 'Nuevo proyecto', onPress: () => setEditando({ nombre: '', cliente: '', notas: '' }) }]} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {proyectos.map((p) => {
          const activo = p.id === proyecto?.id;
          return (
            <Pressable key={p.id} onPress={() => activar(p.id)} onLongPress={() => setEditando(p)} accessibilityRole="button"
              accessibilityLabel={`Proyecto ${p.nombre}${activo ? ', activo' : ''}`}
              style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 2, borderColor: activo ? c.primary : c.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: c.text, fontSize: 17, fontWeight: '700', flex: 1 }}>{p.nombre}</Text>
                {activo && <Chip text="Activo" color={c.primary} />}
                <Pressable onPress={() => setEditando(p)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Editar ${p.nombre}`}>
                  <Text style={{ color: c.muted, fontSize: 18 }}>✎</Text>
                </Pressable>
              </View>
              <Text style={{ color: c.muted, marginTop: 4 }}>{[p.cliente, `${p.cantidad} luminaria${p.cantidad === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</Text>
            </Pressable>
          );
        })}

        {proyecto && (
          <>
            <Seccion>{`Resumen · ${proyecto.nombre}`}</Seccion>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
                {[['Luminarias', String(r.total)], ['Con GPS', String(r.conCoordenada)], ['Carga', `${r.potenciaTotalKw.toFixed(2)} kW`], ['Sincron.', `${r.sincronizadas}/${r.total}`]].map(([k, v]) => (
                  <View key={k} style={{ alignItems: 'center', flex: 1 }}>
                    <Text style={{ color: c.primary, fontSize: 20, fontWeight: '800' }}>{v}</Text>
                    <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>{k}</Text>
                  </View>
                ))}
              </View>
              {r.total === 0 ? <Text style={{ color: c.muted }}>Aún no hay datos para este proyecto.</Text> : (
                <>
                  <Text style={{ color: c.muted, fontWeight: '600', marginBottom: 8 }}>POR TECNOLOGÍA</Text>
                  <Barras datos={r.porTecnologia} max={r.porTecnologia[0].cantidad} />
                  <Text style={{ color: c.muted, fontWeight: '600', marginTop: 16, marginBottom: 8 }}>FOTOCELDA</Text>
                  <Barras datos={r.porFotocelda} max={r.porFotocelda[0].cantidad} />
                </>
              )}
            </Card>
          </>
        )}
      </ScrollView>

      <Modal visible={!!editando} animationType="slide" transparent onRequestClose={() => setEditando(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: c.bg, padding: 18, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 34 }}>
            <Text style={{ color: c.primary, fontSize: 20, fontWeight: '800', marginBottom: 14 }}>{editando?.id ? 'Editar proyecto' : 'Nuevo proyecto'}</Text>
            <Field label="Nombre" value={editando?.nombre ?? ''} onChangeText={(t) => setEditando((e) => ({ ...e, nombre: t }))} hint="Ej. Barrio La Esperanza" />
            <Field label="Cliente / municipio" value={editando?.cliente ?? ''} onChangeText={(t) => setEditando((e) => ({ ...e, cliente: t }))} />
            <Field label="Notas" value={editando?.notas ?? ''} onChangeText={(t) => setEditando((e) => ({ ...e, notas: t }))} multiline />
            <Button title="Guardar" onPress={guardar} />
            <Button title="Cancelar" variant="secondary" onPress={() => setEditando(null)} style={{ marginTop: 8 }} />
            {!!editando?.id && <Button title="Eliminar proyecto" variant="danger" onPress={() => eliminar(editando as Proyecto)} style={{ marginTop: 8 }} />}
          </View>
        </View>
      </Modal>
    </View>
  );
}
