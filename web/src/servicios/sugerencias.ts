import type { Luminaria } from '@compartido/types';

/** Valores ya escritos en un campo: del más usado al menos usado (y, a igualdad, el más reciente primero). Sin repetir mayúsculas/minúsculas. */
export function valoresUsados(items: Pick<Luminaria, 'creadoEn'>[], leer: (l: any) => string, max = 40): string[] {
  const cuenta = new Map<string, { v: string; n: number; ultimo: string }>();
  for (const l of items) {
    const v = leer(l).trim();
    if (!v) continue;
    const k = v.toLowerCase();
    const x = cuenta.get(k);
    if (x) { x.n++; if (l.creadoEn > x.ultimo) x.ultimo = l.creadoEn; } else cuenta.set(k, { v, n: 1, ultimo: l.creadoEn });
  }
  return [...cuenta.values()].sort((a, b) => b.n - a.n || (a.ultimo < b.ultimo ? 1 : -1) || a.v.localeCompare(b.v)).slice(0, max).map((x) => x.v);
}

/** Lo que se muestra mientras se escribe: lo que contiene el texto (primero lo que empieza igual); con el campo vacío, los más usados. */
export function filtrarSugerencias(todas: string[], escrito: string, max = 6): string[] {
  const t = escrito.trim().toLowerCase();
  if (!t) return todas.slice(0, max);
  const empieza = todas.filter((s) => s.toLowerCase().startsWith(t) && s.toLowerCase() !== t);
  const contiene = todas.filter((s) => !s.toLowerCase().startsWith(t) && s.toLowerCase().includes(t));
  return [...empieza, ...contiene].slice(0, max);
}

/** Valor "otro" escrito a mano ("Otra: Plasma" → "Plasma"); vacío si no lo es. */
export const textoDeOtro = (v: string) => (/^otr[oa]\s*:\s*\S/i.test(v) ? v.replace(/^otr[oa]\s*:\s*/i, '').trim() : '');
