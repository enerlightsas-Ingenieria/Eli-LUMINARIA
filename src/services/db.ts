import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { Caracteristicas, caracteristicasVacias, Luminaria, LuminariaBorrador, Proyecto } from '../types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const CAR_COLS = Object.keys(caracteristicasVacias()) as (keyof Caracteristicas)[];
const COLS = [
  'uuid', 'proyectoId', 'creadoEn', 'actualizadoEn', 'fotos', 'latitud', 'longitud', 'precisionM', 'direccion',
  'codigo', 'confianza', ...CAR_COLS,
] as const;

export const nuevoUuid = () => Crypto.randomUUID();

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS proyectos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL,
    cliente TEXT DEFAULT '', notas TEXT DEFAULT '', creadoEn TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS luminarias (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE,
    proyectoId INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    creadoEn TEXT NOT NULL, actualizadoEn TEXT NOT NULL, fotos TEXT NOT NULL DEFAULT '[]',
    latitud REAL, longitud REAL, precisionM REAL, direccion TEXT DEFAULT '', codigo TEXT DEFAULT '',
    confianza TEXT DEFAULT '', sincronizado INTEGER NOT NULL DEFAULT 0,
    ${CAR_COLS.map((c) => `${c} TEXT DEFAULT ''`).join(', ')}
  );
  CREATE INDEX IF NOT EXISTS idx_lum_proy ON luminarias(proyectoId);
`;

function abrir() {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('eli-luminaria.db');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const { user_version } = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!;
    if (user_version < 1) await migrarAV1(db);
    return db;
  })();
  return dbPromise;
}

/** v0 (prototipo sin proyectos: foto única, sin uuid) → v1. */
async function migrarAV1(db: SQLite.SQLiteDatabase) {
  const viejo = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='luminarias'");
  const esV0 = !!viejo && !(await db.getAllAsync<{ name: string }>('PRAGMA table_info(luminarias)')).some((c) => c.name === 'uuid');
  if (esV0) await db.execAsync('ALTER TABLE luminarias RENAME TO luminarias_v0');
  await db.execAsync(SCHEMA);
  const ahora = new Date().toISOString();
  const p = await db.getFirstAsync<{ id: number }>('SELECT id FROM proyectos LIMIT 1');
  const proyectoId = p?.id ?? (await db.runAsync('INSERT INTO proyectos (uuid,nombre,creadoEn) VALUES (?,?,?)', [nuevoUuid(), 'General', ahora])).lastInsertRowId;
  if (esV0) {
    const filas = await db.getAllAsync<any>('SELECT * FROM luminarias_v0');
    for (const r of filas) {
      const l: any = { ...r, uuid: nuevoUuid(), proyectoId, actualizadoEn: r.creadoEn, fotos: JSON.stringify([r.fotoUri]), codigo: '', alturaM: '' };
      await db.runAsync(`INSERT INTO luminarias (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`, COLS.map((c) => l[c] ?? null));
    }
    await db.execAsync('DROP TABLE luminarias_v0');
  }
  await db.execAsync('PRAGMA user_version = 1');
}

const aLuminaria = (r: any): Luminaria => ({ ...r, fotos: JSON.parse(r.fotos || '[]'), sincronizado: !!r.sincronizado });

/* ---------- kv ---------- */
export async function leerKv(k: string): Promise<string | null> {
  const db = await abrir();
  return (await db.getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k=?', [k]))?.v ?? null;
}
export async function guardarKv(k: string, v: string): Promise<void> {
  const db = await abrir();
  await db.runAsync('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [k, v]);
}

/* ---------- proyectos ---------- */
export async function listarProyectos(): Promise<(Proyecto & { cantidad: number })[]> {
  const db = await abrir();
  return db.getAllAsync(
    'SELECT p.*, (SELECT COUNT(*) FROM luminarias l WHERE l.proyectoId=p.id) AS cantidad FROM proyectos p ORDER BY p.id',
  );
}
export async function crearProyecto(nombre: string, cliente = '', notas = ''): Promise<number> {
  const db = await abrir();
  const r = await db.runAsync('INSERT INTO proyectos (uuid,nombre,cliente,notas,creadoEn) VALUES (?,?,?,?,?)',
    [nuevoUuid(), nombre.trim(), cliente.trim(), notas.trim(), new Date().toISOString()]);
  return r.lastInsertRowId;
}
export async function editarProyecto(id: number, nombre: string, cliente: string, notas: string): Promise<void> {
  const db = await abrir();
  await db.runAsync('UPDATE proyectos SET nombre=?, cliente=?, notas=? WHERE id=?', [nombre.trim(), cliente.trim(), notas.trim(), id]);
  await db.runAsync('UPDATE luminarias SET sincronizado=0 WHERE proyectoId=?', [id]); // el nombre viaja en la sincronización
}
/** Elimina el proyecto y sus luminarias; devuelve las fotos para borrarlas del disco. */
export async function borrarProyecto(id: number): Promise<string[]> {
  const db = await abrir();
  const fotos = (await db.getAllAsync<{ fotos: string }>('SELECT fotos FROM luminarias WHERE proyectoId=?', [id])).flatMap((r) => JSON.parse(r.fotos || '[]'));
  await db.runAsync('DELETE FROM luminarias WHERE proyectoId=?', [id]);
  await db.runAsync('DELETE FROM proyectos WHERE id=?', [id]);
  return fotos;
}

/* ---------- luminarias ---------- */
export async function listarLuminarias(proyectoId: number): Promise<Luminaria[]> {
  const db = await abrir();
  return (await db.getAllAsync('SELECT * FROM luminarias WHERE proyectoId=? ORDER BY id DESC', [proyectoId])).map(aLuminaria);
}
export async function pendientesDeSync(proyectoId: number): Promise<Luminaria[]> {
  const db = await abrir();
  return (await db.getAllAsync('SELECT * FROM luminarias WHERE proyectoId=? AND sincronizado=0 ORDER BY id', [proyectoId])).map(aLuminaria);
}
export async function marcarSincronizadas(uuids: string[]): Promise<void> {
  const db = await abrir();
  for (const u of uuids) await db.runAsync('UPDATE luminarias SET sincronizado=1 WHERE uuid=?', [u]);
}

const valores = (l: LuminariaBorrador) => COLS.map((c) => (c === 'fotos' ? JSON.stringify(l.fotos) : (l as any)[c]) ?? null);

export async function guardarLuminaria(l: LuminariaBorrador): Promise<number> {
  const db = await abrir();
  const ahora = new Date().toISOString();
  if (l.id) {
    await db.runAsync(`UPDATE luminarias SET ${COLS.map((c) => `${c}=?`).join(',')}, sincronizado=0 WHERE id=?`,
      [...valores({ ...l, actualizadoEn: ahora }), l.id]);
    return l.id;
  }
  const r = await db.runAsync(`INSERT INTO luminarias (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`,
    valores({ ...l, actualizadoEn: ahora }));
  return r.lastInsertRowId;
}

export async function borrarLuminaria(l: Luminaria): Promise<void> {
  const db = await abrir();
  await db.runAsync('DELETE FROM luminarias WHERE id=?', [l.id]);
}
