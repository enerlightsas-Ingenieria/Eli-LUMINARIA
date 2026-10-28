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

/**
 * Escucha el GPS unos segundos y se queda con la lectura MÁS PRECISA (la primera suele ser burda). Termina antes si logra `objetivoM`.
 * `alProgreso` recibe la mejor precisión vista hasta el momento. null si el GPS no dio ninguna lectura.
 */
export function obtenerMejorPosicion(maxMs = 12000, objetivoM = 5, alProgreso?: (precisionM: number) => void): Promise<Posicion | null> {
  return new Promise((res) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return res(null);
    let mejor: Posicion | null = null;
    let id = -1;
    const terminar = () => { clearTimeout(t); if (id >= 0) navigator.geolocation.clearWatch(id); res(mejor); };
    const t = setTimeout(terminar, maxMs);
    id = navigator.geolocation.watchPosition(
      (p) => {
        const acc = p.coords.accuracy ?? null;
        if (!mejor || (acc != null && (mejor.precisionM == null || acc < mejor.precisionM))) {
          mejor = { latitud: p.coords.latitude, longitud: p.coords.longitude, precisionM: acc, simulada: false };
          if (acc != null) alProgreso?.(acc);
        }
        if (acc != null && acc <= objetivoM) terminar();
      },
      () => terminar(),
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs },
    );
  });
}
