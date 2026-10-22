import { Luminaria } from '../types';

export interface Resumen {
  total: number;
  conCoordenada: number;
  sincronizadas: number;
  potenciaTotalKw: number;
  porTecnologia: { nombre: string; cantidad: number }[];
  porFotocelda: { nombre: string; cantidad: number }[];
}

const num = (t: string) => {
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Agrupa por la primera palabra significativa para que "LED", "led 4000K" y "Led" cuenten juntos. */
export const normalizaTecnologia = (t: string): string => {
  const s = t.trim().toLowerCase();
  if (!s) return 'Sin identificar';
  if (s.includes('led')) return 'LED';
  if (s.includes('sodio') && (s.includes('baja') || s.includes('lps'))) return 'Sodio baja presión';
  if (s.includes('sodio') || s.includes('hps') || s.includes('vsap')) return 'Sodio alta presión';
  if (s.includes('mercurio')) return 'Mercurio';
  if (s.includes('haluro') || s.includes('halide') || s.includes('halog')) return 'Metal halide';
  if (s.includes('fluor')) return 'Fluorescente';
  if (s.includes('induc')) return 'Inducción';
  return t.trim().charAt(0).toUpperCase() + t.trim().slice(1);
};

const cuenta = (xs: string[]) => {
  const m = new Map<string, number>();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
};

export function resumir(items: Luminaria[]): Resumen {
  return {
    total: items.length,
    conCoordenada: items.filter((l) => l.latitud != null && l.longitud != null).length,
    sincronizadas: items.filter((l) => l.sincronizado).length,
    potenciaTotalKw: Math.round(items.reduce((a, l) => a + num(l.potenciaW), 0)) / 1000,
    porTecnologia: cuenta(items.map((l) => normalizaTecnologia(l.tecnologia))),
    porFotocelda: cuenta(items.map((l) => (l.pinesFotocelda.trim() ? `${l.pinesFotocelda.trim()} pines` : l.fotocelda.trim() ? 'Otra' : 'Sin dato'))),
  };
}
