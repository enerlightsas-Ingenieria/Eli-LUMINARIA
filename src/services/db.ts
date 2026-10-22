import * as SQLite from 'expo-sqlite';
import { Luminaria, LuminariaBorrador } from '../types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const COLS = [
  'creadoEn', 'fotoUri', 'latitud', 'longitud', 'precisionM', 'direccion', 'confianza',
  'marca', 'fabricante', 'modelo', 'tipoLuminaria', 'tecnologia', 'potenciaW', 'tensionV', 'fotocelda',
  'pinesFotocelda', 'temperaturaColorK', 'flujoLuminosoLm', 'ip', 'montaje', 'estado', 'observaciones',
] as const;

function abrir() {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('eli-luminaria.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS luminarias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creadoEn TEXT NOT NULL, fotoUri TEXT NOT NULL,
        latitud REAL, longitud REAL, precisionM REAL, direccion TEXT DEFAULT '', confianza TEXT DEFAULT '',
        marca TEXT DEFAULT '', fabricante TEXT DEFAULT '', modelo TEXT DEFAULT '', tipoLuminaria TEXT DEFAULT '',
        tecnologia TEXT DEFAULT '', potenciaW TEXT DEFAULT '', tensionV TEXT DEFAULT '', fotocelda TEXT DEFAULT '',
        pinesFotocelda TEXT DEFAULT '', temperaturaColorK TEXT DEFAULT '', flujoLuminosoLm TEXT DEFAULT '',
        ip TEXT DEFAULT '', montaje TEXT DEFAULT '', estado TEXT DEFAULT '', observaciones TEXT DEFAULT ''
      );
    `);
    return db;
  })();
  return dbPromise;
}

export async function listar(): Promise<Luminaria[]> {
  const db = await abrir();
  return db.getAllAsync<Luminaria>('SELECT * FROM luminarias ORDER BY id DESC');
}

export async function insertar(l: LuminariaBorrador): Promise<number> {
  const db = await abrir();
  const r = await db.runAsync(
    `INSERT INTO luminarias (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`,
    COLS.map((c) => l[c] as any),
  );
  return r.lastInsertRowId;
}

export async function actualizar(l: Luminaria): Promise<void> {
  const db = await abrir();
  await db.runAsync(
    `UPDATE luminarias SET ${COLS.map((c) => `${c}=?`).join(',')} WHERE id=?`,
    [...COLS.map((c) => l[c] as any), l.id],
  );
}

export async function borrar(id: number): Promise<void> {
  const db = await abrir();
  await db.runAsync('DELETE FROM luminarias WHERE id=?', [id]);
}
