/**
 * Regresión de la segunda revisión: carreras entre envíos y cambios locales, jornadas, resiliencia y texto seguro.
 */
import { crearServidor, nueva, proyectoDe, telefono, Telefono } from './helpers/equipo';

const T0 = new Date('2026-03-10T08:00:00Z');
const TOKEN = 'CAMBIA-ESTE-TOKEN';
const minutos = (n: number) => jest.advanceTimersByTime(n * 60000);

describe('segunda revisión', () => {
  let srv: ReturnType<typeof crearServidor>;
  let A: Telefono, B: Telefono;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    srv = crearServidor(); (global as any).fetch = srv.llamar;
    A = telefono('Ana'); B = telefono('Beto');
  });
  afterEach(() => { jest.useRealTimers(); (global as any).fetch = undefined; });

  const esperar = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await Promise.resolve(); expect(cond()).toBe(true); };
  const jornadas = () => srv.hoja('_Jornadas')!.filas.slice(1);
  const equipo = () => srv.hoja('_Equipo')!.filas.slice(1);
  const latidoCrudo = (o: any) => srv.llamar('', { body: JSON.stringify({ token: TOKEN, accion: 'latido', dispositivo: 'd1', tecnico: 'Z', jornadaId: 'j1', inicio: T0.toISOString(), ...o }) }).then((r: any) => r.json());

  describe('envío de luminarias mientras se edita', () => {
    it('una edición hecha durante la subida NO se marca como enviada', async () => {
      const p = await proyectoDe(A, 'Barrio A');
      await nueva(A, p.id, { fabricante: 'Original' });
      let editado = false;
      (global as any).fetch = async (u: string, init: any) => {
        if (!editado && JSON.parse(init.body).luminarias?.length) {
          editado = true;
          minutos(1);                                              // pasa un instante y el técnico edita mientras sube
          const [l] = await A.db.listarLuminarias(p.id);
          await A.db.guardarLuminaria({ ...l, fabricante: 'Editada durante el envío' });
        }
        return srv.llamar(u, init);
      };
      await A.sync.sincronizar(p);
      expect((await A.db.listarLuminarias(p.id))[0]).toMatchObject({ fabricante: 'Editada durante el envío', sincronizado: false });
      (global as any).fetch = srv.llamar;
      await A.sync.sincronizar(p);                                 // la edición viaja en el siguiente envío
      expect(srv.hoja('Barrio A')!.filas[1][srv.hoja('Barrio A')!.filas[0].indexOf('Fabricante')]).toBe('Editada durante el envío');
      expect((await A.db.listarLuminarias(p.id))[0].sincronizado).toBe(true);
    });

    it('un proyecto que falla no impide sincronizar los demás (sincronizarTodo)', async () => {
      const malo = await proyectoDe(A, 'Malo'); const bueno = await proyectoDe(A, 'Bueno');
      await nueva(A, malo.id, { fabricante: 'M' }); await nueva(A, bueno.id, { fabricante: 'B' });
      (global as any).fetch = (u: string, init: any) => JSON.parse(init.body).proyecto?.nombre === 'Malo'
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: false, error: 'pestaña rota' }) })
        : srv.llamar(u, init);
      expect(await A.sync.sincronizarTodo()).toBeGreaterThan(0);   // no lanza: lo logrado cuenta
      expect(await A.db.pendientesDeSync(bueno.id)).toHaveLength(0);
      expect(await A.db.pendientesDeSync(malo.id)).toHaveLength(1);
    });

    it('si TODO falla, sincronizarTodo informa el error (no lo traga en silencio)', async () => {
      const p = await proyectoDe(A, 'X'); await nueva(A, p.id);
      (global as any).fetch = async () => { throw new Error('sin red'); };
      await expect(A.sync.sincronizarTodo()).rejects.toThrow(/Sin conexión/);
    });
  });

  describe('jornada: carreras y cierres', () => {
    const iniciar = async (t: Telefono) => { await t.jornada.registrarConsentimiento(); return t.jornada.iniciarJornada(); };

    it('un latido en vuelo no borra un "Terminar" tocado mientras viajaba', async () => {
      await iniciar(A);                                            // sinEnviar = true
      let liberar: (() => void) | null = null;
      (global as any).fetch = (u: string, init: any) => new Promise((res) => { liberar = () => res(srv.llamar(u, init)); });
      const enVuelo = A.jornada.enviarLatido('X');                 // sale el latido "activa"
      await esperar(() => liberar !== null);
      minutos(30);
      await A.jornada.cambiarFase('terminada');                    // el técnico termina entretanto
      liberar!();
      expect(await enVuelo).toBe(true);
      const e = await A.jornada.cargarJornada();
      expect(e).toMatchObject({ fase: 'terminada', sinEnviar: true }); // el cierre sigue pendiente (no se confirmó el estado viejo)
      (global as any).fetch = srv.llamar;
      await A.jornada.enviarLatido('X');
      expect(equipo()[0][2]).toBe('Terminada');
      expect((await A.jornada.cargarJornada()).sinEnviar).toBe(false);
    });

    it('el servidor ignora un latido atrasado que intente reabrir una jornada ya cerrada', async () => {
      await latidoCrudo({ estado: 'activa', latitud: 4.7, longitud: -74 });
      minutos(30);
      await latidoCrudo({ estado: 'terminada', fin: new Date().toISOString() });
      const cerrada = new Date().toISOString();
      const tarde = await latidoCrudo({ estado: 'pausada' });       // llega después, pero era anterior
      expect(tarde).toMatchObject({ ok: true, ignorado: true });
      expect(equipo()[0][2]).toBe('Terminada');
      expect((jornadas()[0][4] as Date).toISOString()).toBe(cerrada);
      // una jornada NUEVA (otro id) del mismo dispositivo sí se acepta
      await latidoCrudo({ estado: 'activa', jornadaId: 'j2', latitud: 4.8, longitud: -74 });
      expect(equipo()[0][2]).toBe('En jornada');
    });

    it('iniciar una jornada nueva no pierde el cierre pendiente de la anterior', async () => {
      const p = await proyectoDe(A, 'X');
      const j1 = await iniciar(A);
      await A.jornada.enviarLatido('X');
      minutos(10);
      await nueva(A, p.id, { fabricante: 'en j1', jornadaId: j1.id, creadoEn: new Date().toISOString() });
      minutos(50);
      await A.jornada.cambiarFase('terminada');                    // 09:00
      (global as any).fetch = async () => { throw new Error('sin red'); };
      expect(await A.jornada.enviarLatido('X')).toBe(false);
      minutos(15 * 60);                                            // al día siguiente, aún sin señal
      const j2 = await A.jornada.iniciarJornada();                 // arranca otra jornada con el cierre sin enviar
      expect(j2.id).not.toBe(j1.id);
      (global as any).fetch = srv.llamar;                          // vuelve la señal
      await A.jornada.enviarLatido('X');
      const [f1, f2] = jornadas();
      expect((f1[4] as Date).toISOString()).toBe('2026-03-10T09:00:00.000Z');   // la jornada 1 SÍ quedó cerrada, a su hora real
      expect(f1[5]).toBe(1); expect(f1[6]).toBe(1);                              // 1 h y 1 luminaria de esa jornada
      expect(f2[4]).toBe('');                                                    // la 2 sigue abierta
      expect(equipo()[0][2]).toBe('En jornada');
      expect(JSON.parse((await A.db.leerKv('jornadasPorCerrar')) ?? '[]')).toEqual([]);   // cola vaciada
    });

    it('un latido que no responde se abandona a los 20 s (la app no se cuelga)', async () => {
      await iniciar(A);
      (global as any).fetch = (_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('abortado'))));
      const p = A.jornada.enviarLatido('X');
      await jest.advanceTimersByTimeAsync(20001);
      expect(await p).toBe(false);
      expect((await A.jornada.cargarJornada()).sinEnviar).toBe(true);   // se reintentará
    });
  });

  describe('texto seguro en la hoja', () => {
    it('textos con fórmula se guardan con un espacio delante y vuelven intactos; los números negativos no se tocan', async () => {
      const pA = await proyectoDe(A, 'Barrio A'); const pB = await proyectoDe(B, 'Barrio A');
      await nueva(A, pA.id, { tecnologia: '-abc', observaciones: '=calibrar()', numeroTransformador: '+5', fabricante: '@x', longitud: -74.0721, potenciaW: '-12' });
      await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
      const h = srv.hoja('Barrio A')!; const fila = h.filas[1]; const cab = h.filas[0];
      expect(fila[cab.indexOf('Observaciones')]).toBe(' =calibrar()');          // texto, no fórmula (y sin depender de apóstrofos)
      expect(fila[cab.indexOf('N.º transformador')]).toBe(' +5');
      expect(fila[cab.indexOf('Tecnología')]).toBe(' -abc');
      expect(fila[cab.indexOf('Longitud')]).toBe(-74.0721);                      // número negativo intacto
      expect(fila[cab.indexOf('Potencia (W)')]).toBe(-12);
      const [l] = await B.db.listarLuminarias(pB.id);
      expect(l).toMatchObject({ observaciones: '=calibrar()', numeroTransformador: '+5', fabricante: '@x', tecnologia: '-abc' }); // la app recorta el espacio
    });
  });
});
