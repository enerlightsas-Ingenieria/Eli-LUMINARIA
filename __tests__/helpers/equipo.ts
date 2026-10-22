/**
 * Utilidades de prueba: servidor = script REAL de Google Apps Script sobre una hoja simulada;
 * teléfono = base SQLite propia + módulos reales (db, sync, jornada) aislados.
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

/** Hoja simulada (imita la conversión de Sheets: "150" → 150 salvo en columnas con formato texto). */
export class Hoja {
  filas: any[][] = [];
  formatos: Record<number, string> = {};
  formulas: Record<string, string> = {};
  constructor(public nombre: string) {}
  getName() { return this.nombre; }
  getLastRow() { return this.filas.length; }
  getMaxRows() { return 1000; }
  setFrozenRows() {}
  coac(x: any, col: number, cabecera = false) {
    if (typeof x === 'string' && /^'[=+@]/.test(x)) return x.slice(1); // el apóstrofo fuerza texto y no se guarda
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
      setFormulaR1C1: (f: string) => { h.formulas[`${r},${c}`] = f; },
      setFontWeight: () => api, setBackground: () => api,
      setNumberFormat: (f: string) => { for (let j = 0; j < nc; j++) h.formatos[c + j] = f; return api; },
    };
    return api;
  }
}

export function crearServidor() {
  const hojas: Hoja[] = [];
  const libro = { getSheets: () => hojas, insertSheet: (n: string) => { const h = new Hoja(n); hojas.push(h); return h; } };
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/google-apps-script.gs'), 'utf8');
  const html = { createHtmlOutput: (h: string) => ({ html: h, setTitle() { return this; }, addMetaTag() { return this; } }) };
  const gs = new Function('SpreadsheetApp', 'LockService', 'ContentService', 'DriveApp', 'Utilities', 'HtmlService',
    fuente + '\n;return { doPost, doGet, datosEquipo, calcularAlertas, auditarTodo };')(
    { getActiveSpreadsheet: () => libro },
    { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    { createTextOutput: (t: string) => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    {}, {}, html,
  );
  const llamar = async (_url: string, init: any) => {
    const salida = gs.doPost({ postData: { contents: init.body } });
    return { ok: true, status: 200, json: async () => JSON.parse(salida.t) } as any;
  };
  const hoja = (nombre: string) => hojas.find((h) => h.nombre === nombre);
  return { hojas, llamar, hoja, gs };
}

export function adaptador(motor: DatabaseSync) {
  return {
    execAsync: async (sql: string) => { motor.exec(sql); },
    getFirstAsync: async (sql: string, p: any[] = []) => motor.prepare(sql).get(...p),
    getAllAsync: async (sql: string, p: any[] = []) => motor.prepare(sql).all(...p),
    runAsync: async (sql: string, p: any[] = []) => { const r = motor.prepare(sql).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
  };
}

export interface Telefono {
  tecnico: string;
  /** Posición que devolverá el GPS simulado (null = sin permiso/sin señal GPS). */
  posicion: { latitud: number; longitud: number; precisionM: number | null } | null;
  /** Cuántas veces se consultó el GPS (para comprobar que en pausa no se consulta). */
  consultasGps: number;
  db: typeof import('../../src/services/db');
  sync: typeof import('../../src/services/sync');
  jornada: typeof import('../../src/services/jornada');
}

export function telefono(tecnico: string): Telefono {
  const t: any = { tecnico, consultasGps: 0, posicion: { latitud: 4.7, longitud: -74.07, precisionM: 12 } };
  jest.isolateModules(() => {
    const motor = new DatabaseSync(':memory:');
    jest.doMock('expo-sqlite', () => ({ openDatabaseAsync: async () => adaptador(motor) }));
    jest.doMock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
    jest.doMock('../../src/services/settings', () => ({
      cargarAjustes: async () => ({ syncUrl: 'https://gs.example/exec', syncToken: 'CAMBIA-ESTE-TOKEN', syncFotos: false, autoSync: true, tecnico }),
    }));
    jest.doMock('../../src/services/fotos', () => ({ leerBase64: async () => '' }));
    jest.doMock('../../src/services/captura', () => ({ obtenerPosicion: async () => { t.consultasGps++; return t.posicion; } }));
    t.db = require('../../src/services/db');
    t.sync = require('../../src/services/sync');
    t.jornada = require('../../src/services/jornada');
  });
  return t as Telefono;
}

export const nueva = (t: Telefono, proyectoId: number, o: any = {}) => t.db.guardarLuminaria({
  ...require('../../src/types').caracteristicasVacias(), uuid: require('crypto').randomUUID(), proyectoId,
  creadoEn: new Date().toISOString(), actualizadoEn: '', fotos: ['file:///local.jpg'], latitud: 4.7, longitud: -74.07,
  precisionM: 5, direccion: '', codigo: '', tecnico: t.tecnico, confianza: 'alta', origen: 'camara', ubicacionSimulada: false, jornadaId: '', ...o,
});

export async function proyectoDe(t: Telefono, nombre: string) {
  const id = await t.db.crearProyecto(nombre);
  return (await t.db.listarProyectos()).find((p) => p.id === id)!;
}
