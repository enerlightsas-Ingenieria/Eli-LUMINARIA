import { useMemo, useRef, useState } from 'react';
import { resumenSync } from '@compartido/core/sync';
import type { Luminaria } from '@compartido/types';
import { Foto } from '../componentes/Foto';
import { Icono } from '../componentes/Icono';
import { TarjetaJornada } from '../componentes/TarjetaJornada';
import { Boton, Cabecera, Cargando, Ficha, Hoja } from '../componentes/ui';
import { avisar } from '../componentes/dialogos';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { exportar, Formato } from '../servicios/exportar';
import { analizarLote, sincronizacion } from '../servicios/nucleo';
import { sinAnalizar } from '../servicios/analisisPendiente';
import { useEnLinea } from '../servicios/red';

type Filtro = 'todas' | 'pendientes' | 'sinGps';

export function Registros() {
  const { items, proyecto, proyectos, pendientes, ajustes, refrescar, salir, activar } = useApp();
  const [elegirProyecto, setElegirProyecto] = useState(false);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [menuExportar, setMenuExportar] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const enLinea = useEnLinea();
  const [lote, setLote] = useState<{ hechas: number; total: number } | null>(null);
  const cancelarLote = useRef<AbortController | null>(null);
  const iaDisponible = ajustes.iaActiva !== false && !!ajustes.apiKey;
  const porAnalizar = useMemo(() => items.filter(sinAnalizar), [items]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((l: Luminaria) => {
      if (filtro === 'pendientes' && l.sincronizado) return false;
      if (filtro === 'sinGps' && l.latitud != null) return false;
      if (!t) return true;
      return [l.codigo, l.codigoPoste, l.fabricante, l.tecnologia, l.direccion, l.tecnico, String(l.id)].some((x) => x.toLowerCase().includes(t));
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

  const analizarAhora = async () => {
    cancelarLote.current = new AbortController();
    setLote({ hechas: 0, total: porAnalizar.length });
    const r = await analizarLote(items, (hechas, total) => setLote({ hechas, total }), cancelarLote.current.signal);
    setLote(null); cancelarLote.current = null;
    await refrescar();
    await avisar(r.error ? 'Análisis detenido' : 'Análisis terminado',
      `${r.hechas} luminaria(s) analizada(s)${r.sinDatos ? `, ${r.sinDatos} sin datos legibles` : ''}.${r.error ? `\n\nMotivo: ${r.error}\nLas pendientes siguen en la lista; puedes reintentar.` : ''}`);
  };

  const formatos: { f: Formato; texto: string }[] = [
    { f: 'csv', texto: 'CSV (Excel)' }, { f: 'geojson', texto: 'GeoJSON (QGIS / ArcGIS)' }, { f: 'kml', texto: 'KML (Google Earth)' },
  ];

  return (
    <>
      <Cabecera titulo="ELI-LUMINARIA" subtitulo={proyecto ? `${proyecto.nombre} · ${items.length} luminarias` : ' '} onSubtitulo={() => setElegirProyecto(true)}
        acciones={[
          { icono: sincronizando ? 'actualizar' : 'nube', etiqueta: 'Sincronizar', onClick: sync, insignia: pendientes },
          { icono: 'compartir', etiqueta: 'Exportar', onClick: () => setMenuExportar(true) },
          { icono: 'salir', etiqueta: 'Salir', onClick: salir },
        ]} />
      {!ajustes.syncUrl && !ajustes.apiKey && (
        <div className="tarjeta" style={{ marginBottom: 10 }}>
          <b>Falta configurar la app</b>
          <p className="muted" style={{ fontSize: 14 }}>Abre el enlace que te envió tu empresa, o pega el código en <a href="#/ajustes" style={{ color: 'var(--primario)' }}>Ajustes</a>. Sin configurar puedes llenar los datos a mano; la IA y la sincronización quedan desactivadas.</p>
        </div>
      )}
      <TarjetaJornada />
      {iaDisponible && porAnalizar.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 10 }} data-testid="lote-ia">
          <b>{porAnalizar.length} luminaria{porAnalizar.length === 1 ? '' : 's'} sin analizar con IA</b>
          <p className="muted" style={{ fontSize: 14, margin: '4px 0 10px' }}>Se capturaron sin conexión o sin IA. Cada análisis consume crédito de la API: tú decides cuándo.</p>
          <Boton texto={enLinea ? 'Analizar ahora' : 'Necesitas conexión'} variante="secundario" icono="chispa" deshabilitado={!enLinea} onClick={analizarAhora} />
        </div>
      )}
      <div className="buscador"><Icono nombre="buscar" tam={18} /><input aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fabricante, código, técnico…" /></div>
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
            <p>{items.length ? 'Prueba con otro texto o filtro.' : 'Toma una foto y la app identificará fabricante, tecnología, potencia, control y más, junto con la coordenada.'}</p>
          </div>
        )}
        {visibles.map((l) => (
          <button key={l.id} type="button" className="tarjeta item" onClick={() => ir(`/editar/${l.id}`)} aria-label={`Luminaria ${l.id}, ${l.fabricante}`}>
            <Foto id={l.fotos[0]} miniatura={l.miniatura} className="miniatura" />
            <div style={{ minWidth: 0 }}>
              <div className="t">{l.codigo || `#${l.id}`} · {l.fabricante || 'Sin identificar'}</div>
              <div className="s">{[l.tecnologia, l.potenciaW && `${l.potenciaW} W`, l.control && l.control !== 'Sin control' && l.control].filter(Boolean).join(' · ') || '—'}</div>
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

      {lote && (
        <div className="cubierta" role="status">
          <Cargando texto={`Analizando con IA… ${lote.hechas}/${lote.total}`} />
          <Boton texto="Detener" variante="secundario" bloque={false} onClick={() => cancelarLote.current?.abort()} />
        </div>
      )}
      <button type="button" className="fab" onClick={() => ir('/capturar')} aria-label="Nueva luminaria"><Icono nombre="camara" />Nueva</button>
      <Hoja abierta={elegirProyecto} alCerrar={() => setElegirProyecto(false)} titulo="Elegir proyecto" subtitulo="Los registros que ves son los de este proyecto"
        opciones={[
          ...proyectos.map((p) => ({ texto: `${p.id === proyecto?.id ? '✓ ' : ''}${p.nombre} · ${p.cantidad} luminaria${p.cantidad === 1 ? '' : 's'}`, onClick: () => { activar(p.id); } })),
          { texto: 'Ver y administrar proyectos', onClick: () => ir('/proyectos') },
        ]} />
      <Hoja abierta={menuExportar} alCerrar={() => setMenuExportar(false)} titulo="Exportar proyecto" subtitulo={`${items.length} luminarias`}
        opciones={formatos.map(({ f, texto }) => ({ texto, onClick: () => { exportar(f, items, proyecto ?? undefined).catch((e) => avisar('No se pudo exportar', e.message ?? String(e))); } }))} />
    </>
  );
}
