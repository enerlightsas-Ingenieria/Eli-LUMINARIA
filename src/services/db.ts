import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { decidir, Remota } from '../lib/fusion';
import { Caracteristicas, caracteristicasVacias, Luminaria, LuminariaBorrador, Proyecto } from '../types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const CAR_COLS = Object.keys(caracteristicasVacias()) as (keyof Caracteristicas)[];
const COLS = [
  'uuid', 'proyectoId', 'creadoEn', 'actualizadoEn', 'fotos', 'latitud', 'longitud', 'precisionM', 'direccion',
  'codigo', 'tecnico', 'origen', 'ubicacionSimulada', 'jornadaId', 'confianza', ...CAR_COLS,
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
    latitud REAL, longitud REAL, precisionM REAL, direccion TEXT DEFAULT '', codigo TEXT DEFAULT '', tecnico TEXT DEFAULT '', origen TEXT DEFAULT '', ubicacionSimulada INTEGER NOT NULL DEFAULT 0, jornadaId TEXT DEFAULT '',
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
    if (user_version < 2) await migrarAV2(db);
    if (user_version < 3) await migrarAV3(db);
    if (user_version < 4) await migrarAV4(db);
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
      const l: any = { ...r, uuid: nuevoUuid(), proyectoId, actualizadoEn: r.creadoEn, fotos: JSON.stringify([r.fotoUri]), codigo: '', tecnico: '', alturaM: '', origen: '', ubicacionSimulada: 0, jornadaId: '' };
      await db.runAsync(`INSERT INTO luminarias (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`, COLS.map((c) => l[c] ?? null));
    }
    await db.execAsync('DROP TABLE luminarias_v0');
  }
  await db.execAsync('PRAGMA user_version = 1');
}

/** v1 → v2: añade el técnico que realizó el registro. */
async function migrarAV2(db: SQLite.SQLiteDatabase) {
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(luminarias)');
  if (!cols.some((c) => c.name === 'tecnico')) await db.execAsync("ALTER TABLE luminarias ADD COLUMN tecnico TEXT DEFAULT ''");
  await db.execAsync('PRAGMA user_version = 2');
}

/** v2 → v3: registro de borrados pendientes de propagar al equipo. */
async function migrarAV3(db: SQLite.SQLiteDatabase) {
  await db.execAsync('CREATE TABLE IF NOT EXISTS tombstones (uuid TEXT PRIMARY KEY, proyectoId INTEGER NOT NULL)');
  await db.execAsync('PRAGMA user_version = 3');
}

/** v3 → v4: evidencia de cada captura (origen de la foto, ubicación simulada, jornada). */
async function migrarAV4(db: SQLite.SQLiteDatabase) {
  const cols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(luminarias)')).map((c) => c.name);
  if (!cols.includes('origen')) await db.execAsync("ALTER TABLE luminarias ADD COLUMN origen TEXT DEFAULT ''");
  if (!cols.includes('ubicacionSimulada')) await db.execAsync('ALTER TABLE luminarias ADD COLUMN ubicacionSimulada INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('jornadaId')) await db.execAsync("ALTER TABLE luminarias ADD COLUMN jornadaId TEXT DEFAULT ''");
  await db.execAsync('PRAGMA user_version = 4');
}

/** SQLite no acepta booleanos: se guardan como 0/1. */
const aSql = (v: any) => (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null);
/** La columna booleana es NOT NULL: un valor ausente cuenta como false. */
const aSqlCol = (c: string, v: any) => (c === 'ubicacionSimulada' ? (v ? 1 : 0) : aSql(v));

const aLuminaria = (r: any): Luminaria => ({
  ...r, fotos: JSON.parse(r.fotos || '[]'), sincronizado: !!r.sincronizado,
  ubicacionSimulada: !!r.ubicacionSimulada, origen: r.origen ?? '', jornadaId: r.jornadaId ?? '',
});

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
  await db.runAsync('DELETE FROM tombstones WHERE proyectoId=?', [id]); // borrar un proyecto NO borra los datos del equipo
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
/** Marca como enviadas SOLO las que no cambiaron mientras se subían (si se editaron durante el envío, siguen pendientes). */
export async function marcarSincronizadas(items: { uuid: string; actualizadoEn: string }[]): Promise<void> {
  const db = await abrir();
  for (const i of items) await db.runAsync('UPDATE luminarias SET sincronizado=1 WHERE uuid=? AND actualizadoEn=?', [i.uuid, i.actualizadoEn]);
}

const valores = (l: LuminariaBorrador) => COLS.map((c) => (c === 'fotos' ? JSON.stringify(l.fotos) : aSqlCol(c, (l as any)[c])));

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
  await db.runAsync('INSERT OR IGNORE INTO tombstones (uuid, proyectoId) VALUES (?,?)', [l.uuid, l.proyectoId]); // se propaga en la próxima sincronización
}

