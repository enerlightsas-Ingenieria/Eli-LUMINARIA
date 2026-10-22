/**
 * Monitoreo del equipo: jornadas, latidos, pestañas _Equipo/_Jornadas y mapa en vivo.
 * Teléfonos reales (db + jornada) contra el script REAL de Apps Script sobre una hoja simulada.
 */
import { crearServidor, nueva, proyectoDe, telefono, Telefono } from './helpers/equipo';

const TOKEN_EQUIPO = 'CAMBIA-ESTE-TOKEN';
const TOKEN_ADMIN = 'CAMBIA-ESTE-TOKEN-ADMIN';
const T0 = new Date('2026-03-10T08:00:00Z');
const minutos = (n: number) => jest.advanceTimersByTime(n * 60000);

describe('monitoreo de jornadas', () => {
  let srv: ReturnType<typeof crearServidor>;
  let A: Telefono, B: Telefono;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    srv = crearServidor();
    (global as any).fetch = srv.llamar;
    A = telefono('Ana'); B = telefono('Beto');
  });
  afterEach(() => { jest.useRealTimers(); (global as any).fetch = undefined; });

  const equipo = () => srv.hoja('_Equipo')!;
  const filaDe = (h: any, valor: string) => h.filas.find((f: any[]) => f.includes(valor));

  it('exige aceptar el aviso antes de iniciar y no envía nada sin jornada', async () => {
    await expect(A.jornada.iniciarJornada()).rejects.toThrow(/aviso/);
    expect(await A.jornada.enviarLatido('Barrio A')).toBe(false);
    expect(srv.hojas).toHaveLength(0);
    await A.jornada.registrarConsentimiento();
    expect(await A.jornada.haAceptado()).toBe(true);
    const e = await A.jornada.iniciarJornada();
    expect(e).toMatchObject({ fase: 'activa', sinEnviar: true });
    expect(e.id).toHaveLength(36);
  });

  it('un latido registra técnico, estado, posición y luminarias hechas desde el inicio', async () => {
    const p = await proyectoDe(A, 'Barrio A');
    await nueva(A, p.id, { creadoEn: new Date(T0.getTime() - 3600_000).toISOString() }); // antes de la jornada: no cuenta
    await A.jornada.registrarConsentimiento(); await A.jornada.iniciarJornada();
    minutos(10);
    await nueva(A, p.id); await nueva(A, p.id);
    await nueva(A, p.id, { tecnico: 'Otro' });                                              // de otro técnico: no cuenta
    expect(await A.jornada.enviarLatido('Barrio A')).toBe(true);

    const fila = filaDe(equipo(), 'Ana')!;
    expect(fila).toBeDefined();
    expect(fila.slice(1, 3)).toEqual(['Ana', 'En jornada']);
    expect(fila[4]).toBe(4.7); expect(fila[5]).toBe(-74.07); expect(fila[6]).toBe(12);
    expect(fila[7]).toBe('Barrio A'); expect(fila[8]).toBe(2);
    expect(fila[10]).toBe('ios');
    expect((await A.jornada.cargarJornada()).sinEnviar).toBe(false);
    expect(Object.values(equipo().formulas).some((f) => f.includes('Sin señal'))).toBe(true); // columna "Estado actual"
  });

  it('cada teléfono tiene su fila y los latidos repetidos la actualizan (no crecen)', async () => {
    for (const t of [A, B]) { await t.jornada.registrarConsentimiento(); await t.jornada.iniciarJornada(); }
    B.posicion = { latitud: 4.9, longitud: -74.2, precisionM: 30 };
    await A.jornada.enviarLatido('X'); await B.jornada.enviarLatido('X');
    for (let i = 0; i < 5; i++) { minutos(5); await A.jornada.enviarLatido('X'); await B.jornada.enviarLatido('X'); }
    expect(equipo().filas).toHaveLength(1 + 2);
    expect(srv.hoja('_Jornadas')!.filas).toHaveLength(1 + 2);
    expect(filaDe(equipo(), 'Beto')![4]).toBe(4.9);
  });

  it('en pausa NO se consulta ni se guarda la ubicación; al reanudar vuelve', async () => {
    await A.jornada.registrarConsentimiento(); await A.jornada.iniciarJornada();
    await A.jornada.enviarLatido('X');
    const antes = A.consultasGps;
    await A.jornada.cambiarFase('pausada');
    expect(await A.jornada.enviarLatido('X')).toBe(true);
    expect(A.consultasGps).toBe(antes);                                  // el GPS ni se toca
    let fila = filaDe(equipo(), 'Ana')!;
    expect(fila[2]).toBe('Pausada'); expect(fila[4]).toBe(''); expect(fila[5]).toBe('');
    await A.jornada.cambiarFase('activa');
    await A.jornada.enviarLatido('X');
    fila = filaDe(equipo(), 'Ana')!;
    expect(fila[2]).toBe('En jornada'); expect(fila[4]).toBe(4.7);
  });

  it('al terminar se borra la última posición y la jornada queda registrada con su duración', async () => {
    await A.jornada.registrarConsentimiento(); await A.jornada.iniciarJornada();
    await A.jornada.enviarLatido('X');
    minutos(90);
    await A.jornada.cambiarFase('terminada');
    await A.jornada.enviarLatido('X');
    const fila = filaDe(equipo(), 'Ana')!;
    expect(fila[2]).toBe('Terminada'); expect(fila[4]).toBe(''); expect(fila[5]).toBe('');
    const j = srv.hoja('_Jornadas')!.filas[1];
    expect(j[2]).toBe('Ana'); expect(j[5]).toBe(1.5);                    // horas
    expect(j[4]).toBeInstanceOf(Date);
    const fin = (j[4] as Date).getTime();
    minutos(30);
    await A.jornada.cambiarFase('terminada'); await A.jornada.enviarLatido('X'); // reintento tardío
    expect(srv.hoja('_Jornadas')!.filas[1][4].getTime()).toBe(fin);       // la hora de fin no se mueve
    expect(await A.jornada.enviarLatido('X')).toBe(false);                // ya enviado: nada más que mandar
  });

  it('sin conexión, el cierre queda pendiente y se envía al volver la señal', async () => {
    await A.jornada.registrarConsentimiento(); await A.jornada.iniciarJornada();
    await A.jornada.enviarLatido('X');
    await A.jornada.cambiarFase('terminada');
    (global as any).fetch = async () => { throw new Error('sin red'); };
    expect(await A.jornada.enviarLatido('X')).toBe(false);                // no lanza
    expect((await A.jornada.cargarJornada()).sinEnviar).toBe(true);
    (global as any).fetch = srv.llamar;
    expect(await A.jornada.enviarLatido('X')).toBe(true);
    expect((await A.jornada.cargarJornada()).sinEnviar).toBe(false);
    expect(filaDe(equipo(), 'Ana')![2]).toBe('Terminada');
  });

  it('una jornada olvidada se cierra sola a las 14 h', async () => {
    await A.jornada.registrarConsentimiento(); await A.jornada.iniciarJornada();
    const e = await A.jornada.cargarJornada(new Date(T0.getTime() + 15 * 3600_000));
    expect(e).toMatchObject({ fase: 'terminada', sinEnviar: true });
    expect((await A.jornada.cargarJornada(new Date(T0.getTime() + 15 * 3600_000))).fase).toBe('terminada');
  });

  it('una nueva jornada después de terminar es otra jornada (otro ID)', async () => {
    await A.jornada.registrarConsentimiento();
    const j1 = await A.jornada.iniciarJornada(); await A.jornada.enviarLatido('X');
    await A.jornada.cambiarFase('terminada'); await A.jornada.enviarLatido('X');
    minutos(60);
    const j2 = await A.jornada.iniciarJornada(); await A.jornada.enviarLatido('X');
    expect(j2.id).not.toBe(j1.id);
    expect(srv.hoja('_Jornadas')!.filas).toHaveLength(1 + 2);
    expect(equipo().filas).toHaveLength(1 + 1);                            // misma fila del dispositivo
  });

  describe('mapa en vivo (administrador)', () => {
    it('muestra "Sin señal" si una jornada activa lleva más de 15 min sin latidos', async () => {
      for (const t of [A, B]) { await t.jornada.registrarConsentimiento(); await t.jornada.iniciarJornada(); await t.jornada.enviarLatido('X'); }
      minutos(10);
      await A.jornada.enviarLatido('X');                                   // Ana sigue latiendo; Beto no
      let d = srv.gs.datosEquipo(TOKEN_ADMIN);
      expect(d.tecnicos.map((t: any) => [t.tecnico, t.estado]).sort()).toEqual([['Ana', 'En jornada'], ['Beto', 'En jornada']]);
      minutos(10);                                                         // Beto: 20 min sin señal; Ana: 10
      d = srv.gs.datosEquipo(TOKEN_ADMIN);
      expect(d.tecnicos.find((t: any) => t.tecnico === 'Beto')).toMatchObject({ estado: 'Sin señal', estadoReportado: 'En jornada' });
      expect(d.tecnicos.find((t: any) => t.tecnico === 'Ana').estado).toBe('En jornada');
      expect(typeof d.tecnicos[0].senal).toBe('string');                   // serializable para google.script.run
    });

    it('incluye las luminarias del equipo (sin las eliminadas ni las pestañas del sistema)', async () => {
      const pA = await proyectoDe(A, 'Barrio A');
      await nueva(A, pA.id, { marca: 'Visible', latitud: 4.71, longitud: -74.1 });
      await nueva(A, pA.id, { marca: 'Borrada', latitud: 4.72, longitud: -74.1 });
      await A.sync.sincronizar(pA);
      await A.db.borrarLuminaria((await A.db.listarLuminarias(pA.id)).find((l) => l.marca === 'Borrada')!);
      await A.sync.sincronizar(pA);
      await A.jornada.registrarConsentimiento(); await A.jornada.iniciarJornada(); await A.jornada.enviarLatido('Barrio A');
      const d = srv.gs.datosEquipo(TOKEN_ADMIN);
      expect(d.luminarias.map((l: any) => l.marca)).toEqual(['Visible']);
    });

    it('exige el token de administrador (el del equipo no sirve)', async () => {
      expect(() => srv.gs.datosEquipo(TOKEN_EQUIPO)).toThrow(/Acceso denegado/);
      expect(() => srv.gs.datosEquipo('')).toThrow(/Acceso denegado/);
      expect(srv.gs.doGet({ parameter: { vista: 'equipo', token: TOKEN_EQUIPO } }).html).toBe('Acceso denegado');
      expect(srv.gs.doGet({ parameter: { vista: 'equipo' } }).html).toBe('Acceso denegado');
    });

    it('con el token correcto sirve la página (con el token escapado) y sin él la API normal', () => {
      const pag = srv.gs.doGet({ parameter: { vista: 'equipo', token: TOKEN_ADMIN } }).html as string;
      expect(pag).toContain('google.script.run'); expect(pag).toContain('.datosEquipo(TOKEN)');
      expect(pag).toContain(`var TOKEN = "${TOKEN_ADMIN}";`);
      expect(pag).not.toContain('__TOKEN__');
      expect(JSON.parse(srv.gs.doGet({}).t)).toMatchObject({ ok: true });
    });
  });

  describe('validaciones del servidor', () => {
    const latido = (o: any) => srv.llamar('', { body: JSON.stringify({ token: TOKEN_EQUIPO, accion: 'latido', dispositivo: 'd1', tecnico: 'Z', estado: 'activa', jornadaId: 'j1', ...o }) }).then((r: any) => r.json());

    it('rechaza token inválido, estado inválido y dispositivo vacío sin escribir nada', async () => {
      expect(await latido({ token: 'otro' })).toMatchObject({ ok: false, error: 'Token inválido' });
      expect(await latido({ estado: 'hackeado' })).toMatchObject({ ok: false });
      expect(await latido({ dispositivo: '' })).toMatchObject({ ok: false });
      expect(srv.hojas).toHaveLength(0);
    });

    it('descarta coordenadas fuera de rango y recorta textos largos', async () => {
      expect((await latido({ latitud: 123, longitud: -74 })).ok).toBe(true);
      expect(equipo().filas[1][4]).toBe('');
      await latido({ tecnico: 'x'.repeat(500), plataforma: 'y'.repeat(500) });
      expect(equipo().filas[1][1]).toHaveLength(80); expect(equipo().filas[1][10]).toHaveLength(20);
    });

    it('un proyecto llamado "_Equipo" no puede pisar las pestañas del sistema', async () => {
      await latido({});
      const p = await proyectoDe(A, '_Equipo');
      await nueva(A, p.id, { marca: 'Intruso' });
      await A.sync.sincronizar(p);
      expect(srv.hojas.map((h) => h.nombre).sort()).toEqual(['Equipo', '_Equipo', '_Jornadas']);
      expect(equipo().filas.flat().includes('Intruso')).toBe(false);
      expect(srv.hoja('Equipo')!.filas.flat().includes('Intruso')).toBe(true);
    });
  });
});
