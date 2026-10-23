import { evaluarCaptura, galeriaPermitida } from '../src/lib/politicas';

const pos = (o: any = {}) => ({ latitud: 4.7, longitud: -74.07, precisionM: 8, ...o });
const base = { modoTerceros: true, jornadaActiva: true, posicion: pos(), precisionMaxM: 20 };

describe('políticas del modo terceros', () => {
  it('sin modo terceros todo está permitido (empleados)', () => {
    expect(evaluarCaptura({ ...base, modoTerceros: false, jornadaActiva: false, posicion: null })).toEqual({ ok: true });
    expect(galeriaPermitida(false)).toBe(true);
  });

  it('con modo terceros no hay galería', () => expect(galeriaPermitida(true)).toBe(false));

  it('captura válida: jornada activa, GPS preciso', () => expect(evaluarCaptura(base)).toEqual({ ok: true }));

  it('sin jornada activa se bloquea, antes que cualquier otra cosa', () => {
    expect(evaluarCaptura({ ...base, jornadaActiva: false, posicion: null })).toMatchObject({ ok: false, motivo: 'SIN_JORNADA' });
  });

  it.each([
    ['ubicación simulada', pos({ simulada: true }), 'UBICACION_SIMULADA'],
    ['sin posición', null, 'SIN_GPS'],
    ['precisión peor que el máximo', pos({ precisionM: 45 }), 'GPS_IMPRECISO'],
    ['precisión desconocida', pos({ precisionM: null }), 'GPS_IMPRECISO'],
  ])('bloquea: %s', (_n, posicion, motivo) => {
    const r = evaluarCaptura({ ...base, posicion: posicion as any });
    expect(r).toMatchObject({ ok: false, motivo });
    expect((r as any).mensaje).toMatch(/\S/);
  });

  it('el límite es inclusivo y configurable', () => {
    expect(evaluarCaptura({ ...base, posicion: pos({ precisionM: 20 }) }).ok).toBe(true);
    expect(evaluarCaptura({ ...base, posicion: pos({ precisionM: 20.1 }) }).ok).toBe(false);
    expect(evaluarCaptura({ ...base, posicion: pos({ precisionM: 45 }), precisionMaxM: 50 }).ok).toBe(true);
  });

  it('la ubicación simulada se detecta aunque la precisión sea buena', () => {
    expect(evaluarCaptura({ ...base, posicion: pos({ precisionM: 3, simulada: true }) })).toMatchObject({ motivo: 'UBICACION_SIMULADA' });
  });
});
