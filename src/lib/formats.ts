import { Luminaria, Proyecto } from '../types';
import { coordenadaValida, enlaceMapa } from './geo';

const COLUMNAS: [string, (l: Luminaria, p?: Proyecto) => string | number | null][] = [
  ['ID', (l) => l.id],
  ['Proyecto', (_l, p) => p?.nombre ?? ''],
  ['Código activo', (l) => l.codigo],
  ['Fecha', (l) => l.creadoEn],
  ['Latitud', (l) => l.latitud],
  ['Longitud', (l) => l.longitud],
  ['Precisión (m)', (l) => (l.precisionM != null ? Math.round(l.precisionM) : null)],
  ['Dirección', (l) => l.direccion],
  ['Marca', (l) => l.marca],
  ['Fabricante', (l) => l.fabricante],
  ['Modelo', (l) => l.modelo],
  ['Tipo de luminaria', (l) => l.tipoLuminaria],
  ['Tecnología', (l) => l.tecnologia],
  ['Potencia (W)', (l) => l.potenciaW],
  ['Tensión (V)', (l) => l.tensionV],
  ['Fotocelda', (l) => l.fotocelda],
  ['Pines fotocelda', (l) => l.pinesFotocelda],
  ['Temp. color (K)', (l) => l.temperaturaColorK],
  ['Flujo (lm)', (l) => l.flujoLuminosoLm],
  ['IP', (l) => l.ip],
  ['Montaje', (l) => l.montaje],
  ['Altura (m)', (l) => l.alturaM],
  ['Estado', (l) => l.estado],
  ['Confianza IA', (l) => l.confianza],
  ['Observaciones', (l) => l.observaciones],
  ['Enlace mapa', (l) => (coordenadaValida(l.latitud, l.longitud) ? enlaceMapa(l.latitud!, l.longitud!) : '')],
];

/** Neutraliza fórmulas de hoja de cálculo (CSV injection) en textos que empiezan por = + - @ */
const seguro = (t: string) => (/^[=+@]/.test(t) || (/^-/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) ? `'${t}` : t);

const esc = (v: string | number | null) => {
  const t = v == null ? '' : seguro(String(v));
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function aCsv(items: Luminaria[], proyecto?: Proyecto): string {
  const filas = [COLUMNAS.map(([h]) => esc(h)).join(',')];
  for (const l of items) filas.push(COLUMNAS.map(([, f]) => esc(f(l, proyecto))).join(','));
  return '﻿' + filas.join('\r\n'); // BOM: Excel respeta los acentos
}

export function aGeoJson(items: Luminaria[], proyecto?: Proyecto): string {
  const features = items
    .filter((l) => coordenadaValida(l.latitud, l.longitud))
    .map((l) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l.longitud, l.latitud] },
      properties: {
        id: l.id, proyecto: proyecto?.nombre ?? '', codigo: l.codigo, marca: l.marca, fabricante: l.fabricante,
        modelo: l.modelo, tipo: l.tipoLuminaria, tecnologia: l.tecnologia, potencia_w: l.potenciaW,
        tension_v: l.tensionV, fotocelda: l.fotocelda, pines_fotocelda: l.pinesFotocelda,
        temperatura_color_k: l.temperaturaColorK, flujo_lm: l.flujoLuminosoLm, ip: l.ip, montaje: l.montaje,
        altura_m: l.alturaM, estado: l.estado, confianza_ia: l.confianza, direccion: l.direccion,
        observaciones: l.observaciones, fecha: l.creadoEn,
      },
    }));
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

const xml = (t: string) => t.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

export function aKml(items: Luminaria[], proyecto?: Proyecto): string {
  const marcas = items
    .filter((l) => coordenadaValida(l.latitud, l.longitud))
    .map((l) => {
      const nombre = l.codigo || [l.marca, l.modelo].filter(Boolean).join(' ') || `Luminaria ${l.id}`;
      const desc = COLUMNAS.slice(8, 24)
        .map(([h, f]) => ({ h, v: f(l, proyecto) }))
        .filter((x) => x.v !== '' && x.v != null)
        .map((x) => `${x.h}: ${x.v}`)
        .join('\n');
      return `    <Placemark><name>${xml(nombre)}</name><description>${xml(desc)}</description>` +
        `<Point><coordinates>${l.longitud},${l.latitud},0</coordinates></Point></Placemark>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n` +
    `    <name>${xml(proyecto?.nombre ?? 'ELI-LUMINARIA')}</name>\n${marcas.join('\n')}\n  </Document>\n</kml>\n`;
}
