import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icono } from './Icono';

export interface Marca {
  lat: number; lng: number; color: string; radio?: number;
  /** Texto emergente (siempre como TEXTO: nunca se interpreta como HTML). */
  tooltip?: string; permanente?: boolean;
  lineas?: string[]; accion?: { texto: string; alClic: () => void };
  /** Botones del globo emergente (además de `accion`). */
  acciones?: { texto: string; alClic: () => void }[];
}

/** Color por tecnología (igual que el mapa del móvil). */
export function colorTecnologia(t: string): string {
  const s = (t || '').toLowerCase();
  if (s.includes('led')) return '#16a34a';
  if (s.includes('sodio')) return '#ea580c';
  if (s.includes('mercurio')) return '#2563eb';
  if (s.includes('halide') || s.includes('haluro')) return '#9333ea';
  return '#64748b';
}

const texto = (t: string) => { const e = document.createElement('span'); e.textContent = t; return e; };

export function MapaLeaflet({ marcas, ajustar, yo, alCentrarEnMi, etiquetasDesdeZoom, movible, alMoverPunto }: {
  marcas: Marca[]; ajustar: number; yo?: { lat: number; lng: number; n: number } | null; alCentrarEnMi?: () => void;
  /** Las etiquetas permanentes solo se ven con este zoom o más (de lejos estorban). */
  etiquetasDesdeZoom?: number;
  /** Punto que se está moviendo: aparece como un pin arrastrable. Se mueve arrastrándolo o tocando el mapa. */
  movible?: { lat: number; lng: number } | null; alMoverPunto?: (lat: number, lng: number) => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.FeatureGroup | null>(null);
  const puntoYo = useRef<L.CircleMarker | null>(null);
  const pin = useRef<L.Marker | null>(null);
  const alMover = useRef(alMoverPunto);
  alMover.current = alMoverPunto;
  const hayMovible = useRef(false);
  hayMovible.current = !!movible;

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = L.map(contenedor.current).setView([4.65, -74.1], 6);
    const calles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' });
    L.control.layers({ Calles: calles, Satélite: satelite }, undefined, { position: 'topright' }).addTo(m);
    capa.current = L.featureGroup().addTo(m);
    mapa.current = m;
    m.on('click', (e: L.LeafletMouseEvent) => { if (hayMovible.current) alMover.current?.(e.latlng.lat, e.latlng.lng); });   // con un punto en movimiento, tocar el mapa lo lleva ahí
    return () => { m.remove(); mapa.current = null; };
  }, []);

  useEffect(() => {
    const g = capa.current;
    if (!g) return;
    g.clearLayers();
    for (const x of marcas) {
      const c = L.circleMarker([x.lat, x.lng], { radius: x.radio ?? 9, color: '#fff', weight: 2, fillColor: x.color, fillOpacity: 0.95 }).addTo(g);
      if (x.tooltip) c.bindTooltip(texto(x.tooltip), { permanent: !!x.permanente, direction: 'top', offset: [0, -8] });
      if (x.lineas?.length || x.accion) {
        const cont = document.createElement('div');
        for (const l of x.lineas ?? []) { const d = document.createElement('div'); d.textContent = l; cont.appendChild(d); }
        for (const a of [x.accion, ...(x.acciones ?? [])]) {
          if (!a) continue;
          const b = document.createElement('button'); b.type = 'button'; b.textContent = a.texto; b.style.cssText = 'margin:6px 6px 0 0;cursor:pointer'; b.onclick = () => { mapa.current?.closePopup(); a.alClic(); }; cont.appendChild(b);
        }
        c.bindPopup(cont);
      }
    }
  }, [marcas]);

  // Etiquetas permanentes: solo de cerca
  useEffect(() => {
    const m = mapa.current, c = contenedor.current;
    if (!m || !c || etiquetasDesdeZoom == null) return;
    const f = () => c.classList.toggle('sin-etiquetas', m.getZoom() < etiquetasDesdeZoom);
    f(); m.on('zoomend', f);
    return () => { m.off('zoomend', f); c.classList.remove('sin-etiquetas'); };
  }, [etiquetasDesdeZoom]);

  // Pin arrastrable del punto que se está moviendo
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (!movible) { pin.current?.remove(); pin.current = null; return; }
    if (!pin.current) {
      const icono = L.divIcon({ className: 'pin-mover-caja', html: '<div class="pin-mover"></div>', iconSize: [34, 34], iconAnchor: [17, 17] });
      pin.current = L.marker([movible.lat, movible.lng], { draggable: true, icon: icono, zIndexOffset: 1000 }).addTo(m);
      pin.current.on('dragend', () => { const p = pin.current!.getLatLng(); alMover.current?.(p.lat, p.lng); });
      m.setView([movible.lat, movible.lng], Math.max(m.getZoom(), 19));
    } else pin.current.setLatLng([movible.lat, movible.lng]);
  }, [movible]);

  useEffect(() => {
    const m = mapa.current, g = capa.current;
    if (m && g && marcas.length && ajustar > 0) m.fitBounds(g.getBounds().pad(0.2), { maxZoom: 18 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ajustar]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !yo) return;
    puntoYo.current?.remove();
    puntoYo.current = L.circleMarker([yo.lat, yo.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(m);
    m.setView([yo.lat, yo.lng], Math.max(m.getZoom(), 17));
  }, [yo]);

  return (
    <div className="mapa" data-testid="mapa">
      <div ref={contenedor} style={{ position: 'absolute', inset: 0 }} />
      {alCentrarEnMi && <button type="button" className="boton-mapa" aria-label="Centrar en mi ubicación" onClick={alCentrarEnMi}><Icono nombre="gps" /></button>}
    </div>
  );
}
