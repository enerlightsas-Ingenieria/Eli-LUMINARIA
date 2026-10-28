/**
 * Base de datos local del navegador (IndexedDB). Mismo contrato que src/services/db.ts del móvil, para que el núcleo
 * compartido (sincronización, jornada) funcione igual: luminarias, proyectos, borrados pendientes, kv y fotos (Blob).
 */
import { decidir, Remota } from '@compartido/lib/fusion';
import { caracteristicasVacias, Luminaria, LuminariaBorrador, normalizarControl, Proyecto } from '@compartido/types';

const NOMBRE_DB = 'eli-luminaria';
const VERSION_DB = 1;
let dbp: Promise<IDBDatabase> | null = null;

/** Solo para pruebas: cierra y descarta la conexión en memoria. */
export async function reiniciarConexion() { const actual = dbp; dbp = null; if (actual) (await actual).close(); }

/**
 * Borra TODO lo local de este dispositivo: registros, proyectos, fotos y ajustes (incluida la clave de acceso).
 * Lo que no se haya sincronizado se pierde. Después hay que abrir de nuevo el enlace de acceso.
 */
export async function borrarTodoLocal(): Promise<void> {
  await reiniciarConexion();
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase(NOMBRE_DB);
    r.onsuccess = () => res(); r.onerror = () => res(); r.onblocked = () => res();   // bloqueada: otra pestaña la tiene abierta; se vacía al cerrarla
    setTimeout(res, 3000);
  });
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* sin almacenamiento */ }
}

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

