import { aCsv, aGeoJson, aKml } from '../src/lib/formats';
import { distanciaM, masCercano, coordenadaValida } from '../src/lib/geo';
import { normalizaTecnologia, resumir } from '../src/lib/stats';
import { CAMPOS, caracteristicasVacias, Luminaria, normalizarTecnologia, TECNOLOGIAS } from '../src/types';

const base = (o: Partial<Luminaria> = {}): Luminaria => ({
  ...caracteristicasVacias(), id: 1, uuid: 'u1', proyectoId: 1, creadoEn: '2026-01-01T00:00:00Z',
  actualizadoEn: '2026-01-01T00:00:00Z', fotos: [], latitud: 4.711, longitud: -74.0721, precisionM: 5.4,
  direccion: '', codigoPoste: '', codigo: 'P-001', tecnico: 'Ana', confianza: 'alta', sincronizado: false, origen: 'camara', ubicacionSimulada: false, jornadaId: 'j1', ...o,
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
    const csv = aCsv([base({ fabricante: 'A,B', modelo: 'Dice "x"', observaciones: '=HYPERLINK("x")' })]);
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
    const k = aKml([base({ fabricante: 'A&B <x>' })]);
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

describe('campos de la luminaria (alumbrado público)', () => {
  const claves = CAMPOS.map((c) => c.key);
  it('ya no existen marca, tipo de luminaria, flujo luminoso ni altura', () => {
    for (const k of ['marca', 'tipoLuminaria', 'flujoLuminosoLm', 'alturaM']) {
      expect(claves).not.toContain(k); expect(Object.keys(caracteristicasVacias())).not.toContain(k);
    }
  });
  it('tecnologías: exactamente la lista acordada, con "Otra (¿cuál?)" al final', () => {
    expect(TECNOLOGIAS).toEqual(['LED', 'Sodio', 'Metal Halide', 'Mercurio', 'Fluorescente', 'Incandescente', 'Halógena', 'Inducción', 'Luz mixta', 'Otra (¿cuál?)']);
    expect(CAMPOS.find((c) => c.key === 'tecnologia')!.opciones).toEqual(TECNOLOGIAS);
  });
  it('montaje sin techo ni pared; estado sin "sin luminaria"', () => {
    expect(CAMPOS.find((c) => c.key === 'montaje')!.opciones).toEqual(['Poste', 'Brazo', 'Suspendida']);
    expect(CAMPOS.find((c) => c.key === 'estado')!.opciones).toEqual(['Bueno', 'Deteriorado', 'Apagada', 'Vandalizada']);
  });
  it('normalizarTecnologia lleva lo que diga la IA a la lista y deja el resto como "Otra: …"', () => {
    const casos: [string, string][] = [
      ['led', 'LED'], ['LED ', 'LED'], ['Sodio alta presión', 'Sodio'], ['sodio', 'Sodio'], ['Metal halide', 'Metal Halide'], ['Halogenuro metálico', 'Metal Halide'],
      ['halogena', 'Halógena'], ['Inducción', 'Inducción'], ['induccion', 'Inducción'], ['luz mixta', 'Luz mixta'], ['Mixta', 'Luz mixta'], ['Vapor de mercurio', 'Otra: Vapor de mercurio'],
      ['Mercurio', 'Mercurio'], ['Plasma', 'Otra: Plasma'], ['Otra: Láser', 'Otra: Láser'], ['otra:   Láser', 'Otra: Láser'], ['Otra', 'Otra'], ['', ''],
    ];
    for (const [entrada, esperado] of casos) expect(normalizarTecnologia(entrada)).toBe(esperado);
  });
  it('la hoja y las exportaciones traen el código del poste y de la luminaria, y nada de lo retirado', () => {
    const csv = aCsv([base({ codigoPoste: 'PT-9', codigo: 'LM-3' })]);
    const [cab, fila] = csv.replace('\ufeff', '').split('\r\n');
    expect(cab).toContain('Código del poste,Código de la luminaria');
    expect(fila).toContain('PT-9,LM-3');
    for (const h of ['Marca', 'Tipo de luminaria', 'Flujo (lm)', 'Altura (m)']) expect(cab).not.toContain(h);
    expect(aGeoJson([base({ codigoPoste: 'PT-9', codigo: 'LM-3' })])).toContain('"codigo_poste": "PT-9"');
  });
});
