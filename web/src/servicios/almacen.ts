/**
 * Base de datos local del navegador (IndexedDB). Mismo contrato que src/services/db.ts del móvil, para que el núcleo
 * compartido (sincronización, jornada) funcione igual: luminarias, proyectos, borrados pendientes, kv y fotos (Blob).
 */
import { decidir, Remota } from '@compartido/lib/fusion';
import { caracteristicasVacias, Luminaria, LuminariaBorrador, Proyecto } from '@compartido/types';

const NOMBRE_DB = 'eli-luminaria';
const VERSION_DB = 1;
let dbp: Promise<IDBDatabase> | null = null;

/** Solo para pruebas: cierra y descarta la conexión en memoria. */
export async function reiniciarConexion() { const actual = dbp; dbp = null; if (actual) (await actual).close(); }

const pedir = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const terminar = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export const nuevoUuid = () => crypto.randomUUID();

function abrir(): Promise<IDBDatabase> {
  dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(NOMBRE_DB, VERSION_DB);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('kv');
      db.createObjectStore('proyectos', { keyPath: 'id', autoIncrement: true }).createIndex('uuid', 'uuid', { unique: true });
      const l = db.createObjectStore('luminarias', { keyPath: 'id', autoIncrement: true });
      l.createIndex('uuid', 'uuid', { unique: true });
      l.createIndex('proyectoId', 'proyectoId');
      db.createObjectStore('tombstones', { keyPath: 'uuid' }).createIndex('proyectoId', 'proyectoId');
      db.createObjectStore('fotos');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).then(async (db) => {
    // primera ejecución: proyecto "General" (igual que en el móvil)
    const t = db.transaction('proyectos', 'readwrite');
    const hay = await pedir(t.objectStore('proyectos').count());
    if (!hay) t.objectStore('proyectos').add({ uuid: nuevoUuid(), nombre: 'General', cliente: '', notas: '', creadoEn: new Date().toISOString() });
    await terminar(t);
    return db;
  });
  return dbp;
}

/* ---------- kv ---------- */
export async function leerKv(k: string): Promise<string | null> {
  const db = await abrir();
  return (await pedir(db.transaction('kv').objectStore('kv').get(k))) ?? null;
}
export async function guardarKv(k: string, v: string): Promise<void> {
  const db = await abrir();
  const t = db.transaction('kv', 'readwrite');
  t.objectStore('kv').put(v, k);
  await terminar(t);
}

/* ---------- proyectos ---------- */
export type ProyectoConCuenta = Proyecto & { cantidad: number };

export async function listarProyectos(): Promise<ProyectoConCuenta[]> {
  const db = await abrir();
  const t = db.transaction(['proyectos', 'luminarias']);
  const ps = (await pedir(t.objectStore('proyectos').getAll())) as Proyecto[];
  const out: ProyectoConCuenta[] = [];
  for (const p of ps.sort((a, b) => a.id - b.id)) out.push({ ...p, cantidad: await pedir(t.objectStore('luminarias').index('proyectoId').count(p.id)) });
  return out;
}

export async function crearProyecto(nombre: string, cliente = '', notas = ''): Promise<number> {
  const db = await abrir();
  const t = db.transaction('proyectos', 'readwrite');
  const id = (await pedir(t.objectStore('proyectos').add({ uuid: nuevoUuid(), nombre: nombre.trim(), cliente: cliente.trim(), notas: notas.trim(), creadoEn: new Date().toISOString() }))) as number;
  await terminar(t);
  return id;
}

export async function editarProyecto(id: number, nombre: string, cliente: string, notas: string): Promise<void> {
  const db = await abrir();
  const t = db.transaction(['proyectos', 'luminarias'], 'readwrite');
  const p = (await pedir(t.objectStore('proyectos').get(id))) as Proyecto | undefined;
  if (p) t.objectStore('proyectos').put({ ...p, nombre: nombre.trim(), cliente: cliente.trim(), notas: notas.trim() });
  const ls = (await pedir(t.objectStore('luminarias').index('proyectoId').getAll(id))) as Luminaria[];
  for (const l of ls) t.objectStore('luminarias').put({ ...l, sincronizado: false }); // el nombre del proyecto viaja en la sincronización
  await terminar(t);
}

/** Elimina el proyecto y sus luminarias; devuelve los ids de fotos para borrarlas. Los borrados NO se propagan al equipo. */
export async function borrarProyecto(id: number): Promise<string[]> {
  const db = await abrir();
  const t = db.transaction(['proyectos', 'luminarias', 'tombstones'], 'readwrite');
  const ls = (await pedir(t.objectStore('luminarias').index('proyectoId').getAll(id))) as Luminaria[];
  const fotos = ls.flatMap((l) => l.fotos);
  for (const l of ls) t.objectStore('luminarias').delete(l.id);
  const tombs = (await pedir(t.objectStore('tombstones').index('proyectoId').getAllKeys(id))) as IDBValidKey[];
  for (const k of tombs) t.objectStore('tombstones').delete(k);
  t.objectStore('proyectos').delete(id);
  await terminar(t);
  return fotos;
}

/* ---------- luminarias ---------- */
export async function listarLuminarias(proyectoId: number): Promise<Luminaria[]> {
  const db = await abrir();
  const ls = (await pedir(db.transaction('luminarias').objectStore('luminarias').index('proyectoId').getAll(proyectoId))) as Luminaria[];
  return ls.sort((a, b) => b.id - a.id);
}

