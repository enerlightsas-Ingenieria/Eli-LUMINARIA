/**
 * Reglas del "modo terceros": una captura solo es válida con la jornada activa, con GPS suficientemente preciso
 * y sin ubicación simulada. Lógica pura (sin pantallas) para poder probarla y reutilizarla.
 * Nota: son reglas de la app; el servidor vuelve a auditar cada registro (un cliente modificado podría saltárselas).
 */
export interface PosicionEvaluable {
  latitud: number;
  longitud: number;
  precisionM: number | null;
  simulada?: boolean;
}

export interface EntradaPolitica {
  modoTerceros: boolean;
  jornadaActiva: boolean;
  posicion: PosicionEvaluable | null;
  precisionMaxM: number;
}

export type MotivoBloqueo = 'SIN_JORNADA' | 'UBICACION_SIMULADA' | 'SIN_GPS' | 'GPS_IMPRECISO';
export type Evaluacion = { ok: true } | { ok: false; motivo: MotivoBloqueo; mensaje: string };

export function evaluarCaptura(e: EntradaPolitica): Evaluacion {
  if (!e.modoTerceros) return { ok: true };
  if (!e.jornadaActiva) return { ok: false, motivo: 'SIN_JORNADA', mensaje: 'Inicia tu jornada para poder capturar.' };
  const p = e.posicion;
  if (p?.simulada) {
    return { ok: false, motivo: 'UBICACION_SIMULADA', mensaje: 'Se detectó ubicación simulada. Desactiva las apps de ubicación falsa para capturar.' };
  }
  if (!p) return { ok: false, motivo: 'SIN_GPS', mensaje: 'Esperando la señal GPS… Asegúrate de tener la ubicación activada y estar a cielo abierto.' };
  if (p.precisionM == null || p.precisionM > e.precisionMaxM) {
    const medida = p.precisionM == null ? 'sin medir' : `±${Math.round(p.precisionM)} m`;
    return { ok: false, motivo: 'GPS_IMPRECISO', mensaje: `Precisión GPS ${medida}; se requiere ±${e.precisionMaxM} m o mejor. Espera unos segundos o muévete a cielo abierto.` };
  }
  return { ok: true };
}

export const galeriaPermitida = (modoTerceros: boolean) => !modoTerceros;
