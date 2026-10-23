import { describe, expect, it, vi } from 'vitest';
import { caracteristicasVacias, Luminaria } from '@compartido/types';
import { analizarPendientes, DepsAnalisis, sinAnalizar } from '../src/servicios/analisisPendiente';

const lum = (id: number, o: any = {}): Luminaria => ({
  ...caracteristicasVacias(), id, uuid: `u${id}`, proyectoId: 1, creadoEn: '', actualizadoEn: '', fotos: [`f${id}`], latitud: 4.7, longitud: -74.07,
  precisionM: 5, direccion: '', codigo: '', tecnico: 'Ana', confianza: '', origen: 'camara', ubicacionSimulada: false, jornadaId: '', sincronizado: false, ...o,
});
const ia = (c: any = { fabricante: 'Philips', tecnologia: 'LED' }) => ({ caracteristicas: { ...caracteristicasVacias(), ...c }, confianza: 'alta' as const });

function deps(registros: Luminaria[], analizar?: DepsAnalisis['analizar']) {
  const guardados: Luminaria[] = [];
  const d: DepsAnalisis = {
    analizar: analizar ?? (async () => ia()),
    leerFotos: async (ids) => ids.map((i) => `b64-${i}`),
    leer: async (id) => registros.find((r) => r.id === id),
    guardar: async (l) => { guardados.push(l); const i = registros.findIndex((r) => r.id === l.id); registros[i] = l; },
  };
  return { d, guardados };
}

describe('análisis en lote de lo capturado sin IA', () => {
  it('solo son candidatas las que tienen fotos, no tienen análisis y nadie llenó datos', () => {
    expect(sinAnalizar(lum(1))).toBe(true);
    expect(sinAnalizar(lum(2, { fabricante: 'Escrita a mano' }))).toBe(false);
    expect(sinAnalizar(lum(3, { confianza: 'alta' }))).toBe(false);
    expect(sinAnalizar(lum(4, { fotos: [] }))).toBe(false);
  });

  it('analiza solo las pendientes, en orden, rellena y reporta el progreso', async () => {
    const regs = [lum(3), lum(1), lum(2, { fabricante: 'Manual' })];
    const { d, guardados } = deps(regs);
    const avance: string[] = [];
    const r = await analizarPendientes(regs, d, (h, t) => avance.push(`${h}/${t}`));
    expect(r).toEqual({ hechas: 2, sinDatos: 0, omitidas: 0 });
    expect(guardados.map((g) => g.id)).toEqual([1, 3]);                              // en orden de captura; la manual no se toca
    expect(guardados[0]).toMatchObject({ fabricante: 'Philips', tecnologia: 'LED', confianza: 'alta' });
    expect(avance).toEqual(['1/2', '2/2']);
    expect(regs.find((x) => x.id === 2)!.fabricante).toBe('Manual');
  });

  it('si la IA no lee nada, la marca "baja" para no reintentarla eternamente', async () => {
    const regs = [lum(1)];
    const { d, guardados } = deps(regs, async () => ia({}));
    expect(await analizarPendientes(regs, d)).toMatchObject({ hechas: 1, sinDatos: 1 });
    expect(guardados[0].confianza).toBe('baja');
    expect(sinAnalizar(regs[0])).toBe(false);
  });

  it('se detiene en el primer error (sin conexión, clave inválida…) y deja el resto pendiente', async () => {
    const regs = [lum(1), lum(2), lum(3)];
    let n = 0;
    const { d, guardados } = deps(regs, async () => { if (++n === 2) throw new Error('Sin señal suficiente'); return ia(); });
    const r = await analizarPendientes(regs, d);
    expect(r).toMatchObject({ hechas: 1, error: 'Sin señal suficiente' });
    expect(guardados.map((g) => g.id)).toEqual([1]);
    expect(regs.filter(sinAnalizar).map((x) => x.id)).toEqual([2, 3]);
  });

  it('no pisa lo que el técnico escribió mientras se analizaba', async () => {
    const regs = [lum(1)];
    const { d, guardados } = deps(regs, async () => { regs[0] = { ...regs[0], fabricante: 'Escrita entre tanto' }; return ia(); });
    const r = await analizarPendientes(regs, d);
    expect(r).toMatchObject({ hechas: 0, omitidas: 1 });
    expect(guardados).toHaveLength(0);
    expect(regs[0].fabricante).toBe('Escrita entre tanto');
  });

  it('el técnico puede detener el lote', async () => {
    const regs = [lum(1), lum(2), lum(3)];
    const ctl = new AbortController();
    const { d, guardados } = deps(regs, async () => { ctl.abort(); return ia(); });
    const r = await analizarPendientes(regs, d, undefined, ctl.signal);
    expect(r.hechas).toBe(1);
    expect(guardados).toHaveLength(1);
  });

  it('sin pendientes no llama a la IA', async () => {
    const analizar = vi.fn();
    expect(await analizarPendientes([lum(1, { fabricante: 'X' })], deps([], analizar as any).d)).toEqual({ hechas: 0, sinDatos: 0, omitidas: 0 });
    expect(analizar).not.toHaveBeenCalled();
  });
});
