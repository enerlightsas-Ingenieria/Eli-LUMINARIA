import { Luminaria, Proyecto } from '../types';
import { marcarSincronizadas, pendientesDeSync } from './db';
import { leerBase64 } from './fotos';
import { cargarAjustes } from './settings';

const LOTE = 15;

export interface ResultadoSync { enviadas: number; pendientes: number }

/**
 * Envía las luminarias nuevas/modificadas a la URL configurada (Google Apps Script u otro servidor).
 * Es idempotente: cada luminaria lleva su `uuid`, así que reenviar sólo actualiza la fila existente.
 */
export async function sincronizar(proyecto: Proyecto, alProgreso?: (hechas: number, total: number) => void): Promise<ResultadoSync> {
  const a = await cargarAjustes();
  if (!a.syncUrl) throw new Error('Configura la URL de sincronización en Ajustes.');
  const pendientes = await pendientesDeSync(proyecto.id);
  let enviadas = 0;

  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE);
    const luminarias = await Promise.all(lote.map(async (l) => ({
      ...l,
      fotos: undefined,
      foto: a.syncFotos && l.fotos[0] ? await leerBase64(l.fotos[0]).catch(() => undefined) : undefined,
    })));
    let res: Response;
    try {
      res = await fetch(a.syncUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' }, // evita preflight en Apps Script
        body: JSON.stringify({ token: a.syncToken, proyecto: { uuid: proyecto.uuid, nombre: proyecto.nombre, cliente: proyecto.cliente }, luminarias }),
      });
    } catch {
      throw new Error(`Sin conexión. Se enviaron ${enviadas} de ${pendientes.length}; el resto queda pendiente.`);
    }
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(j?.error ?? `El servidor respondió ${res.status}. Revisa la URL y el token.`);
    await marcarSincronizadas(lote.map((l) => l.uuid));
    enviadas += lote.length;
    alProgreso?.(enviadas, pendientes.length);
  }
  return { enviadas, pendientes: 0 };
}