/** Cambia los datos del proyecto en ESTE dispositivo. (Renombrar un proyecto compartido lo hace el administrador en el servidor.) */
export async function editarProyecto(id: number, nombre: string, cliente: string, notas: string): Promise<void> {
  const db = await abrir();
  const t = db.transaction('proyectos', 'readwrite');
  const p = (await pedir(t.objectStore('proyectos').get(id))) as Proyecto | undefined;
  if (p) t.objectStore('proyectos').put({ ...p, nombre: nombre.trim(), cliente: cliente.trim(), notas: notas.trim() });
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

/**
 * Alinea los proyectos de este dispositivo con la hoja: los que el administrador eliminó desaparecen aquí también. Solo se quita un
 * proyecto que la hoja ya conocía (se vio en su lista o tiene registros sincronizados) y que no tiene nada pendiente de enviar.
 * Devuelve cuántos quitó. `enHoja` = nombres que informa el servidor (si el servidor no respondió, no se llama a esta función).
 */
export interface ProyectoRemoto { id: string; nombre: string; cliente: string; notas: string; activo: boolean }

/**
 * Alinea los proyectos de este dispositivo con la lista del servidor (con ids): los cambios de nombre, cliente, notas y estado se aplican
 * aquí, los proyectos nuevos se crean y los eliminados desaparecen (salvo que tengan algo sin enviar). Nunca crea un proyecto por un nombre viejo.
 * Devuelve cuántos cambios hizo.
 */
export async function conciliarProyectosInfo(remotos: ProyectoRemoto[]): Promise<number> {
  const db = await abrir();
  const locales = await listarProyectos();
  const idsRemotos = new Set(remotos.map((r) => r.id));
  const usados = new Set<number>();
  let cambios = 0;
  for (const r of remotos) {
    const nombre = r.nombre.trim().toLowerCase();
    const p = locales.find((x) => x.idHoja === r.id)
      ?? locales.find((x) => !usados.has(x.id) && (!x.idHoja || !idsRemotos.has(x.idHoja)) && x.nombre.trim().toLowerCase() === nombre);   // uno local aún sin id (o con uno que ya no existe)
    const t = db.transaction('proyectos', 'readwrite');
    if (p) {
      usados.add(p.id);
      if (p.idHoja !== r.id || p.nombre !== r.nombre || p.cliente !== r.cliente || p.notas !== r.notas || (p.activo !== false) !== r.activo) {
        t.objectStore('proyectos').put({ ...p, idHoja: r.id, nombre: r.nombre, cliente: r.cliente, notas: r.notas, activo: r.activo });
        cambios++;
      }
    } else {
      t.objectStore('proyectos').add({ uuid: nuevoUuid(), idHoja: r.id, nombre: r.nombre, cliente: r.cliente, notas: r.notas, activo: r.activo, creadoEn: new Date().toISOString() });
      cambios++;
    }
    await terminar(t);
  }
  let quitados = 0;
  for (const p of locales) {
    if (usados.has(p.id)) continue;
    const ls = await listarLuminarias(p.id);
    const pendiente = ls.some((l) => !l.sincronizado) || (await borradasPendientes(p.id)).length > 0;
    const conocido = !!p.idHoja || (await leerKv(`enHoja:${p.uuid}`)) === '1' || ls.some((l) => l.sincronizado);   // la hoja ya lo tuvo y ahora no está: lo eliminó el administrador
    if (!conocido || pendiente) continue;
    await borrarFotos(await borrarProyecto(p.id));
    quitados++;
  }
  if (quitados && !(await listarProyectos()).length) await crearProyecto('General');
  return cambios + quitados;
}

export async function conciliarProyectos(enHoja: string[]): Promise<number> {
  const nombres = new Set(enHoja.map((n) => n.trim().toLowerCase()));
  let quitados = 0;
  for (const p of await listarProyectos()) {
    const marca = `enHoja:${p.uuid}`;
    if (nombres.has(p.nombre.trim().toLowerCase())) { if ((await leerKv(marca)) !== '1') await guardarKv(marca, '1'); continue; }
    const ls = await listarLuminarias(p.id);
    const conocido = (await leerKv(marca)) === '1' || ls.some((l) => l.sincronizado);
    const pendiente = ls.some((l) => !l.sincronizado) || (await borradasPendientes(p.id)).length > 0;
    if (!conocido || pendiente) continue;
    await borrarFotos(await borrarProyecto(p.id));
    quitados++;
  }
  if (quitados && !(await listarProyectos()).length) await crearProyecto('General');
  return quitados;
}

/* ---------- luminarias ---------- */
export async function listarLuminarias(proyectoId: number): Promise<Luminaria[]> {
  const db = await abrir();
  const ls = (await pedir(db.transaction('luminarias').objectStore('luminarias').index('proyectoId').getAll(proyectoId))) as Luminaria[];
  return ls.map(completar).sort((a, b) => b.id - a.id);
}

/** Registros guardados antes de que existieran el código del poste, el sector, el material del poste o el transformador. */
const completar = (l: Luminaria): Luminaria => (
  (l as any).control === undefined || l.codigoPoste === undefined || l.sector === undefined || l.barrio === undefined || l.materialPoste === undefined || l.numeroTransformador === undefined
    ? { ...l, control: (l as any).control ?? normalizarControl(String((l as any).fotocelda ?? '')), codigoPoste: l.codigoPoste ?? '', sector: l.sector ?? '', barrio: l.barrio ?? '', materialPoste: l.materialPoste ?? '', numeroTransformador: l.numeroTransformador ?? '' } : l);

export async function obtenerLuminaria(id: number): Promise<Luminaria | undefined> {
  const db = await abrir();
  const l = (await pedir(db.transaction('luminarias').objectStore('luminarias').get(id))) as Luminaria | undefined;
  return l && completar(l);
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

/**
 * Una sola vez por dispositivo: las luminarias con foto propia que ya estaban enviadas se vuelven a marcar como pendientes, para que
 * viajen otra vez con su miniatura (las anteriores a esa mejora no la tienen y los demás no verían la foto). Devuelve cuántas marcó.
 */
export async function marcarParaReenviar(): Promise<number> {
  const db = await abrir();
  const t = db.transaction('luminarias', 'readwrite');
  const st = t.objectStore('luminarias');
  const todas = (await pedir(st.getAll())) as Luminaria[];
  let n = 0;
  for (const l of todas) if (l.sincronizado && l.fotos?.length) { st.put({ ...l, sincronizado: false }); n++; }
  await terminar(t);
  return n;
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