export async function obtenerLuminaria(id: number): Promise<Luminaria | undefined> {
  const db = await abrir();
  return (await pedir(db.transaction('luminarias').objectStore('luminarias').get(id))) as Luminaria | undefined;
}

export async function pendientesDeSync(proyectoId: number): Promise<Luminaria[]> {
  return (await listarLuminarias(proyectoId)).filter((l) => !l.sincronizado).sort((a, b) => a.id - b.id);
}

/** Marca como enviadas SOLO las que no cambiaron mientras se subían. */
export async function marcarSincronizadas(items: { uuid: string; actualizadoEn: string }[]): Promise<void> {
  const db = await abrir();
  const t = db.transaction('luminarias', 'readwrite');
  const st = t.objectStore('luminarias');
  for (const i of items) {
    const l = (await pedir(st.index('uuid').get(i.uuid))) as Luminaria | undefined;
    if (l && l.actualizadoEn === i.actualizadoEn) st.put({ ...l, sincronizado: true });
  }
  await terminar(t);
}

export async function guardarLuminaria(l: LuminariaBorrador): Promise<number> {
  const db = await abrir();
  const t = db.transaction('luminarias', 'readwrite');
  const base = { ...caracteristicasVacias(), ...l, ubicacionSimulada: !!l.ubicacionSimulada, actualizadoEn: new Date().toISOString(), sincronizado: false };
  const id = (await pedir(l.id ? t.objectStore('luminarias').put(base) : t.objectStore('luminarias').add((({ id: _omitido, ...resto }) => resto)(base)))) as number;
  await terminar(t);
  return id;
}

export async function borrarLuminaria(l: Luminaria): Promise<void> {
  const db = await abrir();
  const t = db.transaction(['luminarias', 'tombstones'], 'readwrite');
  t.objectStore('luminarias').delete(l.id);
  t.objectStore('tombstones').put({ uuid: l.uuid, proyectoId: l.proyectoId }); // se propaga en la próxima sincronización
  await terminar(t);
}

async function todas(): Promise<Luminaria[]> {
  const db = await abrir();
  return (await pedir(db.transaction('luminarias').objectStore('luminarias').getAll())) as Luminaria[];
}
export async function contarDesde(tecnico: string, desdeISO: string): Promise<number> {
  return (await todas()).filter((l) => l.tecnico === tecnico && l.creadoEn >= desdeISO).length;
}
export async function contarEntre(tecnico: string, desdeISO: string, hastaISO: string): Promise<number> {
  return (await todas()).filter((l) => l.tecnico === tecnico && l.creadoEn >= desdeISO && l.creadoEn <= hastaISO).length;
}

export async function borradasPendientes(proyectoId: number): Promise<string[]> {
  const db = await abrir();
  return (await pedir(db.transaction('tombstones').objectStore('tombstones').index('proyectoId').getAllKeys(proyectoId))) as string[];
}
export async function limpiarBorradas(uuids: string[]): Promise<void> {
  const db = await abrir();
  const t = db.transaction('tombstones', 'readwrite');
  for (const u of uuids) t.objectStore('tombstones').delete(u);
  await terminar(t);
}

export interface ResultadoFusion { nuevas: number; actualizadas: number; borradas: number }

/** Aplica lo que trajo la hoja (lo de todos los técnicos) respetando los cambios locales sin enviar. */
export async function fusionarRemotas(proyectoId: number, remotas: Remota[]): Promise<ResultadoFusion> {
  const db = await abrir();
  const borradas = new Set(await borradasPendientes(proyectoId));
  const r: ResultadoFusion = { nuevas: 0, actualizadas: 0, borradas: 0 };
  const t = db.transaction('luminarias', 'readwrite');
  const st = t.objectStore('luminarias');
  for (const x of remotas) {
    const local = (await pedir(st.index('uuid').get(x.uuid))) as Luminaria | undefined;
    const accion = decidir(local ? { sincronizado: !!local.sincronizado } : undefined, x, borradas.has(x.uuid));
    if (accion === 'insertar') { await pedir(st.add({ ...x.datos, proyectoId, fotos: [], sincronizado: true })); r.nuevas++; }
    else if (accion === 'actualizar') { st.put({ ...local!, ...x.datos, id: local!.id, proyectoId: local!.proyectoId, fotos: local!.fotos, sincronizado: true }); r.actualizadas++; } // conserva las fotos locales
    else if (accion === 'borrar') { st.delete(local!.id); r.borradas++; }
  }
  await terminar(t);
  return r;
}

/* ---------- fotos (Blob) ---------- */
export async function guardarFoto(blob: Blob): Promise<string> {
  const db = await abrir();
  const id = nuevoUuid();
  const t = db.transaction('fotos', 'readwrite');
  t.objectStore('fotos').put(blob, id);
  await terminar(t);
  return id;
}
export async function obtenerFoto(id: string): Promise<Blob | undefined> {
  const db = await abrir();
  return (await pedir(db.transaction('fotos').objectStore('fotos').get(id))) as Blob | undefined;
}
export async function borrarFotos(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await abrir();
  const t = db.transaction('fotos', 'readwrite');
  for (const id of ids) t.objectStore('fotos').delete(id);
  await terminar(t);
}
