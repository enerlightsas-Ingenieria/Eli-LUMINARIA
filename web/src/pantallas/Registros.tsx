import { useMemo, useState } from 'react';
import { resumenSync } from '@compartido/core/sync';
import type { Luminaria } from '@compartido/types';
import { Foto } from '../componentes/Foto';
import { Icono } from '../componentes/Icono';
import { TarjetaJornada } from '../componentes/TarjetaJornada';
import { Cabecera, Ficha, Hoja } from '../componentes/ui';
import { avisar } from '../componentes/dialogos';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { exportar, Formato } from '../servicios/exportar';
import { sincronizacion } from '../servicios/nucleo';

type Filtro = 'todas' | 'pendientes' | 'sinGps';

export function Registros() {
  const { items, proyecto, pendientes, ajustes, refrescar } = useApp();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [menuExportar, setMenuExportar] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((l: Luminaria) => {
      if (filtro === 'pendientes' && l.sincronizado) return false;
      if (filtro === 'sinGps' && l.latitud != null) return false;
      if (!t) return true;
      return [l.codigo, l.marca, l.modelo, l.fabricante, l.tecnologia, l.direccion, l.tipoLuminaria, l.tecnico, String(l.id)].some((x) => x.toLowerCase().includes(t));
    });
  }, [items, q, filtro]);

  const sync = async () => {
    if (!proyecto) return;
    if (!ajustes.syncUrl) { await avisar('Sincronización', 'Aún no has configurado el destino. Abre el enlace de configuración de tu empresa o ve a Ajustes → Sincronización.'); return; }
    setSincronizando(true);
    try {
      const r = await sincronizacion.sincronizar(proyecto);
      await refrescar();
      await avisar('Sincronizado', resumenSync(r));
    } catch (e: any) { await avisar('No se pudo sincronizar', e.message ?? String(e)); }
    finally { setSincronizando(false); }
  };

  const formatos: { f: Formato; texto: string }[] = [
    { f: 'csv', texto: 'CSV (Excel)' }, { f: 'geojson', texto: 'GeoJSON (QGIS / ArcGIS)' }, { f: 'kml', texto: 'KML (Google Earth)' },
  ];

  return (
    <>
      <Cabecera titulo="ELI-LUMINARIA" subtitulo={proyecto ? `${proyecto.nombre} · ${items.length} luminarias` : ' '} onSubtitulo={() => ir('/proyectos')}
        acciones={[
          { icono: sincronizando ? 'actualizar' : 'nube', etiqueta: 'Sincronizar', onClick: sync, insignia: pendientes },
          { icono: 'compartir', etiqueta: 'Exportar', onClick: () => setMenuExportar(true) },
        ]} />
      {!ajustes.syncUrl && !ajustes.apiKey && (
        <div className="tarjeta" style={{ marginBottom: 10 }}>
          <b>Falta configurar la app</b>
          <p className="muted" style={{ fontSize: 14 }}>Abre el enlace que te envió tu empresa, o pega el código en <a href="#/ajustes" style={{ color: 'var(--primario)' }}>Ajustes</a>. Sin configurar puedes llenar los datos a mano; la IA y la sincronización quedan desactivadas.</p>
        </div>
      )}
      <TarjetaJornada />
      <div className="buscador"><Icono nombre="buscar" tam={18} /><input aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar marca, código, técnico…" /></div>
      <div className="filtros" role="group" aria-label="Filtros">
        {([['todas', 'Todas'], ['pendientes', `Sin sincronizar (${pendientes})`], ['sinGps', 'Sin coordenada']] as [Filtro, string][]).map(([f, t]) => (
          <button key={f} type="button" className={`ficha${filtro === f ? ' activa' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{t}</button>
        ))}
      </div>

      <div className="lista">
        {!visibles.length && (
          <div className="vacio">
            <Icono nombre="camara" tam={56} />
            <h2>{items.length ? 'Sin resultados' : 'Aún no hay luminarias'}</h2>
            <p>{items.length ? 'Prueba con otro texto o filtro.' : 'Toma una foto y la app identificará marca, tecnología, potencia, fotocelda y más, junto con la coordenada.'}</p>
          </div>
        )}
        {visibles.map((l) => (
          <button key={l.id} type="button" className="tarjeta item" onClick={() => ir(`/editar/${l.id}`)} aria-label={`Luminaria ${l.id}, ${l.marca} ${l.modelo}`}>
            <Foto id={l.fotos[0]} className="miniatura" />
            <div style={{ minWidth: 0 }}>
              <div className="t">{l.codigo || `#${l.id}`} · {[l.marca, l.modelo].filter(Boolean).join(' ') || 'Sin identificar'}</div>
              <div className="s">{[l.tecnologia, l.potenciaW && `${l.potenciaW} W`, l.pinesFotocelda && `fotocelda ${l.pinesFotocelda}p`].filter(Boolean).join(' · ') || l.tipoLuminaria || '—'}</div>
              {!!l.tecnico && <div className="s" style={{ fontSize: 12 }}>Por {l.tecnico}</div>}
              <div className="c">{l.latitud != null ? `📍 ${l.latitud.toFixed(6)}, ${l.longitud?.toFixed(6)}` : '📍 sin coordenada'}</div>
              <div className="etq">
                {!!l.confianza && <Ficha texto={`IA ${l.confianza}`} color={l.confianza === 'alta' ? 'ok' : l.confianza === 'media' ? 'aviso' : 'peligro'} />}
                {!l.sincronizado && <Ficha texto="Pendiente" color="aviso" />}
              </div>
            </div>
          </button>
        ))}
      </div>

      <button type="button" className="fab" onClick={() => ir('/capturar')} aria-label="Nueva luminaria"><Icono nombre="camara" />Nueva</button>
      <Hoja abierta={menuExportar} alCerrar={() => setMenuExportar(false)} titulo="Exportar proyecto" subtitulo={`${items.length} luminarias`}
        opciones={formatos.map(({ f, texto }) => ({ texto, onClick: () => { exportar(f, items, proyecto ?? undefined).catch((e) => avisar('No se pudo exportar', e.message ?? String(e))); } }))} />
    </>
  );
}
