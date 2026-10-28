import { normalizarRemota, Remota } from '../lib/fusion';
import { Luminaria, Proyecto } from '../types';
import { Ajustes } from './ajustes';
import { SinConexion } from './servidor';

const LOTE = 15;

export interface ResultadoSync { enviadas: number; borradasEnviadas: number; recibidas: number; borradasRemotas: number }

const infoProyecto = (p: Proyecto) => ({ uuid: p.uuid, id: p.idHoja, nombre: p.nombre, cliente: p.cliente });   // el id manda: si el proyecto fue renombrado, se usa su nombre actual

/** Lo que el núcleo necesita de la base local y de la red de cada plataforma. */
export interface DepsSync {
  almacen: {
    pendientesDeSync(proyectoId: number): Promise<Luminaria[]>;
    marcarSincronizadas(items: { uuid: string; actualizadoEn: string }[]): Promise<void>;
    borradasPendientes(proyectoId: number): Promise<string[]>;
    limpiarBorradas(uuids: string[]): Promise<void>;
    fusionarRemotas(proyectoId: number, remotas: Remota[]): Promise<{ nuevas: number; actualizadas: number; borradas: number }>;
    leerKv(k: string): Promise<string | null>;
    guardarKv(k: string, v: string): Promise<void>;
    listarProyectos(): Promise<Proyecto[]>;
  };
  /** Se llama cuando el servidor dice que el proyecto ya no existe (lo eliminó el administrador): quitarlo de este dispositivo. */
  alEliminarProyecto?(proyecto: Proyecto): Promise<void>;
  cargarAjustes(): Promise<Ajustes>;
  leerFoto(uri: string): Promise<string>;
  /** Foto pequeña (JPEG en base64) que viaja con el registro para que todos tengan una referencia; opcional. */
  leerMiniatura?(uri: string): Promise<string>;
  post(a: Ajustes, cuerpo: object, timeoutMs?: number): Promise<any>;
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

export function crearSincronizador(d: DepsSync) {
  const post = (a: Ajustes, c: object, t?: number) => d.post(a, c, t);


  /** Sube lo nuevo/modificado y los borrados. Idempotente: cada luminaria lleva su uuid. */
  async function enviar(a: Ajustes, proyecto: Proyecto, alProgreso?: (hechas: number, total: number) => void) {
    const pendientes = await d.almacen.pendientesDeSync(proyecto.id);
    let enviadas = 0;
    try {
      for (let i = 0; i < pendientes.length; i += LOTE) {
        const lote = pendientes.slice(i, i + LOTE);
        const luminarias = await Promise.all(lote.map(async (l) => {
          const uri = a.syncFotos ? l.fotos[0] : undefined;
          return {
            ...l,
            fotos: undefined,
            foto: uri ? await d.leerFoto(uri).catch(() => undefined) : undefined,
            // sin foto propia (registro de otra persona) se reenvía la miniatura que ya tenía
            miniatura: (uri && d.leerMiniatura ? await d.leerMiniatura(uri).catch(() => undefined) : undefined) ?? l.miniatura,
          };
        }));
        await post(a, { proyecto: infoProyecto(proyecto), luminarias });
        await d.almacen.marcarSincronizadas(lote.map((l) => ({ uuid: l.uuid, actualizadoEn: l.actualizadoEn })));
        enviadas += lote.length;
        alProgreso?.(enviadas, pendientes.length);
      }
      const borradas = await d.almacen.borradasPendientes(proyecto.id);
      if (borradas.length) {
        await post(a, { proyecto: infoProyecto(proyecto), luminarias: [], borradas });
        await d.almacen.limpiarBorradas(borradas);
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
    const desde = (await d.almacen.leerKv(clave)) ?? '';
    const j = await post(a, { accion: 'listar', proyecto: infoProyecto(proyecto), desde });
    const remotas = (Array.isArray(j.luminarias) ? j.luminarias : []).map(normalizarRemota).filter((x: any) => !!x);
    const r = await d.almacen.fusionarRemotas(proyecto.id, remotas);
    if (typeof j.ahora === 'string') await d.almacen.guardarKv(clave, j.ahora); // el cursor lo pone el servidor: no depende de relojes de teléfonos
    return r;
  }

  /** Envía y después descarga. Si falla la descarga, lo enviado queda confirmado y se avisa. */
  async function sincronizar(proyecto: Proyecto, alProgreso?: (hechas: number, total: number) => void): Promise<ResultadoSync> {
    const a = await d.cargarAjustes();
    if (!a.syncUrl) throw new Error('Configura la URL de sincronización en Ajustes.');
    try { return await sincronizarProyecto(a, proyecto, alProgreso); }
    catch (e: any) {
      if (!/PROYECTO_NO_EXISTE/.test(e?.message ?? '')) throw e;
      // El administrador eliminó el proyecto (o nunca existió): nada ni nadie lo recrea. Se quita de este dispositivo.
      await d.alEliminarProyecto?.(proyecto);
      throw new Error(`El proyecto "${proyecto.nombre}" fue eliminado por el administrador y se quitó de este dispositivo.`);
    }
  }

  async function sincronizarProyecto(a: Ajustes, proyecto: Proyecto, alProgreso?: (hechas: number, total: number) => void): Promise<ResultadoSync> {
    const subida = await enviar(a, proyecto, alProgreso);
    try {
      const bajada = await descargar(a, proyecto);
      return { ...subida, recibidas: bajada.nuevas + bajada.actualizadas, borradasRemotas: bajada.borradas };
    } catch (e: any) {
      const sinRed = e instanceof SinConexion;
      if (!subida.enviadas && !subida.borradasEnviadas) throw new Error(sinRed ? 'Sin conexión con el servidor.' : `No se pudo descargar lo del equipo: ${e.message}`);
      throw new Error(`Se enviaron ${subida.enviadas} luminaria(s), pero no se pudo descargar lo del equipo: ${sinRed ? 'sin conexión' : e.message}`);
    }
  }

  let corriendo = false;

  /** Sincronización silenciosa de todos los proyectos. Devuelve cuántos cambios hubo (enviados + recibidos). */
  async function sincronizarTodo(): Promise<number> {
    const a = await d.cargarAjustes();
    if (!a.autoSync || !a.syncUrl || corriendo) return 0;
    corriendo = true;
    try {
      let cambios = 0;
      let primerError: unknown = null;
      for (const p of await d.almacen.listarProyectos()) {
        try { // un proyecto con problemas no debe impedir que sincronicen los demás
          const r = await sincronizar(p);
          cambios += r.enviadas + r.borradasEnviadas + r.recibidas + r.borradasRemotas;
        } catch (e) { primerError ??= e; }
      }
      if (primerError && cambios === 0) throw primerError;
      return cambios;
    } finally { corriendo = false; }
  }

  return { sincronizar, sincronizarTodo };
}
