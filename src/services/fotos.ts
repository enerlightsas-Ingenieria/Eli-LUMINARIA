import { Directory, File, Paths } from 'expo-file-system';
import { nuevoUuid } from './db';

const dir = () => {
  const d = new Directory(Paths.document, 'fotos');
  d.create({ idempotent: true, intermediates: true });
  return d;
};

/** Copia la foto del caché (que el SO puede vaciar) al almacenamiento permanente de la app. */
export function persistirFoto(uriTemporal: string): string {
  const destino = new File(dir(), `${nuevoUuid()}.jpg`);
  new File(uriTemporal).copy(destino);
  return destino.uri;
}

export function borrarFotos(uris: string[]): void {
  for (const u of uris) {
    try { const f = new File(u); if (f.exists) f.delete(); } catch { /* ya no existe */ }
  }
}

export const leerBase64 = (uri: string): Promise<string> => new File(uri).base64();
