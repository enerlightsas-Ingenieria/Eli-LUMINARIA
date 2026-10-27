import { decidir, normalizarRemota } from '../src/lib/fusion';

describe('fusion', () => {
  const r = (o: any = {}) => normalizarRemota({ uuid: 'u1', fabricante: 'X', ...o })!;

  it('normaliza lo que devuelve Sheets (números, fechas, vacíos)', () => {
    const x = r({ potenciaW: 150, latitud: '4,711', longitud: -74.07, precisionM: '', creadoEn: new Date('2026-01-02T03:04:05Z'), confianza: 'rara', eliminada: 'SÍ', numeroTransformador: 12 });
    expect(x.datos).toMatchObject({ potenciaW: '150', latitud: 4.711, longitud: -74.07, precisionM: null, creadoEn: '2026-01-02T03:04:05.000Z', confianza: '', numeroTransformador: '12' });
    expect(x.eliminada).toBe(true);
    expect(normalizarRemota({ fabricante: 'sin uuid' })).toBeNull();
  });

  it.each([
    ['sin local → insertar', undefined, {}, false, 'insertar'],
    ['local sincronizado → actualizar', { sincronizado: true }, {}, false, 'actualizar'],
    ['local con cambios pendientes → omitir', { sincronizado: false }, {}, false, 'omitir'],
    ['eliminada y existe → borrar', { sincronizado: true }, { eliminada: 'SÍ' }, false, 'borrar'],
    ['eliminada aunque haya cambios pendientes → borrar', { sincronizado: false }, { eliminada: 'SÍ' }, false, 'borrar'],
    ['eliminada y no existe → omitir', undefined, { eliminada: 'SÍ' }, false, 'omitir'],
    ['yo la borré (pendiente de enviar) → omitir', undefined, {}, true, 'omitir'],
  ])('%s', (_n, local, o, tomb, esperado) => {
    expect(decidir(local as any, r(o), tomb as boolean)).toBe(esperado);
  });
});
