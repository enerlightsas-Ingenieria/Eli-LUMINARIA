export interface Punto { latitud: number | null; longitud: number | null }

/** Distancia en metros entre dos coordenadas (haversine). */
export function distanciaM(a: { latitud: number; longitud: number }, b: { latitud: number; longitud: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitud - a.latitud);
  const dLng = rad(b.longitud - a.longitud);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Devuelve el elemento más cercano (dentro de maxM metros) al punto dado, o null. */
export function masCercano<T extends Punto>(p: { latitud: number; longitud: number }, lista: T[], maxM: number): { item: T; metros: number } | null {
  let mejor: { item: T; metros: number } | null = null;
  for (const item of lista) {
    if (item.latitud == null || item.longitud == null) continue;
    const metros = distanciaM(p, { latitud: item.latitud, longitud: item.longitud });
    if (metros <= maxM && (!mejor || metros < mejor.metros)) mejor = { item, metros };
  }
  return mejor;
}

export const coordenadaValida = (lat: number | null, lng: number | null): boolean =>
  lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export const enlaceMapa = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;
