import { beforeEach, describe, expect, it } from 'vitest';
import { aplicarConfigMapas, capasMapa, MAPAS_POR_DEFECTO } from '../src/servicios/mapas';

describe('fondos del mapa configurables por despliegue', () => {
  beforeEach(() => { aplicarConfigMapas(undefined); });

  it('sin configuración quedan los de por defecto', () => {
    expect(capasMapa()).toEqual(MAPAS_POR_DEFECTO);
    expect(aplicarConfigMapas({ calles: 5 })).toEqual(MAPAS_POR_DEFECTO);
  });

  it('acepta direcciones https con {z}/{x}/{y} (con la clave dentro) y la atribución del proveedor', () => {
    const r = aplicarConfigMapas({ calles: 'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=pk123', satelite: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=pk123', atribucion: '© MapTiler © OpenStreetMap' });
    expect(r.calles).toMatchObject({ url: 'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=pk123', atribucion: '© MapTiler © OpenStreetMap' });
    expect(r.satelite.url).toContain('satellite-v2');
    expect(capasMapa()).toBe(r);
  });

  it('rechaza lo inseguro o incompleto (http, sin {z}{x}{y}, esquemas raros) y solo deja texto en la atribución', () => {
    for (const malo of ['http://x.com/{z}/{x}/{y}.png', 'https://x.com/mapa.png', 'javascript:alert(1)', 'https://x.com/{z}/{x}.png', 'https://x.com/ {z}/{x}/{y}', 5, null]) {
      expect(aplicarConfigMapas({ calles: malo }).calles).toEqual(MAPAS_POR_DEFECTO.calles);
    }
    const r = aplicarConfigMapas({ calles: 'https://x.com/{z}/{x}/{y}.png', atribucion: '<img src=x onerror=alert(1)>© X' });
    expect(r.calles.atribucion).not.toMatch(/[<>]/);
    expect(r.satelite).toEqual(MAPAS_POR_DEFECTO.satelite);                       // solo cambia el que se configuró
  });
});
