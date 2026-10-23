/**
 * Utilidades de prueba: servidor = script REAL de Google Apps Script sobre una hoja simulada;
 * teléfono = base SQLite propia + módulos reales (db, sync, jornada) aislados.
 */
import { DatabaseSync } from 'node:sqlite';

export { Hoja, crearServidor } from './hoja';
import { crearServidor } from './hoja';

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
