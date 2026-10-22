import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Luminaria } from '../types';

const COLUMNAS: [string, (l: Luminaria) => string | number | null][] = [
  ['ID', (l) => l.id],
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
  ['Estado', (l) => l.estado],
  ['Confianza IA', (l) => l.confianza],
  ['Observaciones', (l) => l.observaciones],
  ['Enlace mapa', (l) => (l.latitud != null ? `https://maps.google.com/?q=${l.latitud},${l.longitud}` : '')],
];

const esc = (v: string | number | null) => {
  const t = v == null ? '' : String(v);
  return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function aCsv(items: Luminaria[]): string {
  const filas = [COLUMNAS.map(([h]) => esc(h)).join(',')];
  for (const l of items) filas.push(COLUMNAS.map(([, f]) => esc(f(l))).join(','));
  // BOM para que Excel abra bien los acentos
  return '﻿' + filas.join('\r\n');
}

export async function exportarCsv(items: Luminaria[]): Promise<void> {
  const nombre = `luminarias_${new Date().toISOString().slice(0, 10)}.csv`;
  const file = new File(Paths.cache, nombre);
  file.create({ overwrite: true });
  file.write(aCsv(items));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartir no está disponible en este dispositivo.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Exportar luminarias', UTI: 'public.comma-separated-values-text' });
}
