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
import { eliminarProyectoDelEquipo } from '../servicios/identidad';
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
  const { proyectos, proyecto, items, ajustes, activar, refrescar } = useApp();
  const esAdmin = rolDe(ajustes) === 'admin';
  const [sincronizando, setSincronizando] = useState(false);
  const [menuExportar, setMenuExportar] = useState(false);
  const [editando, setEditando] = useState<Partial<Proyecto> | null>(null);
  const r = useMemo(() => resumir(items), [items]);

  const guardar = async () => {
    if (!editando?.nombre?.trim()) { await avisar('Falta el nombre', 'Escribe un nombre para el proyecto.'); return; }
    const e = editando;
    setEditando(null);
    if (e.id) await editarProyecto(e.id, e.nombre!, e.cliente ?? '', e.notas ?? '');
    else await activar(await crearProyecto(e.nombre!, e.cliente ?? '', e.notas ?? ''));
    await refrescar();
  };

  const eliminar = async (p: Proyecto) => {
    if (!esAdmin) { await avisar('Sin permiso', 'Solo el administrador puede eliminar proyectos.'); return; }
    if (proyectos.length <= 1) { await avisar('No se puede', 'Debe existir al menos un proyecto.'); return; }
    if (!(await confirmar('Eliminar proyecto', `Vas a eliminar "${p.nombre}" para TODO el equipo: desaparecerá de todos los dispositivos y de la lista de proyectos (la hoja de Google conserva una copia archivada hasta que la limpies).`, 'Continuar', true))) return;
    if (!(await confirmar('¿Seguro?', `Última confirmación: "${p.nombre}" y sus luminarias se quitarán de todos los equipos. Esta acción no se puede deshacer desde la app.`, 'Sí, eliminar', true))) return;
    try { await eliminarProyectoDelEquipo(p.nombre); }
    catch (e: any) { await avisar('No se pudo eliminar', `${e.message ?? e}\n\nNecesitas conexión: si no se elimina en el servidor, el proyecto volvería a aparecer.`); return; }
    setEditando(null);
    await borrarFotos(await borrarProyecto(p.id));
    await activar(proyectos.find((x) => x.id !== p.id)!.id);
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
                <button type="button" className="icono-btn" style={{ flex: 'none' }} aria-label={`Editar ${p.nombre}`} onClick={() => setEditando(p)}>✎</button>
              </div>
            </div>
          );
        })}
      </div>

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
                <p className="muted" style={{ fontWeight: 700, margin: '16px 0 8px' }}>FOTOCELDA</p><Barras datos={r.porFotocelda} max={r.porFotocelda[0].cantidad} />
              </>
            )}
          </Tarjeta>
        </>
      )}

      <Hoja abierta={!!editando} alCerrar={() => setEditando(null)} titulo={editando?.id ? 'Editar proyecto' : 'Nuevo proyecto'}>
        <Campo etiqueta="Nombre" valor={editando?.nombre ?? ''} alCambiar={(t) => setEditando((e) => ({ ...e, nombre: t }))} pista="Ej. Barrio La Esperanza" />
        <Campo etiqueta="Cliente / municipio" valor={editando?.cliente ?? ''} alCambiar={(t) => setEditando((e) => ({ ...e, cliente: t }))} />
        <Campo etiqueta="Notas" valor={editando?.notas ?? ''} alCambiar={(t) => setEditando((e) => ({ ...e, notas: t }))} multilinea />
        <div className="pila"><Boton texto="Guardar" onClick={guardar} />{!!editando?.id && esAdmin && <Boton texto="Eliminar proyecto" variante="peligro" onClick={() => eliminar(editando as Proyecto)} />}</div>
      </Hoja>
      <Hoja abierta={menuExportar} alCerrar={() => setMenuExportar(false)} titulo="Exportar proyecto" subtitulo={proyecto ? `${proyecto.nombre} · ${items.length} luminarias` : ''}
        opciones={formatos.map(({ f, texto }) => ({ texto, onClick: () => { exportar(f, items, proyecto ?? undefined).catch((e) => avisar('No se pudo exportar', e.message ?? String(e))); } }))} />
    </>
  );
}
