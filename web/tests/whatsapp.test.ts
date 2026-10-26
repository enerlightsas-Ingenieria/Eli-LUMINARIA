import { describe, expect, it } from 'vitest';
import { enlaceLlamada, enlaceWa, enlaceWaGeneral, telefonoWa } from '../src/servicios/whatsapp';

describe('teléfonos para WhatsApp', () => {
  it('un celular de 10 dígitos recibe el código de país de la empresa; lo que ya trae código se respeta', () => {
    expect(telefonoWa('300 123 4567')).toBe('573001234567');
    expect(telefonoWa('(300) 123-4567')).toBe('573001234567');
    expect(telefonoWa('+57 300 123 4567')).toBe('573001234567');
    expect(telefonoWa('573001234567')).toBe('573001234567');
    expect(telefonoWa('0057 300 123 4567')).toBe('573001234567');
    expect(telefonoWa('+1 555 123 4567')).toBe('15551234567');            // otro país: no se toca
    expect(telefonoWa('3001234567', '52')).toBe('523001234567');           // código configurable
  });
  it('rechaza lo que no es un teléfono', () => {
    for (const t of ['', 'abc', '123', '1'.repeat(16), '   ']) expect(telefonoWa(t)).toBe('');
  });
  it('arma los enlaces con el mensaje codificado; sin teléfono válido no hay enlace', () => {
    expect(enlaceWa('300 123 4567', 'Hola María, ¿todo bien? & más')).toBe('https://wa.me/573001234567?text=Hola%20Mar%C3%ADa%2C%20%C2%BFtodo%20bien%3F%20%26%20m%C3%A1s');
    expect(enlaceWa('xx', 'hola')).toBe('');
    expect(enlaceWaGeneral('Reunión a las 8')).toBe('https://wa.me/?text=Reuni%C3%B3n%20a%20las%208');
    expect(enlaceLlamada('300 123 4567')).toBe('tel:+573001234567');
    expect(enlaceLlamada('')).toBe('');
  });
});
