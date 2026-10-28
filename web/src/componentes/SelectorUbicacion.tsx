import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Boton } from './ui';
import { Icono } from './Icono';
import { obtenerMejorPosicion } from '../servicios/gps';
import { useEnLinea } from '../servicios/red';

/**
 * Pantalla completa para fijar la ubicación a mano: la mira del centro marca el punto; se mueve el mapa hasta que quede sobre la luminaria
 * (satélite o calles) y se confirma. `vecinas` = otras luminarias cercanas, como referencia.
 */
export function SelectorUbicacion({ inicial, vecinas, alConfirmar, alCerrar }: {
  inicial: { lat: number; lng: number } | null; vecinas: { lat: number; lng: number }[];
  alConfirmar: (lat: number, lng: number) => void; alCerrar: () => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const [centro, setCentro] = useState<{ lat: number; lng: number } | null>(inicial);
  const [buscando, setBuscando] = useState(false);
  const enLinea = useEnLinea();

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = L.map(contenedor.current, { zoomControl: true }).setView(inicial ? [inicial.lat, inicial.lng] : [4.65, -74.1], inicial ? 19 : 6);
    const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Esri' }).addTo(m);
    const calles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
    L.control.layers({ Satélite: satelite, Calles: calles }, undefined, { position: 'topright' }).addTo(m);
    for (const v of vecinas) L.circleMarker([v.lat, v.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#64748b', fillOpacity: 0.9, interactive: false }).addTo(m);
    const actualizar = () => { const c = m.getCenter(); setCentro({ lat: c.lat, lng: c.lng }); };
    m.on('move', actualizar);
    actualizar();
    mapa.current = m;
    return () => { m.remove(); mapa.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const irAMi = async () => {
    setBuscando(true);
    const p = await obtenerMejorPosicion(8000, 5);
    setBuscando(false);
    if (p && mapa.current) mapa.current.setView([p.latitud, p.longitud], 20);
  };

  return (
    <div className="selector-ubicacion" role="dialog" aria-modal="true" aria-label="Ajustar ubicación en el mapa">
      <div className="selector-barra">
        <b>Mueve el mapa hasta que la mira quede sobre la luminaria</b>
        {!enLinea && <span className="muted"> · Sin conexión el fondo no carga</span>}
      </div>
      <div className="selector-mapa">
        <div ref={contenedor} style={{ position: 'absolute', inset: 0 }} />
        <div className="mira" aria-hidden="true"><i /><b /></div>
        <button type="button" className="boton-mapa" aria-label="Centrar en mi ubicación" disabled={buscando} onClick={irAMi}><Icono nombre="gps" /></button>
      </div>
      <div className="selector-pie">
        <span data-testid="selector-coordenada" className="muted">{centro ? `${centro.lat.toFixed(6)}, ${centro.lng.toFixed(6)}` : '—'}</span>
        <div className="fila">
          <Boton texto="Cancelar" variante="secundario" onClick={alCerrar} />
          <Boton texto="Usar esta ubicación" deshabilitado={!centro} onClick={() => centro && alConfirmar(centro.lat, centro.lng)} />
        </div>
      </div>
    </div>
  );
}
