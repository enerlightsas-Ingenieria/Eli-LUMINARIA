import { Luminaria, Proyecto } from '../types';
import { coordenadaValida, enlaceMapa } from './geo';

const COLUMNAS: [string, (l: Luminaria, p?: Proyecto) => string | number | null][] = [
  ['ID', (l) => l.id],
  ['Proyecto', (_l, p) => p?.nombre ?? ''],
  ['Código del poste', (l) => l.codigoPoste],
  ['Código de la luminaria', (l) => l.codigo],
  ['Fecha', (l) => l.creadoEn],
  ['Técnico', (l) => l.tecnico],
  ['Usuario', (l) => l.usuario ?? ''],
  ['Latitud', (l) => l.latitud],
  ['Longitud', (l) => l.longitud],
  ['Precisión (m)', (l) => (l.precisionM != null ? Math.round(l.precisionM) : null)],
  ['Dirección', (l) => l.direccion],
  ['Barrio', (l) => l.barrio],
  ['Sector', (l) => l.sector],
  ['Fabricante', (l) => l.fabricante],
  ['Tecnología', (l) => l.tecnologia],
  ['Potencia (W)', (l) => l.potenciaW],
  ['Control', (l) => l.control],
  ['Montaje', (l) => l.montaje],
  ['Material del poste', (l) => l.materialPoste],
  ['N.º del transformador', (l) => l.numeroTransformador],
  ['Estado', (l) => l.estado],
  ['Confianza IA', (l) => l.confianza],
  ['Origen de la foto', (l) => l.origen],
  ['Ubicación simulada', (l) => (l.ubicacionSimulada ? 'Sí' : '')],
  ['ID jornada', (l) => l.jornadaId],
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
        id: l.id, proyecto: proyecto?.nombre ?? '', codigo_poste: l.codigoPoste, codigo_luminaria: l.codigo, tecnico: l.tecnico, usuario: l.usuario ?? '', fabricante: l.fabricante,
        tecnologia: l.tecnologia, potencia_w: l.potenciaW, control: l.control, montaje: l.montaje,
        material_poste: l.materialPoste, numero_transformador: l.numeroTransformador, sector: l.sector,
        estado: l.estado, confianza_ia: l.confianza, origen: l.origen, ubicacion_simulada: l.ubicacionSimulada, jornada_id: l.jornadaId, direccion: l.direccion, barrio: l.barrio,
        observaciones: l.observaciones, fecha: l.creadoEn,
      },
    }));
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

const xml = (t: string) => t.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

const EXCLUIDAS_KML = ['ID', 'Proyecto', 'Fecha', 'Latitud', 'Longitud', 'Precisión (m)', 'Enlace mapa', 'ID jornada', 'Origen de la foto', 'Ubicación simulada'];

export function aKml(items: Luminaria[], proyecto?: Proyecto): string {
  const marcas = items
    .filter((l) => coordenadaValida(l.latitud, l.longitud))
    .map((l) => {
      const nombre = l.codigo || l.codigoPoste || l.fabricante || `Luminaria ${l.id}`;
      const desc = COLUMNAS.filter(([h]) => !EXCLUIDAS_KML.includes(h))
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
