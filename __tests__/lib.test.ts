import { aCsv, aGeoJson, aKml } from '../src/lib/formats';
import { distanciaM, masCercano, coordenadaValida } from '../src/lib/geo';
import { normalizaTecnologia, resumir } from '../src/lib/stats';
import { caracteristicasVacias, Luminaria } from '../src/types';

const base = (o: Partial<Luminaria> = {}): Luminaria => ({
  ...caracteristicasVacias(), id: 1, uuid: 'u1', proyectoId: 1, creadoEn: '2026-01-01T00:00:00Z',
  actualizadoEn: '2026-01-01T00:00:00Z', fotos: [], latitud: 4.711, longitud: -74.0721, precisionM: 5.4,
  direccion: '', codigo: 'P-001', tecnico: 'Ana', confianza: 'alta', sincronizado: false, ...o,
});

describe('geo', () => {
  it('calcula distancias', () => {
    const d = distanciaM({ latitud: 4.711, longitud: -74.072 }, { latitud: 4.712, longitud: -74.072 });
    expect(d).toBeGreaterThan(105); expect(d).toBeLessThan(117);
  });
  it('encuentra el más cercano dentro del radio', () => {
    const r = masCercano({ latitud: 4.711, longitud: -74.0721 }, [base({ id: 2, latitud: 4.71102 }), base({ id: 3, latitud: 5 })], 10);
    expect(r?.item.id).toBe(2);
    expect(masCercano({ latitud: 0.5, longitud: 0.5 }, [base()], 10)).toBeNull();
  });
  it('valida coordenadas', () => {
    expect(coordenadaValida(4, -74)).toBe(true);
    expect(coordenadaValida(null, 1)).toBe(false);
    expect(coordenadaValida(91, 0)).toBe(false);
    expect(coordenadaValida(0, 0)).toBe(false);
  });
});

describe('formatos', () => {
  it('CSV escapa comas, comillas y fórmulas', () => {
    const csv = aCsv([base({ marca: 'A,B', modelo: 'Dice "x"', observaciones: '=HYPERLINK("x")' })]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"Dice ""x"""');
    expect(csv).toContain(`'=HYPERLINK`);
  });
  it('CSV no altera números negativos (longitud)', () => {
    expect(aCsv([base()])).toContain('-74.0721');
  });
  it('GeoJSON usa [lng, lat] y omite sin coordenada', () => {
    const g = JSON.parse(aGeoJson([base(), base({ id: 2, latitud: null })]));
    expect(g.features).toHaveLength(1);
    expect(g.features[0].geometry.coordinates).toEqual([-74.0721, 4.711]);
  });
  it('KML escapa XML', () => {
    const k = aKml([base({ marca: 'A&B <x>' })]);
    expect(k).toContain('&amp;'); expect(k).not.toContain('<x>');
    expect(k).toContain('-74.0721,4.711,0');
  });
});

describe('stats', () => {
  it('normaliza tecnologías', () => {
    expect(normalizaTecnologia('led 4000K')).toBe('LED');
    expect(normalizaTecnologia('Sodio alta presión (est.)')).toBe('Sodio alta presión');
    expect(normalizaTecnologia('')).toBe('Sin identificar');
  });
  it('resume potencia y conteos', () => {
    const r = resumir([base({ potenciaW: '150', tecnologia: 'LED', pinesFotocelda: '7' }), base({ id: 2, potenciaW: '70,5', tecnologia: 'led', sincronizado: true })]);
    expect(r.total).toBe(2); expect(r.potenciaTotalKw).toBeCloseTo(0.221, 2);
    expect(r.porTecnologia[0]).toEqual({ nombre: 'LED', cantidad: 2 });
    expect(r.sincronizadas).toBe(1);
  });
});
