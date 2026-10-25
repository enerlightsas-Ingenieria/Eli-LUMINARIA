import { Caracteristicas, caracteristicasVacias, Confianza, Luminaria } from '../types';

/** Campos que viajan en la sincronización (todo lo de la luminaria salvo fotos locales e ids locales). */
export type DatosRemotos = Omit<Luminaria, 'id' | 'proyectoId' | 'fotos' | 'sincronizado'>;

export interface Remota {
  uuid: string;
  /** El registro fue eliminado por algún técnico (la hoja conserva la fila marcada). */
  eliminada: boolean;
  datos: DatosRemotos;
}

export type Accion = 'insertar' | 'actualizar' | 'borrar' | 'omitir';

const texto = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v).trim());
const numero = (v: unknown): number | null => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Convierte una fila de la hoja (Sheets devuelve números/fechas donde la app guarda texto) a datos de la app. */
export function normalizarRemota(fila: Record<string, unknown>): Remota | null {
  const uuid = texto(fila.uuid);
  if (!uuid) return null;
  const car = caracteristicasVacias();
  for (const k of Object.keys(car) as (keyof Caracteristicas)[]) car[k] = texto(fila[k]);
  const conf = texto(fila.confianza);
  const ahora = new Date().toISOString();
  return {
    uuid,
    eliminada: texto(fila.eliminada).toUpperCase().startsWith('S'),
    datos: {
      ...car,
      uuid,
      creadoEn: texto(fila.creadoEn) || ahora,
      actualizadoEn: texto(fila.actualizadoEn) || texto(fila.recibidoEn) || ahora,
      latitud: numero(fila.latitud),
      longitud: numero(fila.longitud),
      precisionM: numero(fila.precisionM),
      direccion: texto(fila.direccion),
      codigoPoste: texto(fila.codigoPoste),
      codigo: texto(fila.codigo),
      tecnico: texto(fila.tecnico),
      usuario: texto(fila.usuario),
      origen: (['camara', 'galeria'].includes(texto(fila.origen)) ? texto(fila.origen) : '') as 'camara' | 'galeria' | '',
      ubicacionSimulada: fila.ubicacionSimulada === true || texto(fila.ubicacionSimulada).toUpperCase().startsWith('S'),
      jornadaId: texto(fila.jornadaId),
      confianza: (['alta', 'media', 'baja'].includes(conf) ? conf : '') as Confianza | '',
    },
  };
}

/**
 * Regla de fusión (sin relojes de dispositivos; el servidor ordena):
 *  - lo que borré yo y aún no se envió, no se resucita;
 *  - lo borrado por alguien gana siempre;
 *  - mis cambios pendientes de enviar no se pisan (se envían después y ganan);
 *  - en cualquier otro caso manda la versión de la hoja.
 */
export function decidir(local: { sincronizado: boolean } | undefined, r: Remota, borradaLocalmente: boolean): Accion {
  if (borradaLocalmente) return 'omitir';
  if (r.eliminada) return local ? 'borrar' : 'omitir';
  if (!local) return 'insertar';
  return local.sincronizado ? 'actualizar' : 'omitir';
}
