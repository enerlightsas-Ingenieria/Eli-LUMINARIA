import { obtenerFoto } from './almacen';

export function blobABase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const lector = new FileReader();
    lector.onload = () => res(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => rej(lector.error);
    lector.readAsDataURL(blob);
  });
}

/** Dibuja la imagen reducida (lado mayor 1280 px) y la devuelve como JPEG. */
export interface Recorte { sx: number; sy: number; sw: number; sh: number }

/** Zona central de la imagen que queda visible con un zoom digital (zoom 2 = la mitad del ancho y del alto). */
export function recorteParaZoom(ancho: number, alto: number, zoom: number): Recorte {
  const z = Math.max(1, zoom || 1);
  const sw = ancho / z, sh = alto / z;
  return { sx: (ancho - sw) / 2, sy: (alto - sh) / 2, sw, sh };
}

/** `recorte` (opcional): solo esa parte de la fuente; `ancho` y `alto` son entonces las medidas de ese recorte. */
export function aJpegReducido(fuente: CanvasImageSource, ancho: number, alto: number, maxLado = 1280, calidad = 0.8, recorte?: Recorte): Promise<Blob> {
  const k = Math.min(1, maxLado / Math.max(ancho, alto));
  const c = document.createElement('canvas');
  c.width = Math.round(ancho * k); c.height = Math.round(alto * k);
  const ctx = c.getContext('2d')!;
  if (recorte) ctx.drawImage(fuente, recorte.sx, recorte.sy, recorte.sw, recorte.sh, 0, 0, c.width, c.height);
  else ctx.drawImage(fuente, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo procesar la foto.'))), 'image/jpeg', calidad));
}

/** Lee un archivo de imagen (galería o cámara del sistema) y lo reduce. */
export async function archivoAJpeg(archivo: File): Promise<Blob> {
  const bmp = await createImageBitmap(archivo);
  try { return await aJpegReducido(bmp, bmp.width, bmp.height); } finally { bmp.close(); }
}

const urls = new Map<string, string>();
/** URL temporal para mostrar una foto guardada (se reutiliza mientras la página esté abierta). */
export async function urlDeFoto(id: string): Promise<string | undefined> {
  const hit = urls.get(id);
  if (hit) return hit;
  const b = await obtenerFoto(id);
  if (!b) return undefined;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}

export async function base64DeFoto(id: string): Promise<string> {
  const b = await obtenerFoto(id);
  if (!b) throw new Error('La foto ya no está en este dispositivo.');
  return blobABase64(b);
}
