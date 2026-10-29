import { describe, expect, it } from 'vitest';
import { armarDireccion, leerPartes, tieneNumeroDePuerta } from '../src/servicios/direccion';

describe('direcciones colombianas', () => {
  it('armarDireccion: "Calle 35 No. 86 - 92, Medellín" con lo que haya', () => {
    expect(armarDireccion({ tipo: 'Calle', via: '35', numero: '86', placa: '92', resto: 'Medellín' })).toBe('Calle 35 No. 86 - 92, Medellín');
    expect(armarDireccion({ tipo: 'Carrera', via: '80 sur', numero: '12', placa: '', resto: '' })).toBe('Carrera 80 sur No. 12');
    expect(armarDireccion({ tipo: 'Calle', via: '35', numero: '', placa: '92', resto: '' })).toBe('Calle 35');   // la placa sola no se escribe
    expect(armarDireccion({ tipo: '', via: '', numero: '', placa: '', resto: 'Vereda La Palma' })).toBe('Vereda La Palma');
  });

  it('leerPartes entiende abreviaturas y distintas formas de escribir la placa', () => {
    expect(leerPartes('Calle 35 No. 86 - 92, Medellín')).toEqual({ tipo: 'Calle', via: '35', numero: '86', placa: '92', resto: 'Medellín' });
    expect(leerPartes('Cra 7 #12-30')).toEqual({ tipo: 'Carrera', via: '7', numero: '12', placa: '30', resto: '' });
    expect(leerPartes('Cl. 35 # 86 - 92')).toMatchObject({ tipo: 'Calle', via: '35', numero: '86', placa: '92' });
    expect(leerPartes('Avenida 80 sur No. 3-4')).toMatchObject({ tipo: 'Avenida', via: '80 sur', numero: '3', placa: '4' });
    expect(leerPartes('Calle 35')).toEqual({ tipo: 'Calle', via: '35', numero: '', placa: '', resto: '' });
    expect(leerPartes('Frente a la iglesia')).toEqual({ tipo: '', via: '', numero: '', placa: '', resto: 'Frente a la iglesia' });
    expect(leerPartes('')).toEqual({ tipo: '', via: '', numero: '', placa: '', resto: '' });
  });

  it('armar(leer(x)) conserva una dirección bien escrita', () => {
    for (const d of ['Calle 35 No. 86 - 92, Medellín', 'Carrera 7 No. 12 - 30', 'Diagonal 40 No. 5']) expect(armarDireccion(leerPartes(d))).toBe(d);
  });

  it('tieneNumeroDePuerta distingue "Calle 35" de "Calle 35 No. 86 - 92"', () => {
    expect(tieneNumeroDePuerta('Calle 35 No. 86 - 92')).toBe(true);
    expect(tieneNumeroDePuerta('Cra 7 #12-30')).toBe(true);
    expect(tieneNumeroDePuerta('Calle 35, Medellín')).toBe(false);
    expect(tieneNumeroDePuerta('')).toBe(false);
  });
});
