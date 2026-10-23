import type { ResultadoAnalisis } from '@compartido/core/analizador';
import { caracteristicasVacias, Luminaria } from '@compartido/types';

const CAMPOS = Object.keys(caracteristicasVacias());

/** Capturada sin IA (p. ej. sin conexión) y sin que nadie haya llenado datos: candidata a analizarse en lote. */
export const sinAnalizar = (l: Luminaria): boolean => !l.confianza && l.fotos.length > 0 && CAMPOS.every((k) => !(l as any)[k]);

export interface DepsAnalisis {
  analizar(base64s: string[], senal?: AbortSignal): Promise<ResultadoAnalisis>;
  leerFotos(ids: string[]): Promise<string[]>;
  /** Registro actual (por si se editó mientras se analizaba). */
  leer(id: number): Promise<Luminaria | undefined>;
  guardar(l: Luminaria): Promise<unknown>;
}

export interface ResultadoLote { hechas: number; sinDatos: number; omitidas: number; error?: string }

/**
 * Analiza con IA, una por una, las luminarias capturadas sin análisis. Solo rellena registros que siguen sin datos (no pisa lo que el
 * técnico haya escrito entre tanto). Se detiene en el primer error (sin conexión, clave inválida, límite de uso…) y avisa.
 */
export async function analizarPendientes(items: Luminaria[], deps: DepsAnalisis, alProgreso?: (hechas: number, total: number) => void, senal?: AbortSignal): Promise<ResultadoLote> {
  const cola = items.filter(sinAnalizar).sort((a, b) => a.id - b.id);
  const r: ResultadoLote = { hechas: 0, sinDatos: 0, omitidas: 0 };
  for (const l of cola) {
    if (senal?.aborted) break;
    let res: ResultadoAnalisis;
    try { res = await deps.analizar(await deps.leerFotos(l.fotos.slice(0, 3)), senal); }
    catch (e: any) { r.error = e?.message ?? String(e); break; }
    const actual = await deps.leer(l.id);
    if (!actual || !sinAnalizar(actual)) { r.omitidas++; continue; }                  // el técnico la editó mientras tanto
    const hayDatos = Object.values(res.caracteristicas).some(Boolean);
    await deps.guardar(hayDatos ? { ...actual, ...res.caracteristicas, confianza: res.confianza } : { ...actual, confianza: 'baja' }); // "baja": no se reintenta eternamente
    if (!hayDatos) r.sinDatos++;
    r.hechas++;
    alProgreso?.(r.hechas, cola.length);
  }
  return r;
}
