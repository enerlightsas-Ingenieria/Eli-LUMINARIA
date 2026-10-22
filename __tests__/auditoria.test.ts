/**
 * Auditoría de capturas (modo terceros) en el servidor: alertas por captura y su efecto de extremo a extremo.
 */
import { crearServidor, nueva, proyectoDe, telefono, Telefono } from './helpers/equipo';

const T0 = new Date('2026-03-10T08:00:00Z');
const minutos = (n: number) => jest.advanceTimersByTime(n * 60000);
const iso = (min: number) => new Date(T0.getTime() + min * 60000).toISOString();

describe('calcularAlertas (reglas puras del script)', () => {
  let calcular: (f: any[], j: any) => string[][];
  beforeAll(() => { jest.useFakeTimers({ now: T0 }); calcular = crearServidor().gs.calcularAlertas; jest.useRealTimers(); });

  const fila = (o: any = {}) => ({ uuid: Math.random().toString(36), tecnico: 'Ana', creadoEn: iso(10), latitud: 4.7, longitud: -74.07, precisionM: 8, origen: 'camara', ubicacionSimulada: '', jornadaId: 'j1', eliminada: '', ...o });
  const J = { j1: { inicio: T0.getTime(), fin: null as number | null } };

  it('una captura limpia no tiene alertas', () => expect(calcular([fila()], J)).toEqual([[]]));

  it.each([
    ['galería', { origen: 'galeria' }, 'GALERIA'],
    ['sin jornada', { jornadaId: '' }, 'SIN_JORNADA'],
    ['jornada desconocida', { jornadaId: 'zzz' }, 'JORNADA_NO_CONFIRMADA'],
    ['ubicación simulada', { ubicacionSimulada: 'SÍ' }, 'UBICACION_SIMULADA'],
    ['GPS impreciso', { precisionM: 40 }, 'GPS_IMPRECISO'],
    ['antes de iniciar la jornada', { creadoEn: iso(-30) }, 'FUERA_DE_JORNADA'],
  ])('%s → %s', (_n, o, codigo) => expect(calcular([fila(o)], J)[0]).toContain(codigo));

  it('captura tras terminar la jornada → FUERA_DE_JORNADA; con 2 min de tolerancia no', () => {
    const cerrada = { j1: { inicio: T0.getTime(), fin: T0.getTime() + 60 * 60000 } };
    expect(calcular([fila({ creadoEn: iso(61) })], cerrada)[0]).toEqual([]);
    expect(calcular([fila({ creadoEn: iso(64) })], cerrada)[0]).toEqual(['FUERA_DE_JORNADA']);
  });

  it('registros antiguos (sin origen) no se evalúan contra la jornada', () => {
    expect(calcular([fila({ origen: '', jornadaId: '' })], J)[0]).toEqual([]);
  });

  it('salto imposible: 5 km en 1 minuto marca la segunda captura; a pie no', () => {
    const r = calcular([fila({ latitud: 4.7, creadoEn: iso(10) }), fila({ latitud: 4.745, creadoEn: iso(11) })], J);
    expect(r[0]).toEqual([]); expect(r[1]).toEqual(['SALTO_IMPOSIBLE']);
    const andando = calcular([fila({ latitud: 4.7, creadoEn: iso(10) }), fila({ latitud: 4.7009, creadoEn: iso(12) })], J);
    expect(andando[1]).toEqual([]);                                     // ~100 m en 2 min
  });

  it('el salto se evalúa por técnico (dos técnicos lejos entre sí no se acusan)', () => {
    const r = calcular([fila({ tecnico: 'Ana', latitud: 4.7 }), fila({ tecnico: 'Beto', latitud: 4.9, creadoEn: iso(11) })], J);
    expect(r.flat()).toEqual([]);
  });

  it('agrupadas: 4 capturas en el mismo punto en pocos minutos; 3 no; separadas en el tiempo tampoco', () => {
    const mismoPunto = (n: number, sep: number) => Array.from({ length: n }, (_, i) => fila({ creadoEn: iso(10 + i * sep) }));
    expect(calcular(mismoPunto(4, 1), J).every((a) => a.includes('AGRUPADAS'))).toBe(true);
    expect(calcular(mismoPunto(3, 1), J).flat()).toEqual([]);
    expect(calcular(mismoPunto(4, 20), J).flat()).toEqual([]);          // una cada 20 min: no es ráfaga
  });

  it('las eliminadas no cuentan ni se alertan', () => {
    const f = [fila({ origen: 'galeria', eliminada: 'SÍ' }), ...Array.from({ length: 3 }, (_, i) => fila({ creadoEn: iso(10 + i) }))];
    expect(calcular(f, J).flat()).toEqual([]);                          // las 3 restantes no llegan a "agrupadas"
  });

  it('varias alertas a la vez', () => {
    expect(calcular([fila({ origen: 'galeria', precisionM: 60, jornadaId: '' })], J)[0]).toEqual(['GALERIA', 'SIN_JORNADA', 'GPS_IMPRECISO']);
  });
});

