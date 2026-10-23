import type { Posicion } from '@compartido/core/tipos';

/**
 * GPS del navegador. 'alta' = registrar una luminaria (sin caché, alta precisión); 'balanceada' = latidos de la jornada.
 * El navegador NO informa si la ubicación es simulada: en la web ese control lo hace solo la auditoría del servidor.
 */
export function obtenerPosicion(precision: 'alta' | 'balanceada'): Promise<Posicion | null> {
  return new Promise((res) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return res(null);
    const alta = precision === 'alta';
    navigator.geolocation.getCurrentPosition(
      (p) => res({ latitud: p.coords.latitude, longitud: p.coords.longitude, precisionM: p.coords.accuracy ?? null, simulada: false }),
      () => res(null),
      { enableHighAccuracy: alta, maximumAge: alta ? 0 : 120000, timeout: alta ? 20000 : 15000 },
    );
  });
}