/** Luminarias que este técnico registró desde una fecha (para el contador de la jornada). */
export async function contarDesde(tecnico: string, desdeISO: string): Promise<number> {
  const db = await abrir();
  return (await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM luminarias WHERE tecnico=? AND creadoEn>=?', [tecnico, desdeISO]))?.c ?? 0;
}

/** Luminarias de un técnico entre dos instantes (para cerrar una jornada atrasada). */
export async function contarEntre(tecnico: string, desdeISO: string, hastaISO: string): Promise<number> {
  const db = await abrir();
  return (await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM luminarias WHERE tecnico=? AND creadoEn>=? AND creadoEn<=?', [tecnico, desdeISO, hastaISO]))?.c ?? 0;
}

export async function borradasPendientes(proyectoId: number): Promise<string[]> {
  const db = await abrir();
  return (await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM tombstones WHERE proyectoId=?', [proyectoId])).map((r) => r.uuid);
}

export async function limpiarBorradas(uuids: string[]): Promise<void> {
  const db = await abrir();
  for (const u of uuids) await db.runAsync('DELETE FROM tombstones WHERE uuid=?', [u]);
}

export interface ResultadoFusion { nuevas: number; actualizadas: number; borradas: number }

/** Aplica lo que trajo la hoja (lo de todos los técnicos) respetando los cambios locales sin enviar. */
export async function fusionarRemotas(proyectoId: number, remotas: Remota[]): Promise<ResultadoFusion> {
  const db = await abrir();
  const borradas = new Set(await borradasPendientes(proyectoId));
  const r: ResultadoFusion = { nuevas: 0, actualizadas: 0, borradas: 0 };
  const sinFotosNiIds = COLS.filter((c) => c !== 'uuid' && c !== 'proyectoId' && c !== 'fotos');

  for (const x of remotas) {
    const local = await db.getFirstAsync<{ id: number; sincronizado: number; fotos: string }>('SELECT id, sincronizado, fotos FROM luminarias WHERE uuid=?', [x.uuid]);
    const accion = decidir(local ? { sincronizado: !!local.sincronizado } : undefined, x, borradas.has(x.uuid));
    const d: any = x.datos;
    if (accion === 'insertar') {
      await db.runAsync(`INSERT INTO luminarias (${COLS.join(',')}, sincronizado) VALUES (${COLS.map(() => '?').join(',')}, 1)`,
        COLS.map((c) => (c === 'fotos' ? '[]' : c === 'proyectoId' ? proyectoId : aSqlCol(c, d[c]))));
      r.nuevas++;
    } else if (accion === 'actualizar') {
      await db.runAsync(`UPDATE luminarias SET ${sinFotosNiIds.map((c) => `${c}=?`).join(',')}, sincronizado=1 WHERE uuid=?`,
        [...sinFotosNiIds.map((c) => aSqlCol(c, d[c])), x.uuid]); // conserva las fotos locales
      r.actualizadas++;
    } else if (accion === 'borrar') {
      await db.runAsync('DELETE FROM luminarias WHERE uuid=?', [x.uuid]);
      r.borradas++;
    }
  }
  return r;
}
