/**
 * Regresión de la revisión final: hojas creadas con una versión anterior del script, auditoría en hojas grandes,
 * y posición de respaldo del GPS.
 */
import { crearServidor, Hoja, nueva, proyectoDe, telefono } from './helpers/equipo';

const ENCABEZADO_ANTIGUO = ['UUID', 'ID (local del teléfono)', 'Código activo', 'Fecha', 'Técnico', 'Latitud', 'Longitud', 'Precisión (m)', 'Dirección',
  'Marca', 'Fabricante', 'Modelo', 'Tipo de luminaria', 'Tecnología', 'Potencia (W)', 'Tensión (V)', 'Fotocelda', 'Pines fotocelda',
  'Temp. color (K)', 'Flujo (lm)', 'IP', 'Montaje', 'Altura (m)', 'Estado', 'Confianza IA', 'Observaciones', 'Enlace mapa', 'Foto', 'Eliminada', 'Recibido'];

const filaAntigua = (uuid: string, marca: string, eliminada = '', recibido = '2026-03-01T10:00:00.000Z') => {
  const f: any[] = Array(30).fill('');
  f[0] = uuid; f[3] = '2026-03-01T09:00:00.000Z'; f[4] = 'Ana'; f[5] = 4.7; f[6] = -74.07; f[9] = marca; f[28] = eliminada; f[29] = recibido;
  return f;
};

const post = (srv: ReturnType<typeof crearServidor>, cuerpo: any) =>
  srv.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', ...cuerpo }) }).then((r: any) => r.json());

describe('pestañas creadas con una versión anterior del script (30 columnas)', () => {
  let srv: ReturnType<typeof crearServidor>, vieja: Hoja;

  beforeEach(() => {
    srv = crearServidor();
    vieja = new Hoja('Barrio A');
    vieja.maxColumnas = 30;
    vieja.filas = [[...ENCABEZADO_ANTIGUO], filaAntigua('u1', 'Vieja'), filaAntigua('u2', 'Borrada', 'SÍ')];
    srv.hojas.push(vieja);
  });

  it('la descarga entiende las columnas antiguas (la eliminada sigue siendo eliminada)', async () => {
    const r = await post(srv, { accion: 'listar', proyecto: { nombre: 'Barrio A' }, desde: '' });
    expect(r.ok).toBe(true);
    const por = Object.fromEntries(r.luminarias.map((l: any) => [l.uuid, l]));
    expect(por.u1).toMatchObject({ marca: 'Vieja', recibidoEn: '2026-03-01T10:00:00.000Z' });
    expect(por.u2.eliminada).toBe('SÍ');
  });

  it('al enviar, completa los encabezados nuevos al final y no mueve ni pisa los datos existentes', async () => {
    const r = await post(srv, { proyecto: { nombre: 'Barrio A' }, luminarias: [{ uuid: 'u3', marca: 'Nueva', tecnico: 'Beto', creadoEn: '2026-03-10T08:00:00.000Z', origen: 'camara', jornadaId: 'j', latitud: 4.8, longitud: -74.1, ubicacionSimulada: false }] });
    expect(r.ok).toBe(true);
    expect(vieja.maxColumnas).toBeGreaterThanOrEqual(34);
    expect(vieja.filas[0].slice(30, 34)).toEqual(['Origen de la foto', 'Ubicación simulada', 'ID jornada', 'Alertas']);
    expect(vieja.filas[0].slice(0, 30)).toEqual(ENCABEZADO_ANTIGUO);
    expect(vieja.filas[1].slice(0, 30)).toEqual(filaAntigua('u1', 'Vieja'));          // fila vieja intacta (salvo columnas nuevas)
    expect(vieja.filas[2][28]).toBe('SÍ');                                              // la eliminada sigue marcada
    expect(vieja.filas[3][0]).toBe('u3');
    expect(vieja.filas[3][30]).toBe('camara');                                          // origen en la columna 31
    const otra = await post(srv, { proyecto: { nombre: 'Barrio A' }, luminarias: [{ uuid: 'u2', marca: 'Intento de revivir' }] });
    expect(otra.ok).toBe(true);
    expect(vieja.filas[2][9]).toBe('Borrada');                                          // lo eliminado sigue ganando
  });

  it('el mapa en vivo no falla con una pestaña antigua sin tocar', () => {
    const d = srv.gs.datosEquipo('CAMBIA-ESTE-TOKEN-ADMIN');
    expect(d.calidad.Ana.total).toBe(1);                                                // cuenta la viva, no la eliminada
    expect(d.luminarias).toHaveLength(1);
  });

  it('auditarTodo también funciona sobre pestañas antiguas', () => {
    expect(() => srv.gs.auditarTodo()).not.toThrow();
    expect(vieja.filas[0][33]).toBe('Alertas');                                         // columna Alertas creada
    expect(vieja.filas[1][33] ?? '').toBe('');
  });
});

