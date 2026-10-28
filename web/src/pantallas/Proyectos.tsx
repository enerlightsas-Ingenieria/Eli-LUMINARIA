import { useMemo, useState } from 'react';
import { rolDe } from '@compartido/core/ajustes';
import { resumenSync } from '@compartido/core/sync';
import { resumir } from '@compartido/lib/stats';
import type { Proyecto } from '@compartido/types';
import { avisar, confirmar } from '../componentes/dialogos';
import { Boton, Cabecera, Campo, Ficha, Hoja, Seccion, Tarjeta } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { borrarFotos, borrarProyecto, crearProyecto, editarProyecto } from '../servicios/almacen';
import { exportar, Formato } from '../servicios/exportar';
import { activarProyectoDelEquipo, eliminarProyectoDelEquipo, guardarProyectoDelEquipo } from '../servicios/identidad';
import { sincronizacion } from '../servicios/nucleo';

function Barras({ datos, max }: { datos: { nombre: string; cantidad: number }[]; max: number }) {
  return (
    <div className="barras">
      {datos.map((d) => (
        <div key={d.nombre}>
          <div className="barra-fila"><span>{d.nombre}</span><span className="muted">{d.cantidad}</span></div>
          <div className="barra"><i style={{ width: `${Math.max(4, (d.cantidad / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Proyectos() {
  const { proyectos, inactivos, proyecto, items, ajustes, activar, refrescar } = useApp();
  const esAdmin = rolDe(ajustes) === 'admin';
  const [sincronizando, setSincronizando] = useState(false);
  const [menuExportar, setMenuExportar] = useState(false);
  const [editando, setEditando] = useState<Partial<Proyecto> | null>(null);
  const r = useMemo(() => resumir(items), [items]);

  const guardar = async () => {
    if (!editando?.nombre?.trim()) { await avisar('Falta el nombre', 'Escribe un nombre para el proyecto.'); return; }
    const e = editando;
    if (!e.id) {   // proyecto nuevo (lo puede crear cualquier cuenta): aparece en la hoja al sincronizar su primer registro
      setEditando(null);
      await activar(await crearProyecto(e.nombre!, e.cliente ?? '', e.notas ?? ''));
      await refrescar();
      return;
    }
    if (!esAdmin) { await avisar('Sin permiso', 'Solo el administrador puede cambiar los datos de un proyecto.'); return; }
    // Nombre, cliente y notas se cambian en el servidor (la misma pestaña de la hoja): así todos los equipos reciben el cambio y no se crea ningún proyecto nuevo
    const original = [...proyectos, ...inactivos].find((x) => x.id === e.id)!;
    try {
      await guardarProyectoDelEquipo({ id: original.idHoja, nombre: original.nombre, nuevoNombre: e.nombre!.trim(), cliente: (e.cliente ?? '').trim(), notas: (e.notas ?? '').trim() });
    } catch (err: any) {
      if (!/No se encontr/.test(err?.message ?? '')) { await avisar('No se pudo guardar', `${err.message ?? err}\n\nNecesitas conexión para cambiar los datos de un proyecto.`); return; }
      await editarProyecto(e.id, e.nombre!, e.cliente ?? '', e.notas ?? '');   // todavía no existe en la hoja (sin registros enviados): solo este dispositivo
    }
    setEditando(null);
    await refrescar();
  };

  const cambiarEstado = async (p: Proyecto, activo: boolean) => {
    if (!esAdmin) { await avisar('Sin permiso', 'Solo el administrador puede activar o desactivar proyectos.'); return; }
    if (!activo && proyectos.length <= 1) { await avisar('No se puede', 'Debe quedar al menos un proyecto activo.'); return; }
    if (!activo && !(await confirmar('Desactivar proyecto', `"${p.nombre}" dejará de mostrarse a todo el equipo y no se sincronizará. Sus datos se conservan y puedes activarlo cuando quieras.`, 'Desactivar', true))) return;
    try { await activarProyectoDelEquipo({ id: p.idHoja, nombre: p.nombre }, activo); }
    catch (e: any) { await avisar('No se pudo cambiar', `${e.message ?? e}\n\nNecesitas conexión.`); return; }
    setEditando(null);
    await refrescar();
    if (!activo && proyecto?.id === p.id) await activar(proyectos.find((x) => x.id !== p.id)!.id);
  };

  const eliminar = async (p: Proyecto) => {
    if (!esAdmin) { await avisar('Sin permiso', 'Solo el administrador puede eliminar proyectos.'); return; }
    if (proyectos.length + inactivos.length <= 1) { await avisar('No se puede', 'Debe existir al menos un proyecto.'); return; }
    if (!(await confirmar('Eliminar proyecto', `Vas a eliminar "${p.nombre}" para TODO el equipo: se borran todos sus datos, su hoja en el archivo de Google y sus fotos de Drive. Si solo quieres ocultarlo, usa "Desactivar".`, 'Continuar', true))) return;
    if (!(await confirmar('¿Seguro?', `Última confirmación: "${p.nombre}" y todas sus luminarias se borrarán de todos los equipos y de la hoja. Esta acción no se puede deshacer.`, 'Sí, eliminar todo', true))) return;
    try { await eliminarProyectoDelEquipo({ id: p.idHoja, nombre: p.nombre }); }
    catch (e: any) { await avisar('No se pudo eliminar', `${e.message ?? e}\n\nNecesitas conexión: si no se elimina en el servidor, el proyecto volvería a aparecer.`); return; }
    setEditando(null);
    await borrarFotos(await borrarProyecto(p.id));
    const queda = proyectos.find((x) => x.id !== p.id);
    if (queda) await activar(queda.id); else await refrescar();
  };

  const sincronizarTodo = async () => {
    if (!ajustes.syncUrl) { await avisar('Sincronización', 'Aún no has configurado el destino. Entra con tu usuario y clave, o revisa Ajustes → Sincronización.'); return; }
    setSincronizando(true);
    try {
      const total = { enviadas: 0, borradasEnviadas: 0, recibidas: 0, borradasRemotas: 0 };
      for (const p of proyectos) {
        const r = await sincronizacion.sincronizar(p);
        total.enviadas += r.enviadas; total.borradasEnviadas += r.borradasEnviadas; total.recibidas += r.recibidas; total.borradasRemotas += r.borradasRemotas;
      }
      await refrescar();
      await avisar('Sincronizado', `${proyectos.length} proyecto(s): ${resumenSync(total)}`);
    } catch (e: any) { await avisar('No se pudo sincronizar', e.message ?? String(e)); }
    finally { setSincronizando(false); }
  };

  const formatos: { f: Formato; texto: string }[] = [
    { f: 'csv', texto: 'CSV (Excel)' }, { f: 'geojson', texto: 'GeoJSON (QGIS / ArcGIS)' }, { f: 'kml', texto: 'KML (Google Earth)' },
  ];

  return (
    <>
      <Cabecera titulo="Proyectos" subtitulo="Agrupa tus levantamientos por zona o cliente" acciones={[
        { icono: 'mas', etiqueta: 'Nuevo proyecto', onClick: () => setEditando({ nombre: '', cliente: '', notas: '' }) },
        { icono: sincronizando ? 'actualizar' : 'nube', etiqueta: 'Sincronizar', onClick: sincronizarTodo },
        { icono: 'compartir', etiqueta: 'Exportar', onClick: () => setMenuExportar(true) },
      ]} />
      <div className="pila">
        {proyectos.map((p) => {
          const activo = p.id === proyecto?.id;
          return (
            <div key={p.id} className="tarjeta" style={{ borderWidth: 2, borderColor: activo ? 'var(--primario)' : undefined }}>
              <div className="fila" style={{ alignItems: 'flex-start' }}>
                <button type="button" style={{ all: 'unset', cursor: 'pointer', flex: 1 }} aria-label={`Proyecto ${p.nombre}${activo ? ', activo' : ''}`} onClick={() => activar(p.id)}>
                  <b style={{ fontSize: 17 }}>{p.nombre}</b>
                  <div className="muted">{[p.cliente, `${p.cantidad} luminaria${p.cantidad === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>
                </button>
                {activo && <div style={{ flex: 'none' }}><Ficha texto="Activo" color="primario" /></div>}
                {esAdmin && <button type="button" className="icono-btn" style={{ flex: 'none' }} aria-label={`Editar ${p.nombre}`} onClick={() => setEditando(p)}>✎</button>}
              </div>
            </div>
          );
        })}
      </div>

      {esAdmin && inactivos.length > 0 && (
        <>
          <Seccion>Desactivados</Seccion>
          <div className="pila">
            {inactivos.map((p) => (
              <div key={p.id} className="tarjeta" data-testid="proyecto-inactivo">
                <div className="fila" style={{ alignItems: 'center' }}>
                  <div style={{ flex: 1 }}><b>{p.nombre}</b><div className="muted">{[p.cliente, `${p.cantidad} luminaria${p.cantidad === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div></div>
                  <div style={{ flex: 'none' }}><Boton texto="Activar" variante="secundario" bloque={false} onClick={() => cambiarEstado(p, true)} /></div>
                  <button type="button" className="icono-btn" style={{ flex: 'none' }} aria-label={`Editar ${p.nombre}`} onClick={() => setEditando(p)}>✎</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {proyecto && (
        <>
          <Seccion>{`Resumen · ${proyecto.nombre}`}</Seccion>
          <Tarjeta>
            <div className="cifras">
              {[['Luminarias', String(r.total)], ['Con GPS', String(r.conCoordenada)], ['Carga', `${r.potenciaTotalKw.toFixed(2)} kW`], ['Sincron.', `${r.sincronizadas}/${r.total}`]].map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}
            </div>
            {r.total === 0 ? <p className="muted">Aún no hay datos para este proyecto.</p> : (
              <>
                <p className="muted" style={{ fontWeight: 700, margin: '8px 0' }}>POR TECNOLOGÍA</p><Barras datos={r.porTecnologia} max={r.porTecnologia[0].cantidad} />
                <p className="muted" style={{ fontWeight: 700, margin: '16px 0 8px' }}>CONTROL</p><Barras datos={r.porControl} max={r.porControl[0].cantidad} />
              </>
            )}
          </Tarjeta>
        </>
      )}

      <Hoja abierta={!!editando} alCerrar={() => setEditando(null)} titulo={editando?.id ? 'Editar proyecto' : 'Nuevo proyecto'}>
        <Campo etiqueta="Nombre" valor={editando?.nombre ?? ''} alCambiar={(t) => setEditando((e) => ({ ...e, nombre: t }))} pista="Ej. Barrio La Esperanza" />
        <Campo etiqueta="Cliente / municipio" valor={editando?.cliente ?? ''} alCambiar={(t) => setEditando((e) => ({ ...e, cliente: t }))} />
        <Campo etiqueta="Notas" valor={editando?.notas ?? ''} alCambiar={(t) => setEditando((e) => ({ ...e, notas: t }))} multilinea />
        <div className="pila"><Boton texto="Guardar" onClick={guardar} />{!!editando?.id && esAdmin && (
          <>
            <Boton texto={editando.activo === false ? 'Activar proyecto' : 'Desactivar proyecto'} variante="secundario" onClick={() => cambiarEstado(editando as Proyecto, editando.activo === false)} />
            <Boton texto="Eliminar proyecto" variante="peligro" onClick={() => eliminar(editando as Proyecto)} />
          </>
        )}</div>
      </Hoja>
      <Hoja abierta={menuExportar} alCerrar={() => setMenuExportar(false)} titulo="Exportar proyecto" subtitulo={proyecto ? `${proyecto.nombre} · ${items.length} luminarias` : ''}
        opciones={formatos.map(({ f, texto }) => ({ texto, onClick: () => { exportar(f, items, proyecto ?? undefined).catch((e) => avisar('No se pudo exportar', e.message ?? String(e))); } }))} />
    </>
  );
}
