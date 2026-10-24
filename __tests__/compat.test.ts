/**
 * Regresión de la revisión final: hojas creadas con una versión anterior del script, auditoría en hojas grandes,
 * y posición de respaldo del GPS.
 */
import { crearServidor, Hoja, nueva, proyectoDe, telefono } from './helpers/equipo';

// Diseño de columnas anterior a la evidencia de captura (27 columnas): lo que dejó una versión previa del script.
const ENCABEZADO_ANTIGUO = ['UUID', 'ID (local del teléfono)', 'Código del poste', 'Código de la luminaria', 'Fecha', 'Técnico', 'Latitud', 'Longitud', 'Precisión (m)', 'Dirección',
  'Fabricante', 'Modelo', 'Tecnología', 'Potencia (W)', 'Tensión (V)', 'Fotocelda', 'Pines fotocelda',
  'Temp. color (K)', 'IP', 'Montaje', 'Estado', 'Confianza IA', 'Observaciones', 'Enlace mapa', 'Foto', 'Eliminada', 'Recibido'];

// Diseño anterior al cambio de campos (con Marca, Tipo de luminaria, Flujo y Altura): se archiva, no se mezcla.
const ENCABEZADO_RETIRADO = ['UUID', 'ID (local del teléfono)', 'Código activo', 'Fecha', 'Técnico', 'Latitud', 'Longitud', 'Precisión (m)', 'Dirección',
  'Marca', 'Fabricante', 'Modelo', 'Tipo de luminaria', 'Tecnología', 'Potencia (W)', 'Tensión (V)', 'Fotocelda', 'Pines fotocelda',
  'Temp. color (K)', 'Flujo (lm)', 'IP', 'Montaje', 'Altura (m)', 'Estado', 'Confianza IA', 'Observaciones', 'Enlace mapa', 'Foto', 'Eliminada', 'Recibido'];

const filaAntigua = (uuid: string, fabricante: string, eliminada = '', recibido = '2026-03-01T10:00:00.000Z') => {
  const f: any[] = Array(27).fill('');
  f[0] = uuid; f[4] = '2026-03-01T09:00:00.000Z'; f[5] = 'Ana'; f[6] = 4.7; f[7] = -74.07; f[10] = fabricante; f[25] = eliminada; f[26] = recibido;
  return f;
};

const post = (srv: ReturnType<typeof crearServidor>, cuerpo: any) =>
  srv.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', ...cuerpo }) }).then((r: any) => r.json());

describe('pestañas creadas con una versión anterior del script (27 columnas)', () => {
  let srv: ReturnType<typeof crearServidor>, vieja: Hoja;

  beforeEach(() => {
    srv = crearServidor();
    vieja = new Hoja('Barrio A');
    vieja.maxColumnas = 27;
    vieja.filas = [[...ENCABEZADO_ANTIGUO], filaAntigua('u1', 'Vieja'), filaAntigua('u2', 'Borrada', 'SÍ')];
    srv.hojas.push(vieja);
  });

  it('la descarga entiende las columnas antiguas (la eliminada sigue siendo eliminada)', async () => {
    const r = await post(srv, { accion: 'listar', proyecto: { nombre: 'Barrio A' }, desde: '' });
    expect(r.ok).toBe(true);
    const por = Object.fromEntries(r.luminarias.map((l: any) => [l.uuid, l]));
    expect(por.u1).toMatchObject({ fabricante: 'Vieja', recibidoEn: '2026-03-01T10:00:00.000Z' });
    expect(por.u2.eliminada).toBe('SÍ');
  });

  it('al enviar, completa los encabezados nuevos al final y no mueve ni pisa los datos existentes', async () => {
    const r = await post(srv, { proyecto: { nombre: 'Barrio A' }, luminarias: [{ uuid: 'u3', fabricante: 'Nueva', tecnico: 'Beto', creadoEn: '2026-03-10T08:00:00.000Z', origen: 'camara', jornadaId: 'j', latitud: 4.8, longitud: -74.1, ubicacionSimulada: false }] });
    expect(r.ok).toBe(true);
    expect(vieja.maxColumnas).toBeGreaterThanOrEqual(31);
    expect(vieja.filas[0].slice(27, 31)).toEqual(['Origen de la foto', 'Ubicación simulada', 'ID jornada', 'Alertas']);
    expect(vieja.filas[0].slice(0, 27)).toEqual(ENCABEZADO_ANTIGUO);
    expect(vieja.filas[1].slice(0, 27)).toEqual(filaAntigua('u1', 'Vieja'));          // fila vieja intacta (salvo columnas nuevas)
    expect(vieja.filas[2][25]).toBe('SÍ');                                              // la eliminada sigue marcada
    expect(vieja.filas[3][0]).toBe('u3');
    expect(vieja.filas[3][27]).toBe('camara');                                          // origen en la columna 28
    const otra = await post(srv, { proyecto: { nombre: 'Barrio A' }, luminarias: [{ uuid: 'u2', fabricante: 'Intento de revivir' }] });
    expect(otra.ok).toBe(true);
    expect(vieja.filas[2][10]).toBe('Borrada');                                          // lo eliminado sigue ganando
  });

  it('el mapa en vivo no falla con una pestaña antigua sin tocar', () => {
    const d = srv.gs.datosEquipo('CAMBIA-ESTE-TOKEN-ADMIN');
    expect(d.calidad.Ana.total).toBe(1);                                                // cuenta la viva, no la eliminada
    expect(d.luminarias).toHaveLength(1);
  });

  it('auditarTodo también funciona sobre pestañas antiguas', () => {
    expect(() => srv.gs.auditarTodo()).not.toThrow();
    expect(vieja.filas[0][30]).toBe('Alertas');                                         // columna Alertas creada
    expect(vieja.filas[1][30] ?? '').toBe('');
  });
});