describe('auditoría en hojas grandes', () => {
  it('no se recalcula en cada envío si la pestaña pasa de 3000 filas; sí con auditarTodo', async () => {
    const srv = crearServidor();
    const h = new Hoja('Grande'); h.maxColumnas = 34;
    const cab = [...ENCABEZADO_ANTIGUO, 'Origen de la foto', 'Ubicación simulada', 'ID jornada', 'Alertas'];
    h.filas = [cab];
    for (let i = 0; i < 3001; i++) { const f = filaAntigua('g' + i, 'M' + i); f.push('galeria', '', 'j', ''); f[4] = 'T' + (i % 50); f[5] = 4 + i * 0.001; h.filas.push(f); }
    srv.hojas.push(h);
    await post(srv, { proyecto: { nombre: 'Grande' }, luminarias: [{ uuid: 'nueva', marca: 'X', tecnico: 'Z', origen: 'galeria', creadoEn: '2026-03-10T08:00:00.000Z' }] });
    expect(h.filas[1][33]).toBe('');                                                    // no se auditó en línea
    srv.gs.auditarTodo();
    expect(h.filas[1][33]).toContain('GALERIA');                                        // el activador por tiempo sí
  });
});

describe('posición de respaldo del GPS', () => {
  const cargar = (current: () => Promise<any>, ultima: jest.Mock) => {
    let mod: any;
    jest.isolateModules(() => {
      jest.doMock('expo-location', () => ({
        Accuracy: { High: 4, Balanced: 3 },
        requestForegroundPermissionsAsync: async () => ({ granted: true }),
        getCurrentPositionAsync: current,
        getLastKnownPositionAsync: ultima,
      }));
      jest.doMock('expo-image-picker', () => ({}));
      jest.doMock('expo-image-manipulator', () => ({ manipulateAsync: async () => ({}), SaveFormat: { JPEG: 'jpeg' } }));
      mod = require('../src/services/captura');
    });
    return mod as typeof import('../src/services/captura');
  };

  it('para registrar una luminaria, si falla el GPS solo acepta una lectura de ≤ 15 s', async () => {
    const ultima = jest.fn().mockResolvedValue(null);                                   // el sistema no tiene nada tan reciente
    const m = cargar(async () => { throw new Error('GPS apagado'); }, ultima);
    expect(await m.obtenerPosicion('alta')).toBeNull();
    expect(ultima).toHaveBeenCalledWith({ maxAge: 15000 });
  });

  it('si hay una lectura reciente la usa, conservando la marca de ubicación simulada', async () => {
    const m = cargar(async () => { throw new Error('x'); }, jest.fn().mockResolvedValue({ coords: { latitude: 4.7, longitude: -74.07, accuracy: 9 }, mocked: true }));
    expect(await m.obtenerPosicion('alta')).toEqual({ latitud: 4.7, longitud: -74.07, precisionM: 9, simulada: true });
  });

  it('para un latido el respaldo admite hasta 5 min', async () => {
    const ultima = jest.fn().mockResolvedValue(null);
    const m = cargar(async () => { throw new Error('x'); }, ultima);
    await m.obtenerPosicion('balanceada');
    expect(ultima).toHaveBeenLastCalledWith({ maxAge: 300000 });
  });
});

describe('mapa en vivo: salidas HTML escapadas', () => {
  // Leaflet inserta el texto de tooltips y popups como HTML. Un nombre de técnico o una marca llegan de los teléfonos:
  // todo lo que se pase a bindTooltip/bindPopup debe pasar por esc() (verificado también en un navegador real durante la revisión).
  const fuente = require('fs').readFileSync(require('path').join(__dirname, '../server/google-apps-script.gs'), 'utf8');
  it('todo bindTooltip y bindPopup de la página del supervisor escapa los datos', () => {
    const llamadas = fuente.match(/\.bind(Tooltip|Popup)\([^;]*/g) ?? [];
    expect(llamadas.length).toBeGreaterThanOrEqual(3);
    for (const l of llamadas) expect(l).toMatch(/\.bind(Tooltip|Popup)\((esc\(|'<b>' \+ esc\()/);
  });
  it('la página nunca asigna HTML con datos (solo textContent)', () => {
    expect(fuente).not.toMatch(/\.innerHTML\s*=\s*[^'\s]/);
  });
});
