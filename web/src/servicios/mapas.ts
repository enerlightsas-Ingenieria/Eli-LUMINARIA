/**
 * Fondos del mapa. Por defecto: OpenStreetMap (calles) y Esri (satélite), buenos para pruebas. Para uso comercial cada despliegue puede
 * poner los de su proveedor (MapTiler, Mapbox…) en servidor.json:
 *   { "proxy": "...", "mapas": { "calles": "https://…/{z}/{x}/{y}.png?key=…", "satelite": "https://…/{z}/{x}/{y}.jpg?key=…", "atribucion": "© MapTiler © OpenStreetMap" } }
 * (la clave de un mapa va dentro de la dirección y es pública: restríngela por dominio en el panel del proveedor).
 */
export interface CapaMapa { url: string; atribucion: string; maxNativeZoom: number }
export interface CapasMapa { calles: CapaMapa; satelite: CapaMapa }

export const MAPAS_POR_DEFECTO: CapasMapa = {
  calles: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', atribucion: '© OpenStreetMap', maxNativeZoom: 19 },
  satelite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', atribucion: 'Esri', maxNativeZoom: 19 },
};

let actuales: CapasMapa = MAPAS_POR_DEFECTO;
export const capasMapa = () => actuales;

const urlValida = (u: unknown): u is string => typeof u === 'string' && u.length <= 400 && /^https:\/\/[^\s<>"']+$/.test(u) && ['{z}', '{x}', '{y}'].every((p) => u.includes(p));
/** Leaflet muestra la atribución como HTML: aquí solo se admite texto. */
const soloTexto = (t: unknown) => (typeof t === 'string' ? t.replace(/[<>]/g, '').trim().slice(0, 200) : '');

/** Aplica la sección "mapas" de servidor.json; lo que no sea válido se ignora y queda el fondo por defecto. */
export function aplicarConfigMapas(cfg: unknown): CapasMapa {
  const c = (cfg && typeof cfg === 'object' ? cfg : {}) as Record<string, unknown>;
  const atrib = soloTexto(c.atribucion);
  actuales = {
    calles: urlValida(c.calles) ? { url: c.calles, atribucion: atrib || MAPAS_POR_DEFECTO.calles.atribucion, maxNativeZoom: 19 } : MAPAS_POR_DEFECTO.calles,
    satelite: urlValida(c.satelite) ? { url: c.satelite, atribucion: atrib || MAPAS_POR_DEFECTO.satelite.atribucion, maxNativeZoom: 19 } : MAPAS_POR_DEFECTO.satelite,
  };
  return actuales;
}

/** Lee servidor.json (el mismo que trae el proxy de este despliegue) y aplica sus fondos de mapa. Sin red o sin archivo: quedan los de por defecto. */
export async function cargarConfigMapas(): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}servidor.json`, { cache: 'no-cache' });
    if (r.ok) aplicarConfigMapas((await r.json())?.mapas);
  } catch { /* se usan los de por defecto */ }
}
