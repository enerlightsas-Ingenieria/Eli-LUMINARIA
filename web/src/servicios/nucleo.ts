/** Une el núcleo compartido (src/core) con los servicios del navegador. */
import { analizarFotosCon } from '@compartido/core/analizador';
import { crearJornada } from '@compartido/core/jornada';
import { postServidor } from '@compartido/core/servidor';
import { crearSincronizador } from '@compartido/core/sync';
import type { Ajustes } from '@compartido/core/ajustes';
import * as almacen from './almacen';
import { cargarAjustes } from './ajustes';
import { analizarPendientes, ResultadoLote } from './analisisPendiente';
import { base64DeFoto, miniaturaDeFoto } from './fotos';
import { obtenerPosicion } from './gps';

declare const __VERSION__: string;

/** El proxy identifica al técnico por su token (cabecera) y es quien guarda el token del script de Google. */
export const post = (a: Ajustes, cuerpo: object, timeoutMs?: number) => postServidor(a, cuerpo, timeoutMs, a.apiKey ? { 'x-api-key': a.apiKey } : {});

export const analizarFotos = (base64s: string[], cancelar?: AbortSignal) => analizarFotosCon(cargarAjustes, base64s, cancelar);

// Solo se sincronizan los proyectos que existen en la hoja (tienen id) y están activos: ni los desactivados ni uno sin id (nunca se crea nada al sincronizar)
const almacenActivo = { ...almacen, listarProyectos: async () => (await almacen.listarProyectos()).filter((p) => p.activo !== false && !!p.idHoja) };

/** El servidor dijo que el proyecto ya no existe: se borra de este dispositivo (con sus fotos) y la pantalla se actualiza. */
async function quitarProyectoEliminado(p: import('@compartido/types').Proyecto) {
  await almacen.borrarFotos(await almacen.borrarProyecto(p.id));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('eli-proyectos'));
}

export const sincronizacion = crearSincronizador({ almacen: almacenActivo, alEliminarProyecto: quitarProyectoEliminado, cargarAjustes, leerFoto: base64DeFoto, leerMiniatura: miniaturaDeFoto, post });

export const jornada = crearJornada({
  almacen,
  nuevoUuid: () => almacen.nuevoUuid(),
  cargarAjustes,
  obtenerPosicion,
  post,
  plataforma: () => 'web',
  version: () => (typeof __VERSION__ === 'string' ? __VERSION__ : ''),
});

/** Analiza en lote lo capturado sin IA (manual, el usuario decide cuándo: cada análisis consume crédito). */
export const analizarLote = (items: import('@compartido/types').Luminaria[], alProgreso?: (h: number, t: number) => void, senal?: AbortSignal): Promise<ResultadoLote> =>
  analizarPendientes(items, {
    analizar: (b, c) => analizarFotos(b, c),
    leerFotos: (ids) => Promise.all(ids.map(base64DeFoto)),
    leer: almacen.obtenerLuminaria,
    guardar: (l) => almacen.guardarLuminaria(l),
  }, alProgreso, senal);

/** Panel de supervisión: datos del equipo vía el proxy (requiere un token de ADMIN_TOKENS). */
export async function datosEquipo(): Promise<any> {
  const a = await cargarAjustes();
  const base = a.endpoint.replace(/\/+$/, '');
  const r = await fetch(`${base}/equipo`, { method: 'POST', headers: { 'x-api-key': a.apiKey, 'content-type': 'text/plain;charset=utf-8' }, body: '{}' });
  if (r.status === 401) throw new Error('Esta cuenta no tiene permiso de supervisor.');
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `El servidor respondió ${r.status}.`);
  return j;
}
