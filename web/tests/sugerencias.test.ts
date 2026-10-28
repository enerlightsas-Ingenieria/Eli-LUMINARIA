import { describe, expect, it } from 'vitest';
import { filtrarSugerencias, textoDeOtro, valoresUsados } from '../src/servicios/sugerencias';

const l = (fabricante: string, creadoEn = '2026-01-01') => ({ fabricante, creadoEn });

describe('sugerencias de lo ya escrito', () => {
  it('valoresUsados: del más usado al menos usado; a igualdad, el más reciente; sin repetir mayúsculas; sin vacíos', () => {
    const items = [l('Philips', '2026-01-01'), l('philips', '2026-01-02'), l(' Schréder ', '2026-01-03'), l('Lumenpulse', '2026-01-09'), l(''), l('Philips', '2026-01-04'), l('Schréder', '2026-01-05')];
    expect(valoresUsados(items, (x) => x.fabricante)).toEqual(['Philips', 'Schréder', 'Lumenpulse']);
    expect(valoresUsados(items, (x) => x.fabricante, 2)).toEqual(['Philips', 'Schréder']);
    expect(valoresUsados([], (x: any) => x.fabricante)).toEqual([]);
  });

  it('filtrarSugerencias: con el campo vacío, los más usados; escribiendo, primero lo que empieza igual y luego lo que contiene; sin el valor exacto', () => {
    const todas = ['Philips', 'Schréder', 'Lumenpulse', 'Phi-Led', 'Alpha'];
    expect(filtrarSugerencias(todas, '')).toEqual(todas);
    expect(filtrarSugerencias(todas, '', 2)).toEqual(['Philips', 'Schréder']);
    expect(filtrarSugerencias(todas, 'ph')).toEqual(['Philips', 'Phi-Led', 'Alpha']);
    expect(filtrarSugerencias(todas, '  PHILIPS ')).toEqual([]);                    // ya está escrito: no se vuelve a proponer
    expect(filtrarSugerencias(todas, 'zzz')).toEqual([]);
  });

  it('textoDeOtro: saca lo que se escribió en "Otra: …" / "Otro: …"', () => {
    expect(textoDeOtro('Otra: Plasma')).toBe('Plasma');
    expect(textoDeOtro('otro:  en torre ')).toBe('en torre');
    expect(textoDeOtro('Otra')).toBe('');
    expect(textoDeOtro('LED')).toBe('');
  });
});
