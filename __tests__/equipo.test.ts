/**
 * Integración: varios técnicos sobre el mismo proyecto.
 * Cada "teléfono" usa su propia base SQLite y el código real de db.ts / sync.ts;
 * el servidor es el script REAL de Google Apps Script (server/google-apps-script.gs) corriendo sobre una hoja simulada.
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

/* ---------- Hoja de cálculo simulada (imita la conversión de Sheets: "150" → 150 salvo columnas de texto) ---------- */
class Hoja {
  filas: any[][] = [];
  formatos: Record<number, string> = {};
  constructor(public nombre: string) {}
  getName() { return this.nombre; }
  getLastRow() { return this.filas.length; }
  getMaxRows() { return 1000; }
  setFrozenRows() {}
  coac(x: any, col: number, cabecera = false) {
    if (typeof x === 'string' && x.startsWith("'") && /^'[=+@]/.test(x)) return x.slice(1); // el apóstrofo fuerza texto y no se guarda
    return typeof x === 'string' && !cabecera && this.formatos[col] !== '@' && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x;
  }
  appendRow(v: any[]) { const cab = this.filas.length === 0; this.filas.push(v.map((x, i) => this.coac(x, i + 1, cab))); }
  getRange(r: number, c: number, nr = 1, nc = 1) {
    const h = this;
    const api: any = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => h.filas[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (vals: any[][]) => vals.forEach((fila, i) => { h.filas[r - 1 + i] ??= []; fila.forEach((x, j) => { h.filas[r - 1 + i][c - 1 + j] = h.coac(x, c + j); }); }),
      getValue: () => h.filas[r - 1]?.[c - 1] ?? '',
      setValue: (x: any) => { h.filas[r - 1] ??= []; h.filas[r - 1][c - 1] = x; },
      setFontWeight: () => api, setBackground: () => api,
      setNumberFormat: (f: string) => { for (let j = 0; j < nc; j++) h.formatos[c + j] = f; return api; },
    };
    return api;
  }
}

function crearServidor() {
  const hojas: Hoja[] = [];
  const libro = { getSheets: () => hojas, insertSheet: (n: string) => { const h = new Hoja(n); hojas.push(h); return h; } };
  const fuente = fs.readFileSync(path.join(__dirname, '../server/google-apps-script.gs'), 'utf8');
  const gs = new Function('SpreadsheetApp', 'LockService', 'ContentService', 'DriveApp', 'Utilities', fuente + '\n;return { doPost };')(
    { getActiveSpreadsheet: () => libro },
    { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    { createTextOutput: (t: string) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    {}, {},
  );
  const llamar = async (_url: string, init: any) => {
    const salida = gs.doPost({ postData: { contents: init.body } });
    return { ok: true, status: 200, json: async () => JSON.parse(salida.t) } as any;
  };
  return { hojas, llamar };
}

/* ---------- Teléfono: base propia + módulos reales aislados ---------- */
function adaptador(motor: DatabaseSync) {
  return {
    execAsync: async (sql: string) => { motor.exec(sql); },
    getFirstAsync: async (sql: string, p: any[] = []) => motor.prepare(sql).get(...p),
    getAllAsync: async (sql: string, p: any[] = []) => motor.prepare(sql).all(...p),
    runAsync: async (sql: string, p: any[] = []) => { const r = motor.prepare(sql).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
  };
}

function telefono(tecnico: string) {
  let t: any;
  jest.isolateModules(() => {
    const motor = new DatabaseSync(':memory:');
    jest.doMock('expo-sqlite', () => ({ openDatabaseAsync: async () => adaptador(motor) }));
    jest.doMock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
    jest.doMock('../src/services/settings', () => ({
      cargarAjustes: async () => ({ syncUrl: 'https://gs.example/exec', syncToken: 'CAMBIA-ESTE-TOKEN', syncFotos: false, autoSync: true, tecnico }),
    }));
    jest.doMock('../src/services/fotos', () => ({ leerBase64: async () => '' }));
    t = { tecnico, db: require('../src/services/db'), sync: require('../src/services/sync') };
  });
  return t as { tecnico: string; db: typeof import('../src/services/db'); sync: typeof import('../src/services/sync') };
}

const nueva = (t: ReturnType<typeof telefono>, proyectoId: number, o: any = {}) => t.db.guardarLuminaria({
  ...require('../src/types').caracteristicasVacias(), uuid: require('crypto').randomUUID(), proyectoId,
  creadoEn: new Date().toISOString(), actualizadoEn: '', fotos: ['file:///local.jpg'], latitud: 4.7, longitud: -74.07,
  precisionM: 5, direccion: '', codigo: '', tecnico: t.tecnico, confianza: 'alta', ...o,
});

async function proyectoDe(t: ReturnType<typeof telefono>, nombre: string) {
  const id = await t.db.crearProyecto(nombre);
  return (await t.db.listarProyectos()).find((p) => p.id === id)!;
}

describe('equipo: varios técnicos, mismo proyecto', () => {
  let srv: ReturnType<typeof crearServidor>;
  let A: ReturnType<typeof telefono>, B: ReturnType<typeof telefono>;
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
    await nueva(A, pA.id, { marca: 'Philips', potenciaW: '150', modelo: '1-2', latitud: 4.711 });
    await nueva(A, pA.id, { marca: 'Schréder', potenciaW: '70', latitud: 4.712 });
    await nueva(B, pB.id, { marca: 'Lumenpulse', potenciaW: '100', latitud: 4.713 });

    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const rA = await A.sync.sincronizar(pA); // ahora A baja lo de Beto
    await B.sync.sincronizar(pB);

    expect(srv.hojas).toHaveLength(1);                         // una sola pestaña
    expect(srv.hojas[0].filas).toHaveLength(1 + 3);            // cabecera + 3 luminarias
    expect(rA.recibidas).toBeGreaterThanOrEqual(1);

    for (const [t, p] of [[A, pA], [B, pB]] as const) {
      const ls = await t.db.listarLuminarias(p.id);
      expect(ls.map((l) => l.marca).sort()).toEqual(['Lumenpulse', 'Philips', 'Schréder']);
      expect(ls.every((l) => l.sincronizado)).toBe(true);
    }
    const lsA = await A.db.listarLuminarias(pA.id);
    const philips = lsA.find((l) => l.marca === 'Philips')!;
    expect(philips).toMatchObject({ potenciaW: '150', modelo: '1-2', tecnico: 'Ana' }); // números y "1-2" sobreviven a Sheets
    expect(lsA.find((l) => l.marca === 'Lumenpulse')!.tecnico).toBe('Beto');            // se ve quién lo hizo
    expect(lsA.find((l) => l.marca === 'Lumenpulse')!.fotos).toEqual([]);               // las fotos no viajan sin la opción
  });

  it('una edición de un técnico llega a los demás', async () => {
    const id = await nueva(A, pA.id, { marca: 'Philips', tecnologia: 'LED' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const [l] = await A.db.listarLuminarias(pA.id);
    await A.db.guardarLuminaria({ ...l, id, marca: 'Philips Lumileds', pinesFotocelda: '7' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    expect((await B.db.listarLuminarias(pB.id))[0]).toMatchObject({ marca: 'Philips Lumileds', pinesFotocelda: '7' });
    expect(srv.hojas[0].filas).toHaveLength(2); // actualiza la fila, no añade otra
  });

  it('un cambio local pendiente no se pisa al descargar y gana al enviarse', async () => {
    const id = await nueva(A, pA.id, { marca: 'Original' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const [lB] = await B.db.listarLuminarias(pB.id);
    await B.db.guardarLuminaria({ ...lB, marca: 'Edición de Beto' }); // pendiente en B
    const [lA] = await A.db.listarLuminarias(pA.id);
    await A.db.guardarLuminaria({ ...lA, id, marca: 'Edición de Ana' });
    await A.sync.sincronizar(pA);                                      // Ana llega primero a la hoja
    await B.sync.sincronizar(pB);                                      // Beto: no se pisa su cambio pendiente; luego lo envía
    expect((await B.db.listarLuminarias(pB.id))[0].marca).toBe('Edición de Beto');
    await A.sync.sincronizar(pA);
    expect((await A.db.listarLuminarias(pA.id))[0].marca).toBe('Edición de Beto'); // última escritura al servidor gana
  });

  it('un borrado se propaga, no resucita y se conserva en la hoja para auditoría', async () => {
    await nueva(A, pA.id, { marca: 'Borrar' });
    await nueva(A, pA.id, { marca: 'Quedarse' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    expect(await B.db.listarLuminarias(pB.id)).toHaveLength(2);

    const aBorrar = (await A.db.listarLuminarias(pA.id)).find((l) => l.marca === 'Borrar')!;
    await A.db.borrarLuminaria(aBorrar);
    expect(await A.db.borradasPendientes(pA.id)).toHaveLength(1);
    await A.sync.sincronizar(pA);
    expect(await A.db.borradasPendientes(pA.id)).toHaveLength(0);

    const rB = await B.sync.sincronizar(pB);
    expect(rB.borradasRemotas).toBe(1);
    expect((await B.db.listarLuminarias(pB.id)).map((l) => l.marca)).toEqual(['Quedarse']);
    await A.sync.sincronizar(pA);                                       // no reaparece en quien la borró
    expect((await A.db.listarLuminarias(pA.id)).map((l) => l.marca)).toEqual(['Quedarse']);
    const fila = srv.hojas[0].filas.find((f) => f[9] === 'Borrar')!;      // la fila sigue, marcada
    expect(fila).toBeDefined(); expect(fila.includes('SÍ')).toBe(true);
  });

  it('si alguien edita algo que otro borró, el borrado gana', async () => {
    await nueva(A, pA.id, { marca: 'X' });
    await A.sync.sincronizar(pA); await B.sync.sincronizar(pB);
    const [lB] = await B.db.listarLuminarias(pB.id);
    await B.db.guardarLuminaria({ ...lB, marca: 'Edit tardía de Beto' });
    await A.db.borrarLuminaria((await A.db.listarLuminarias(pA.id))[0]);
    await A.sync.sincronizar(pA);
    await B.sync.sincronizar(pB); // envía su edición (se ignora) y descarga el borrado
    expect(await B.db.listarLuminarias(pB.id)).toHaveLength(0);
  });

  it('un técnico sin señal conserva su trabajo y lo envía después sin duplicar', async () => {
    await nueva(A, pA.id, { marca: 'Offline 1' }); await nueva(A, pA.id, { marca: 'Offline 2' });
    (global as any).fetch = async () => { throw new Error('sin red'); };
    await expect(A.sync.sincronizar(pA)).rejects.toThrow(/Sin conexión/);
    expect(await A.db.pendientesDeSync(pA.id)).toHaveLength(2);
    (global as any).fetch = srv.llamar;                                  // vuelve la señal
    await A.sync.sincronizar(pA); await A.sync.sincronizar(pA);          // reintentos repetidos no duplican
    expect(srv.hojas[0].filas).toHaveLength(3);
    expect(await A.db.pendientesDeSync(pA.id)).toHaveLength(0);
  });

  it('token incorrecto: ningún dato se escribe ni se marca como enviado', async () => {
    await nueva(A, pA.id, { marca: 'Z' });
    (global as any).fetch = (u: string, init: any) => srv.llamar(u, { ...init, body: init.body.replace('CAMBIA-ESTE-TOKEN', 'otro') });
    await expect(A.sync.sincronizar(pA)).rejects.toThrow(/Token inválido/);
    expect(srv.hojas.flatMap((h) => h.filas)).toHaveLength(0);
    expect(await A.db.pendientesDeSync(pA.id)).toHaveLength(1);
  });
});
