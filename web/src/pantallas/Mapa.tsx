import { useMemo, useState } from 'react';
import { distanciaM } from '@compartido/lib/geo';
import { coordenadaValida } from '@compartido/lib/geo';
import { Boton, Cabecera } from '../componentes/ui';
import { avisar, confirmar } from '../componentes/dialogos';
import { colorTecnologia, Marca, MapaLeaflet } from '../componentes/MapaLeaflet';
import { useApp } from '../contexto/App';
import { ir } from '../router';
import { guardarLuminaria } from '../servicios/almacen';
import { obtenerPosicion } from '../servicios/gps';
import { useEnLinea } from '../servicios/red';

export function Mapa() {
  const { items, proyecto, ajustes, refrescar } = useApp();
  const [etiquetas, setEtiquetas] = useState(true);
  const [moviendo, setMoviendo] = useState<{ id: number; lat: number; lng: number; original: { lat: number; lng: number } } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const terceros = ajustes.modoTerceros;   // en modo terceros la coordenada la registra solo el GPS
  const enLinea = useEnLinea();
  const [ajustar, setAjustar] = useState(1);
  const [yo, setYo] = useState<{ lat: number; lng: number; n: number } | null>(null);

  const marcas = useMemo<Marca[]>(() => items.filter((l) => l.id !== moviendo?.id && coordenadaValida(l.latitud, l.longitud)).map((l) => {
    const titulo = l.codigo || l.codigoPoste || `#${l.id}`;
    return {
      lat: l.latitud!, lng: l.longitud!, color: colorTecnologia(l.tecnologia),
      // la etiqueta es la misma que se ve en la lista al guardar: código · fabricante
      tooltip: [titulo, l.fabricante].filter(Boolean).join(' · '), permanente: etiquetas,
      lineas: [
        [titulo, l.fabricante || 'Sin identificar'].join(' · '),
        [l.tecnologia, l.potenciaW && `${l.potenciaW} W`, l.control && l.control !== 'Sin control' && l.control].filter(Boolean).join(' · '),
        [l.codigoPoste && l.codigo ? `Poste ${l.codigoPoste}` : '', l.barrio].filter(Boolean).join(' · '),
      ].filter(Boolean),
      accion: { texto: 'Abrir ficha', alClic: () => ir(`/editar/${l.id}`) },
      acciones: terceros ? [] : [{ texto: 'Mover', alClic: () => setMoviendo({ id: l.id, lat: l.latitud!, lng: l.longitud!, original: { lat: l.latitud!, lng: l.longitud! } }) }],
    };
  }), [items, etiquetas, moviendo?.id, terceros]);

  const luminariaMovida = moviendo ? items.find((x) => x.id === moviendo.id) : undefined;
  const guardarPosicion = async () => {
    if (!moviendo || !luminariaMovida) return;
    const metros = distanciaM({ latitud: moviendo.original.lat, longitud: moviendo.original.lng }, { latitud: moviendo.lat, longitud: moviendo.lng });
    if (metros > 100 && !(await confirmar('Mover lejos', `El punto se movió ${Math.round(metros)} m de donde estaba. ¿Es la posición real de la luminaria?`, 'Sí, guardar'))) return;
    setGuardando(true);
    try {
      const redondo = (n: number) => Math.round(n * 1e6) / 1e6;
      await guardarLuminaria({ ...luminariaMovida, latitud: redondo(moviendo.lat), longitud: redondo(moviendo.lng), precisionM: null });   // posición corregida a mano: no es una lectura del GPS
      await refrescar();
      setMoviendo(null);
    } catch (e: any) { await avisar('No se pudo guardar', e.message ?? String(e)); }
    finally { setGuardando(false); }
  };

  const centrar = async () => {
    const p = await obtenerPosicion('alta');
    if (!p) { await avisar('Ubicación', 'No se pudo obtener tu ubicación. Revisa el permiso de ubicación del navegador.'); return; }
    setYo((a) => ({ lat: p.latitud, lng: p.longitud, n: (a?.n ?? 0) + 1 }));
  };

  return (
    <>
      <Cabecera titulo="Mapa" subtitulo={`${proyecto?.nombre ?? ''} · ${marcas.length} con coordenada`} acciones={[
        { icono: 'mapa', etiqueta: 'Ajustar a todas', onClick: () => setAjustar((n) => n + 1) },
        { icono: 'lista', etiqueta: etiquetas ? 'Ocultar etiquetas' : 'Mostrar etiquetas', onClick: () => setEtiquetas((v) => !v) },
      ]} />
      {!enLinea && <p className="aviso" role="status" data-testid="mapa-sin-conexion">Sin conexión: el fondo del mapa no carga, pero tus luminarias se muestran igual como puntos.</p>}
      {moviendo && (
        <div className="tarjeta mover-barra" role="status" data-testid="mover-barra">
          <b>Moviendo {luminariaMovida?.codigo || luminariaMovida?.codigoPoste || `#${moviendo.id}`}</b>
          <span className="muted">Arrastra el pin rojo o toca el mapa hasta la posición real de la luminaria.</span>
          <span className="muted" data-testid="mover-coordenada">{moviendo.lat.toFixed(6)}, {moviendo.lng.toFixed(6)}</span>
          <div className="fila">
            <Boton texto="Cancelar" variante="secundario" deshabilitado={guardando} onClick={() => setMoviendo(null)} />
            <Boton texto="Guardar posición" cargando={guardando} onClick={guardarPosicion} />
          </div>
        </div>
      )}
      <MapaLeaflet marcas={marcas} ajustar={ajustar} yo={yo} alCentrarEnMi={centrar} etiquetasDesdeZoom={16}
        movible={moviendo ? { lat: moviendo.lat, lng: moviendo.lng } : null}
        alMoverPunto={(lat, lng) => setMoviendo((m) => (m ? { ...m, lat, lng } : m))} />
    </>
  );
}
