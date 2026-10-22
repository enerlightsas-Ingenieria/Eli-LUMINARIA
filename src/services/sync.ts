import { normalizarRemota } from '../lib/fusion';
import { Proyecto } from '../types';
import {
  borradasPendientes, fusionarRemotas, guardarKv, leerKv, limpiarBorradas, listarProyectos, marcarSincronizadas, pendientesDeSync,
} from './db';
import { leerBase64 } from './fotos';
import { postServidor as post, SinConexion } from './servidor';
import { Ajustes, cargarAjustes } from './settings';

const LOTE = 15;

export interface ResultadoSync { enviadas: number; borradasEnviadas: number; recibidas: number; borradasRemotas: number }

const infoProyecto = (p: Proyecto) => ({ uuid: p.uuid, nombre: p.nombre, cliente: p.cliente });

/** Sube lo nuevo/modificado y los borrados. Idempotente: cada luminaria lleva su uuid. */
async function enviar(a: Ajustes, proyecto: Proyecto, alProgreso?: (hechas: number, total: number) => void) {
  const pendientes = await pendientesDeSync(proyecto.id);
  let enviadas = 0;
  try {
    for (let i = 0; i < pendientes.length; i += LOTE) {
      const lote = pendientes.slice(i, i + LOTE);
      const luminarias = await Promise.all(lote.map(async (l) => ({
        ...l,
        fotos: undefined,
        foto: a.syncFotos && l.fotos[0] ? await leerBase64(l.fotos[0]).catch(() => undefined) : undefined,
      })));
      await post(a, { proyecto: infoProyecto(proyecto), luminarias });
      await marcarSincronizadas(lote.map((l) => l.uuid));
      enviadas += lote.length;
      alProgreso?.(enviadas, pendientes.length);
    }
    const borradas = await borradasPendientes(proyecto.id);
    if (borradas.length) {
      await post(a, { proyecto: infoProyecto(proyecto), luminarias: [], borradas });
      await limpiarBorradas(borradas);
    }
    return { enviadas, borradasEnviadas: borradas.length };
  } catch (e) {
    if (e instanceof SinConexion) throw new Error(`Sin conexión. Se enviaron ${enviadas} de ${pendientes.length}; el resto queda pendiente.`);
    throw e;
  }
}

/** Baja lo que hayan registrado, editado o borrado los demás técnicos desde la última descarga. */
async function descargar(a: Ajustes, proyecto: Proyecto) {
  const clave = `desde:${proyecto.uuid}`;
  const desde = (await leerKv(clave)) ?? '';
  const j = await post(a, { accion: 'listar', proyecto: infoProyecto(proyecto), desde });
  const remotas = (Array.isArray(j.luminarias) ? j.luminarias : []).map(normalizarRemota).filter((x: any) => !!x);
  const r = await fusionarRemotas(proyecto.id, remotas);
  if (typeof j.ahora === 'string') await guardarKv(clave, j.ahora); // el cursor lo pone el servidor: no depende de relojes de teléfonos
  return r;
}

/** Envía y después descarga. Si falla la descarga, lo enviado queda confirmado y se avisa. */
export async function sincronizar(proyecto: Proyecto, alProgreso?: (hechas: number, total: number) => void): Promise<ResultadoSync> {
  const a = await cargarAjustes();
  if (!a.syncUrl) throw new Error('Configura la URL de sincronización en Ajustes.');
  const subida = await enviar(a, proyecto, alProgreso);
  try {
    const bajada = await descargar(a, proyecto);
    return { ...subida, recibidas: bajada.nuevas + bajada.actualizadas, borradasRemotas: bajada.borradas };
  } catch (e: any) {
    const motivo = e instanceof SinConexion ? 'sin conexión' : e.message;
    throw new Error(`Se enviaron ${subida.enviadas} luminaria(s), pero no se pudo descargar lo del equipo: ${motivo}`);
  }
}

let corriendo = false;

/** Sincronización silenciosa de todos los proyectos. Devuelve cuántos cambios hubo (enviados + recibidos). */
export async function sincronizarTodo(): Promise<number> {
  const a = await cargarAjustes();
  if (!a.autoSync || !a.syncUrl || corriendo) return 0;
  corriendo = true;
  try {
    let cambios = 0;
    for (const p of await listarProyectos()) {
      const r = await sincronizar(p);
      cambios += r.enviadas + r.borradasEnviadas + r.recibidas + r.borradasRemotas;
    }
    return cambios;
  } finally { corriendo = false; }
}

/** Texto para el técnico: qué pasó en la sincronización. */
export function resumenSync(r: ResultadoSync): string {
  const partes = [
    r.enviadas && `${r.enviadas} enviada(s)`,
    r.recibidas && `${r.recibidas} recibida(s) del equipo`,
    (r.borradasEnviadas || r.borradasRemotas) && `${r.borradasEnviadas + r.borradasRemotas} eliminación(es)`,
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Todo estaba al día.';
}
