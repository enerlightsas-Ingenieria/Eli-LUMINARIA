import { useMemo, useState } from 'react';
import { resumir } from '@compartido/lib/stats';
import type { Proyecto } from '@compartido/types';
import { avisar, confirmar } from '../componentes/dialogos';
import { Boton, Cabecera, Campo, Ficha, Hoja, Seccion, Tarjeta } from '../componentes/ui';
import { useApp } from '../contexto/App';
import { borrarFotos, borrarProyecto, crearProyecto, editarProyecto } from '../servicios/almacen';

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
  const { proyectos, proyecto, items, activar, refrescar } = useApp();
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
    if (proyectos.length <= 1) { await avisar('No se puede', 'Debe existir al menos un proyecto.'); return; }
    if (!(await confirmar('Eliminar proyecto', `Se eliminarán "${p.nombre}" y todas sus luminarias de este dispositivo. No se borran de la hoja ni de los demás técnicos. Esta acción no se puede deshacer.`, 'Eliminar', true))) return;
    setEditando(null);
    await borrarFotos(await borrarProyecto(p.id));
    await activar(proyectos.find((x) => x.id !== p.id)!.id);
  };

  return (
    <>
      <Cabecera titulo="Proyectos" subtitulo="Agrupa tus levantamientos por zona o cliente" acciones={[{ icono: 'mas', etiqueta: 'Nuevo proyecto', onClick: () => setEditando({ nombre: '', cliente: '', notas: '' }) }]} />
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
        <div className="pila"><Boton texto="Guardar" onClick={guardar} />{!!editando?.id && <Boton texto="Eliminar proyecto" variante="peligro" onClick={() => eliminar(editando as Proyecto)} />}</div>
      </Hoja>
    </>
  );
}
