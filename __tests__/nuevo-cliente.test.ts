import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const { crearCliente, renovar, argumentos, aSlug, claveLegible } = require('../server/nuevo-cliente.js');

/** "Aleatorio" predecible para las pruebas. */
let n = 0;
const falso = (largo: number) => Buffer.from(Array.from({ length: largo }, (_, i) => (i * 7 + ++n * 13) % 256));

describe('nuevo cliente: instalación y licencia', () => {
  const base = { nombre: 'Alcaldía de Soacha', vence: '2027-01-31', contacto: 'ventas@enerlight.co' };

  it('crea todos los archivos con el nombre del proxy, la web y la licencia de ese cliente', () => {
    const r = crearCliente(base, falso);
    expect(r.slug).toBe('alcaldia-de-soacha');
    expect(Object.keys(r.archivos).sort()).toEqual(['1-proxy.ps1', '2-web.ps1', 'LEEME.txt', 'apps-script.txt', 'cliente.json', 'entrega.txt', 'secretos.json', 'servidor.json']);
    const c = JSON.parse(r.archivos['cliente.json']);
    expect(c).toMatchObject({ nombre: 'Alcaldía de Soacha', vence: '2027-01-31', graciaDias: 15, proxy: 'eli-alcaldia-de-soacha-proxy', web: 'eli-alcaldia-de-soacha', codigoPais: '57', contacto: 'ventas@enerlight.co' });
    expect(JSON.parse(r.archivos['servidor.json'])).toEqual({ proxy: 'https://eli-alcaldia-de-soacha-proxy.enerlight.workers.dev', codigoPais: '57' });
    expect(r.archivos['1-proxy.ps1']).toContain('LICENCIA_VENCE:$($c.vence)');
    expect(r.archivos['2-web.ps1']).toContain('servidor.json');
    expect(r.archivos['LEEME.txt']).toContain('secret bulk clientes/alcaldia-de-soacha/secretos.json --name eli-alcaldia-de-soacha-proxy');
  });

  it('las claves son distintas, largas y se reparten en los archivos correctos (los mismos valores en el script y en los secretos)', () => {
    const r = crearCliente({ ...base, admin: 'Superusuario' }, falso);
    const s = JSON.parse(r.archivos['secretos.json']);
    expect(s.SYNC_TOKEN).toHaveLength(32); expect(s.SYNC_TOKEN_ADMIN).toHaveLength(32);
    expect(s.SYNC_TOKEN).not.toBe(s.SYNC_TOKEN_ADMIN);
    expect(s.ADMIN_TOKENS).toMatch(/^Superusuario:[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{4}$/);
    expect(r.archivos['apps-script.txt']).toContain(`TOKEN = ${s.SYNC_TOKEN}\n`);
    expect(r.archivos['apps-script.txt']).toContain(`TOKEN_ADMIN = ${s.SYNC_TOKEN_ADMIN}\n`);
    expect(r.archivos['apps-script.txt']).toContain('Propiedades del script');
    const clave = s.ADMIN_TOKENS.split(':')[1];
    expect(r.archivos['entrega.txt']).toContain(`Clave: ${clave}`);
    // las claves NO van a los archivos que se pueden compartir o subir
    for (const f of ['cliente.json', 'servidor.json', '1-proxy.ps1', '2-web.ps1', 'LEEME.txt']) { expect(r.archivos[f]).not.toContain(s.SYNC_TOKEN); expect(r.archivos[f]).not.toContain(clave); }
    expect(crearCliente(base, falso).archivos['secretos.json']).not.toBe(r.archivos['secretos.json']);   // cada cliente, claves nuevas
  });

  it('con el generador real las claves no se repiten', () => {
    const a = JSON.parse(crearCliente(base).archivos['secretos.json']), b = JSON.parse(crearCliente(base).archivos['secretos.json']);
    expect(a.SYNC_TOKEN).not.toBe(b.SYNC_TOKEN); expect(a.ADMIN_TOKENS).not.toBe(b.ADMIN_TOKENS);
  });

  it('valida lo que falta o está mal', () => {
    expect(() => crearCliente({ ...base, nombre: '' })).toThrow(/--nombre/);
    expect(() => crearCliente({ ...base, vence: '31/01/2027' })).toThrow(/--vence/);
    expect(() => crearCliente({ ...base, vence: '2027-13-45' })).toThrow(/--vence/);
    expect(() => crearCliente({ ...base, nombre: 'A', slug: 'a' })).toThrow(/slug/);
    expect(() => crearCliente({ ...base, gracia: '500' })).toThrow(/--gracia/);
    expect(() => crearCliente({ ...base, admin: 'a:b' })).toThrow(/--admin/);
    expect(crearCliente({ ...base, gracia: '0', pais: '+593', subdominio: 'otra' }, falso).archivos['servidor.json']).toContain('https://eli-alcaldia-de-soacha-proxy.otra.workers.dev');
  });

  it('fondos de mapa del proveedor: van en servidor.json (solo https con {z}{x}{y}); sin ellos no hay sección "mapas"', () => {
    expect(JSON.parse(crearCliente(base, falso).archivos['servidor.json']).mapas).toBeUndefined();
    const r = crearCliente({ ...base, mapaCalles: 'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=pk', mapaSatelite: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=pk', mapaAtribucion: '© MapTiler <b>' }, falso);
    expect(JSON.parse(r.archivos['servidor.json']).mapas).toEqual({ calles: 'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=pk', satelite: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=pk', atribucion: '© MapTiler b' });
    expect(() => crearCliente({ ...base, mapaCalles: 'http://x.com/{z}/{x}/{y}.png' }, falso)).toThrow(/--mapa-calles/);
    expect(() => crearCliente({ ...base, mapaSatelite: 'https://x.com/mapa.png' }, falso)).toThrow(/--mapa-satelite/);
  });

  it('aSlug quita tildes y símbolos; claveLegible no usa letras que se confunden', () => {
    expect(aSlug('Alcaldía de Medellín (Prueba) ')).toBe('alcaldia-de-medellin-prueba');
    for (let i = 0; i < 50; i++) expect(claveLegible(falso)).not.toMatch(/[01lio]/);
  });

  it('renovar cambia solo el vencimiento en cliente.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
    fs.writeFileSync(path.join(dir, 'cliente.json'), crearCliente(base, falso).archivos['cliente.json']);
    expect(renovar(dir, '2028-01-31')).toMatchObject({ vence: '2028-01-31', nombre: 'Alcaldía de Soacha', graciaDias: 15 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'cliente.json'), 'utf8')).vence).toBe('2028-01-31');
    expect(() => renovar(dir, 'pronto')).toThrow(/--vence/);
    expect(() => renovar(path.join(dir, 'no-existe'), '2028-01-31')).toThrow(/No existe/);
  });

  it('argumentos: lee --clave valor y rechaza lo desconocido', () => {
    expect(argumentos(['--nombre', 'X', '--vence', '2027-01-31', '--gracia', '7'])).toEqual({ nombre: 'X', vence: '2027-01-31', gracia: '7' });
    expect(() => argumentos(['suelto'])).toThrow(/no reconocido/);
  });
});