describe('pestañas con el diseño retirado (Marca, Tipo, Flujo, Altura)', () => {
  it('se archivan sin tocar un dato y la pestaña nueva nace con el diseño actual', async () => {
    const srv = crearServidor();
    const vieja = new Hoja('Barrio A'); vieja.maxColumnas = 30;
    const fila: any[] = Array(30).fill(''); fila[0] = 'u1'; fila[9] = 'Philips'; fila[29] = '2026-03-01T10:00:00.000Z';
    vieja.filas = [[...ENCABEZADO_RETIRADO], fila];
    srv.hojas.push(vieja);
    const r = await post(srv, { proyecto: { nombre: 'Barrio A' }, luminarias: [{ uuid: 'n1', fabricante: 'Schréder', tecnico: 'Ana' }] });
    expect(r.ok).toBe(true);
    expect(vieja.getName()).toBe('Barrio A (anterior)');
    expect(vieja.filas[1][9]).toBe('Philips');                                          // intacta
    const nueva = srv.hoja('Barrio A')!;
    expect(nueva).not.toBe(vieja);
    expect(nueva.filas[0].slice(0, 4)).toEqual(['UUID', 'ID (local del teléfono)', 'Código del poste', 'Código de la luminaria']);
    expect(nueva.filas[0]).not.toContain('Marca');
    expect(nueva.filas[1][0]).toBe('n1');
    await post(srv, { proyecto: { nombre: 'Barrio A' }, luminarias: [{ uuid: 'n2', fabricante: 'X' }] });
    expect(srv.hojas.filter((h: any) => h.getName().startsWith('Barrio A'))).toHaveLength(2);   // no se vuelve a archivar
  });
});