describe('auditoría de extremo a extremo', () => {
  let srv: ReturnType<typeof crearServidor>;
  let A: Telefono, B: Telefono, pA: any;

  beforeEach(async () => {
    jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    srv = crearServidor(); (global as any).fetch = srv.llamar;
    A = telefono('Ana'); B = telefono('Beto');
    pA = await proyectoDe(A, 'Barrio A');
  });
  afterEach(() => { jest.useRealTimers(); (global as any).fetch = undefined; });

  const alertasDe = (marca: string) => {
    const h = srv.hoja('Barrio A')!;
    const iM = h.filas[0].indexOf('Marca'), iA = h.filas[0].indexOf('Alertas');
    return h.filas.slice(1).find((f) => f[iM] === marca)![iA];
  };
  const iniciarJornada = async (t: Telefono) => { await t.jornada.registrarConsentimiento(); const j = await t.jornada.iniciarJornada(); await t.jornada.enviarLatido('Barrio A'); return j.id; };

  it('una captura correcta dentro de la jornada llega sin alertas', async () => {
    const jid = await iniciarJornada(A);
    minutos(5);
    await nueva(A, pA.id, { marca: 'Limpia', jornadaId: jid, creadoEn: new Date().toISOString(), precisionM: 6 });
    await A.sync.sincronizar(pA);
    expect(alertasDe('Limpia')).toBe('');
  });

  it('las trampas aparecen en la columna Alertas', async () => {
    const jid = await iniciarJornada(A);
    minutos(5);
    const ahora = () => new Date().toISOString();
    await nueva(A, pA.id, { marca: 'Galeria', jornadaId: jid, creadoEn: ahora(), origen: 'galeria', latitud: 4.1 });
    await nueva(A, pA.id, { marca: 'SinJornada', jornadaId: '', creadoEn: ahora(), latitud: 4.2 });
    await nueva(A, pA.id, { marca: 'Falso', jornadaId: jid, creadoEn: ahora(), ubicacionSimulada: true, latitud: 4.3 });
    await nueva(A, pA.id, { marca: 'Impreciso', jornadaId: jid, creadoEn: ahora(), precisionM: 80, latitud: 4.4 });
    await A.sync.sincronizar(pA);
    expect(alertasDe('Galeria')).toContain('GALERIA');
    expect(alertasDe('SinJornada')).toContain('SIN_JORNADA');
    expect(alertasDe('Falso')).toContain('UBICACION_SIMULADA');
    expect(alertasDe('Impreciso')).toContain('GPS_IMPRECISO');
  });

  it('usar el ID de una jornada ya cerrada para capturar fuera de horario se detecta', async () => {
    const jid = await iniciarJornada(A);
    minutos(60);
    await A.jornada.cambiarFase('terminada'); await A.jornada.enviarLatido('Barrio A');
    minutos(120);
    await nueva(A, pA.id, { marca: 'Trampa', jornadaId: jid, creadoEn: new Date().toISOString() });
    await A.sync.sincronizar(pA);
    expect(alertasDe('Trampa')).toContain('FUERA_DE_JORNADA');
  });

  it('JORNADA_NO_CONFIRMADA se resuelve sola cuando llega la jornada atrasada (auditarTodo)', async () => {
    await A.jornada.registrarConsentimiento();
    const j = await A.jornada.iniciarJornada();                     // sin conexión: el latido de inicio aún no llegó
    minutos(5);
    await nueva(A, pA.id, { marca: 'Tardia', jornadaId: j.id, creadoEn: new Date().toISOString() });
    await A.sync.sincronizar(pA);
    expect(alertasDe('Tardia')).toBe('JORNADA_NO_CONFIRMADA');
    await A.jornada.enviarLatido('Barrio A');                       // vuelve la señal y llega la jornada
    srv.gs.auditarTodo();
    expect(alertasDe('Tardia')).toBe('');
  });

  it('el supervisor ve la calidad por técnico en el mapa en vivo', async () => {
    const jidA = await iniciarJornada(A);
    minutos(5);
    for (let i = 0; i < 3; i++) { minutos(10); await nueva(A, pA.id, { marca: 'ok' + i, jornadaId: jidA, creadoEn: new Date().toISOString(), latitud: 4.7 + i * 0.01 }); } // ~1 km cada 10 min
    minutos(10);
    await nueva(A, pA.id, { marca: 'mala', jornadaId: jidA, creadoEn: new Date().toISOString(), origen: 'galeria', latitud: 4.9 });
    await A.sync.sincronizar(pA);
    const d = srv.gs.datosEquipo('CAMBIA-ESTE-TOKEN-ADMIN');
    expect(d.calidad.Ana.total).toBe(4);
    expect(d.calidad.Ana.conAlertas).toBe(1);
    expect(d.calidad.Ana.codigos).toMatchObject({ GALERIA: 1 });
  });

  it('la evidencia viaja a los demás técnicos y sobrevive al ida y vuelta (booleano incluido)', async () => {
    const pB = await proyectoDe(B, 'Barrio A');
    const jid = await iniciarJornada(A);
    await nueva(A, pA.id, { marca: 'Evidencia', jornadaId: jid, origen: 'galeria', ubicacionSimulada: true, creadoEn: new Date().toISOString() });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const [l] = await B.db.listarLuminarias(pB.id);
    expect(l).toMatchObject({ marca: 'Evidencia', origen: 'galeria', ubicacionSimulada: true, jornadaId: jid });
  });
});
