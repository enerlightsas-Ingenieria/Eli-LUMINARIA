import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icono } from './Icono';

export interface Marca {
  lat: number; lng: number; color: string; radio?: number;
  /** Texto emergente (siempre como TEXTO: nunca se interpreta como HTML). */
  tooltip?: string; permanente?: boolean;
  lineas?: string[]; accion?: { texto: string; alClic: () => void };
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

export function MapaLeaflet({ marcas, ajustar, yo, alCentrarEnMi }: {
  marcas: Marca[]; ajustar: number; yo?: { lat: number; lng: number; n: number } | null; alCentrarEnMi?: () => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.FeatureGroup | null>(null);
  const puntoYo = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = L.map(contenedor.current).setView([4.65, -74.1], 6);
    const calles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' });
    L.control.layers({ Calles: calles, Satélite: satelite }, undefined, { position: 'topright' }).addTo(m);
    capa.current = L.featureGroup().addTo(m);
    mapa.current = m;
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
        if (x.accion) { const b = document.createElement('button'); b.type = 'button'; b.textContent = x.accion.texto; b.style.cssText = 'margin-top:6px;cursor:pointer'; b.onclick = x.accion.alClic; cont.appendChild(b); }
        c.bindPopup(cont);
      }
    }
  }, [marcas]);

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