describe('auditoría en hojas grandes', () => {
  it('no se recalcula en cada envío si la pestaña pasa de 3000 filas; sí con auditarTodo', async () => {
    const srv = crearServidor();
    const h = new Hoja('Grande'); h.maxColumnas = 31;
    const cab = [...ENCABEZADO_ANTIGUO, 'Origen de la foto', 'Ubicación simulada', 'ID jornada', 'Alertas'];
    h.filas = [cab];
    for (let i = 0; i < 3001; i++) { const f = filaAntigua('g' + i, 'M' + i); f.push('galeria', '', 'j', ''); f[5] = 'T' + (i % 50); f[6] = 4 + i * 0.001; h.filas.push(f); }
    srv.hojas.push(h);
    await post(srv, { proyecto: { nombre: 'Grande' }, luminarias: [{ uuid: 'nueva', fabricante: 'X', tecnico: 'Z', origen: 'galeria', creadoEn: '2026-03-10T08:00:00.000Z' }] });
    expect(h.filas[1][30]).toBe('');                                                    // no se auditó en línea
    srv.gs.auditarTodo();
    expect(h.filas[1][30]).toContain('GALERIA');                                        // el activador por tiempo sí
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

describe('limpieza de pestañas obsoletas', () => {
  const nuevoProyecto = async (srv: ReturnType<typeof crearServidor>, nombre: string, conDatos: boolean) => {
    await post(srv, { accion: 'listar', proyecto: { nombre }, desde: '' });                    // crea la pestaña con encabezados
    if (conDatos) await post(srv, { proyecto: { nombre }, luminarias: [{ uuid: 'x-' + nombre, fabricante: 'F' }] });
  };

  it('propone solo lo que ya no se usa: archivadas "(anterior)", hojas en blanco de Google y proyectos vacíos', async () => {
    const srv = crearServidor();
    await nuevoProyecto(srv, 'Barrio A', true);                       // con datos → se queda
    await nuevoProyecto(srv, 'Barrio Vacío', false);                  // sin registros → obsoleta
    srv.hojas.push(new Hoja('Hoja 1'));                               // en blanco de Google → obsoleta
    const vieja = new Hoja('Prueba (anterior)'); vieja.filas = [['Marca'], ['x'], ['y']]; srv.hojas.push(vieja);
    const vieja2 = new Hoja('Prueba (anterior 2)'); vieja2.filas = [['Marca'], ['z']]; srv.hojas.push(vieja2);
    srv.gs.prepararUsuarios();                                        // sistema → se queda
    await post(srv, { token: 'CAMBIA-ESTE-TOKEN', accion: 'latido', dispositivo: 'd', tecnico: 'Ana', estado: 'activa' });   // _Equipo, _Jornadas
    const obs = srv.gs.pestanasObsoletas();
    expect(obs.map((p: any) => p.nombre).sort()).toEqual(['Barrio Vacío', 'Hoja 1', 'Prueba (anterior 2)', 'Prueba (anterior)']);
    expect(obs.find((p: any) => p.nombre === 'Prueba (anterior)').filas).toBe(2);
  });

  it('nunca propone pestañas del sistema ni proyectos con datos, aunque tengan nombres raros', async () => {
    const srv = crearServidor();
    await nuevoProyecto(srv, 'Zona Norte', true);
    const h = new Hoja('hoja1'); h.filas = [['Mis notas'], ['importante']]; srv.hojas.push(h);   // parece de Google pero tiene contenido
    srv.gs.prepararUsuarios();
    await post(srv, { token: 'CAMBIA-ESTE-TOKEN', accion: 'latido', dispositivo: 'd', tecnico: 'Ana', estado: 'activa' });
    const nombres = srv.gs.pestanasObsoletas().map((p: any) => p.nombre);
    expect(nombres).toEqual([]);
    for (const n of ['_Usuarios', '_Equipo', '_Jornadas', 'Zona Norte']) expect(srv.hoja(n)).toBeDefined();
  });

  it('eliminarPestanas borra solo las indicadas y deja siempre al menos una pestaña', async () => {
    const srv = crearServidor();
    await nuevoProyecto(srv, 'Barrio A', true);
    const vieja = new Hoja('Prueba (anterior)'); vieja.filas = [['Marca'], ['x']]; srv.hojas.push(vieja);
    expect(srv.gs.eliminarPestanas(['Prueba (anterior)', 'No existe'])).toEqual(['Prueba (anterior)']);
    expect(srv.hoja('Barrio A')).toBeDefined(); expect(srv.hoja('Prueba (anterior)')).toBeUndefined();
    expect(srv.gs.eliminarPestanas(['Barrio A'])).toEqual([]);          // era la última: no se borra
    expect(srv.hojas).toHaveLength(1);
  });
});

describe('reinicio total desde cero', () => {
  const poblado = async () => {
    const srv = crearServidor();
    for (const n of ['Barrio A', 'Barrio B']) await post(srv, { proyecto: { nombre: n }, luminarias: [{ uuid: 'u-' + n, fabricante: 'F', tecnico: 'Ana' }] });
    await post(srv, { token: 'CAMBIA-ESTE-TOKEN', accion: 'latido', dispositivo: 'd', tecnico: 'Ana', estado: 'activa' });
    srv.gs.prepararUsuarios();
    srv.hoja('_Usuarios')!.appendRow(['Ana', 'tecnico', 'clave123', 'si']);
    await post(srv, { token: 'CAMBIA-ESTE-TOKEN-ADMIN', accion: 'config_guardar', clave: 'ia', valor: 'claude' });
    srv.hojas.push(new Hoja('Prueba (anterior)'));
    srv.carpetas.push({ nombre: 'ELI-LUMINARIA Fotos', papelera: false }, { nombre: 'Otra carpeta', papelera: false });
    return srv;
  };

  it('borra proyectos, jornadas, equipo y archivadas; conserva usuarios y la IA elegida; manda a la papelera solo la carpeta de fotos', async () => {
    const srv = await poblado();
    const r = srv.gs.reiniciarDatos(false);
    expect(srv.hojas.map((h: any) => h.getName()).sort()).toEqual(['_Config', '_Usuarios']);
    expect(r).toMatchObject({ carpetasDeFotos: 1, usuarios: 'conservados' });
    expect(srv.carpetas.map((c) => c.papelera)).toEqual([true, false]);              // la otra carpeta de Drive no se toca
    expect(srv.hoja('_Usuarios')!.filas[2][0]).toBe('Ana');
  });

  it('con usuarios=true también borra _Usuarios y aun así queda una pestaña', async () => {
    const srv = await poblado();
    srv.gs.reiniciarDatos(true);
    expect(srv.hojas.map((h: any) => h.getName())).toEqual(['_Config']);
    const solo = crearServidor(); await post(solo, { proyecto: { nombre: 'X' }, luminarias: [{ uuid: 'a' }] });
    solo.gs.reiniciarDatos(true);
    expect(solo.hojas.length).toBeGreaterThanOrEqual(1);                              // Google exige al menos una
  });

  it('tras el reinicio el sistema arranca limpio: se crea el proyecto otra vez y no queda nada del anterior', async () => {
    const srv = await poblado();
    srv.gs.reiniciarDatos(false);
    const r = await post(srv, { accion: 'listar', proyecto: { nombre: 'Barrio A' }, desde: '' });
    expect(r.ok).toBe(true); expect(r.luminarias).toEqual([]);
    expect(srv.gs.datosEquipo('CAMBIA-ESTE-TOKEN-ADMIN').tecnicos).toEqual([]);
  });
});
