/**
 * Integración: varios técnicos sobre el mismo proyecto.
 * Cada "teléfono" usa su propia base SQLite y el código real de db.ts / sync.ts;
 * el servidor es el script REAL de Google Apps Script (server/google-apps-script.gs) sobre una hoja simulada.
 */
import { crearServidor, nueva, proyectoDe, telefono, Telefono } from './helpers/equipo';

describe('equipo: varios técnicos, mismo proyecto', () => {
  let srv: ReturnType<typeof crearServidor>;
  let A: Telefono, B: Telefono;
  let pA: any, pB: any;

  beforeEach(async () => {
    srv = crearServidor();
    (global as any).fetch = srv.llamar;
    A = telefono('Ana'); B = telefono('Beto');
    pA = await proyectoDe(A, 'Barrio A');
    pB = await proyectoDe(B, 'barrio   a'); // otro nombre "casi igual": debe caer en la misma pestaña
  });
  afterEach(() => { (global as any).fetch = undefined; });

  it('los registros de todos llegan a la hoja y a todos los teléfonos, sin duplicar', async () => {
    await nueva(A, pA.id, { fabricante: 'Philips', potenciaW: '150', modelo: '1-2', latitud: 4.711 });
    await nueva(A, pA.id, { fabricante: 'Schréder', potenciaW: '70', latitud: 4.712 });
    await nueva(B, pB.id, { fabricante: 'Lumenpulse', potenciaW: '100', latitud: 4.713 });

    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const rA = await A.sync.sincronizar(pA); // ahora A baja lo de Beto
    await B.sync.sincronizar(pB);

    expect(srv.hojas).toHaveLength(1);                         // una sola pestaña
    expect(srv.hojas[0].filas).toHaveLength(1 + 3);            // cabecera + 3 luminarias
    expect(rA.recibidas).toBeGreaterThanOrEqual(1);

    for (const [t, p] of [[A, pA], [B, pB]] as const) {
      const ls = await t.db.listarLuminarias(p.id);
      expect(ls.map((l) => l.fabricante).sort()).toEqual(['Lumenpulse', 'Philips', 'Schréder']);
      expect(ls.every((l) => l.sincronizado)).toBe(true);
    }
    const lsA = await A.db.listarLuminarias(pA.id);
    const philips = lsA.find((l) => l.fabricante === 'Philips')!;
    expect(philips).toMatchObject({ potenciaW: '150', modelo: '1-2', tecnico: 'Ana' }); // números y "1-2" sobreviven a Sheets
    expect(lsA.find((l) => l.fabricante === 'Lumenpulse')!.tecnico).toBe('Beto');            // se ve quién lo hizo
    expect(lsA.find((l) => l.fabricante === 'Lumenpulse')!.fotos).toEqual([]);               // las fotos no viajan sin la opción
  });

  it('una edición de un técnico llega a los demás', async () => {
    const id = await nueva(A, pA.id, { fabricante: 'Philips', tecnologia: 'LED' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const [l] = await A.db.listarLuminarias(pA.id);
    await A.db.guardarLuminaria({ ...l, id, fabricante: 'Philips Lumileds', pinesFotocelda: '7' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    expect((await B.db.listarLuminarias(pB.id))[0]).toMatchObject({ fabricante: 'Philips Lumileds', pinesFotocelda: '7' });
    expect(srv.hojas[0].filas).toHaveLength(2); // actualiza la fila, no añade otra
  });

  it('un cambio local pendiente no se pisa al descargar y gana al enviarse', async () => {
    const id = await nueva(A, pA.id, { fabricante: 'Original' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const [lB] = await B.db.listarLuminarias(pB.id);
    await B.db.guardarLuminaria({ ...lB, fabricante: 'Edición de Beto' }); // pendiente en B
    const [lA] = await A.db.listarLuminarias(pA.id);
    await A.db.guardarLuminaria({ ...lA, id, fabricante: 'Edición de Ana' });
    await A.sync.sincronizar(pA);                                      // Ana llega primero a la hoja
    await B.sync.sincronizar(pB);                                      // Beto: no se pisa su cambio pendiente; luego lo envía
    expect((await B.db.listarLuminarias(pB.id))[0].fabricante).toBe('Edición de Beto');
    await A.sync.sincronizar(pA);
    expect((await A.db.listarLuminarias(pA.id))[0].fabricante).toBe('Edición de Beto'); // última escritura al servidor gana
  });

  it('un borrado se propaga, no resucita y se conserva en la hoja para auditoría', async () => {
    await nueva(A, pA.id, { fabricante: 'Borrar' });
    await nueva(A, pA.id, { fabricante: 'Quedarse' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    expect(await B.db.listarLuminarias(pB.id)).toHaveLength(2);

    const aBorrar = (await A.db.listarLuminarias(pA.id)).find((l) => l.fabricante === 'Borrar')!;
    await A.db.borrarLuminaria(aBorrar);
    expect(await A.db.borradasPendientes(pA.id)).toHaveLength(1);
    await A.sync.sincronizar(pA);
    expect(await A.db.borradasPendientes(pA.id)).toHaveLength(0);

    const rB = await B.sync.sincronizar(pB);
    expect(rB.borradasRemotas).toBe(1);
    expect((await B.db.listarLuminarias(pB.id)).map((l) => l.fabricante)).toEqual(['Quedarse']);
    await A.sync.sincronizar(pA);                                       // no reaparece en quien la borró
    expect((await A.db.listarLuminarias(pA.id)).map((l) => l.fabricante)).toEqual(['Quedarse']);
    const fila = srv.hojas[0].filas.find((f) => f[10] === 'Borrar')!;      // la fila sigue, marcada
    expect(fila).toBeDefined(); expect(fila.includes('SÍ')).toBe(true);
  });

  it('si alguien edita algo que otro borró, el borrado gana', async () => {
    await nueva(A, pA.id, { fabricante: 'X' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const [lB] = await B.db.listarLuminarias(pB.id);
    await B.db.guardarLuminaria({ ...lB, fabricante: 'Edit tardía de Beto' });
    await A.db.borrarLuminaria((await A.db.listarLuminarias(pA.id))[0]);
    await A.sync.sincronizar(pA);
    await B.sync.sincronizar(pB); // envía su edición (se ignora) y descarga el borrado
    expect(await B.db.listarLuminarias(pB.id)).toHaveLength(0);
  });

  it('un técnico sin señal conserva su trabajo y lo envía después sin duplicar', async () => {
    await nueva(A, pA.id, { fabricante: 'Offline 1' }); await nueva(A, pA.id, { fabricante: 'Offline 2' });
    (global as any).fetch = async () => { throw new Error('sin red'); };
    await expect(A.sync.sincronizar(pA)).rejects.toThrow(/Sin conexión/);
    expect(await A.db.pendientesDeSync(pA.id)).toHaveLength(2);
    (global as any).fetch = srv.llamar;                                  // vuelve la señal
    await A.sync.sincronizar(pA); await A.sync.sincronizar(pA);          // reintentos repetidos no duplican
    expect(srv.hojas[0].filas).toHaveLength(3);
    expect(await A.db.pendientesDeSync(pA.id)).toHaveLength(0);
  });

  it('token incorrecto: ningún dato se escribe ni se marca como enviado', async () => {
    await nueva(A, pA.id, { fabricante: 'Z' });
    (global as any).fetch = (u: string, init: any) => srv.llamar(u, { ...init, body: init.body.replace('CAMBIA-ESTE-TOKEN', 'otro') });
    await expect(A.sync.sincronizar(pA)).rejects.toThrow(/Token inválido/);
    expect(srv.hojas.flatMap((h) => h.filas)).toHaveLength(0);
    expect(await A.db.pendientesDeSync(pA.id)).toHaveLength(1);
  });
});
