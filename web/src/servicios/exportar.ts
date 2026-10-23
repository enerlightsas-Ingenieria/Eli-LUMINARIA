import { aCsv, aGeoJson, aKml } from '@compartido/lib/formats';
import type { Luminaria, Proyecto } from '@compartido/types';

export type Formato = 'csv' | 'geojson' | 'kml';

const DEF: Record<Formato, { ext: string; mime: string; gen: (i: Luminaria[], p?: Proyecto) => string }> = {
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8', gen: aCsv },
  geojson: { ext: 'geojson', mime: 'application/geo+json', gen: aGeoJson },
  kml: { ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', gen: aKml },
};

export const nombreArchivo = (formato: Formato, proyecto?: Proyecto, fecha = new Date()) => {
  const slug = (proyecto?.nombre ?? 'luminarias').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'luminarias';
  return `${slug}_${fecha.toISOString().slice(0, 10)}.${DEF[formato].ext}`;
};

/** Genera el archivo y lo entrega: compartir del sistema si el navegador lo permite (iPhone), si no, descarga. */
export async function exportar(formato: Formato, items: Luminaria[], proyecto?: Proyecto): Promise<void> {
  const d = DEF[formato];
  const nombre = nombreArchivo(formato, proyecto);
  const blob = new Blob([d.gen(items, proyecto)], { type: d.mime });
  const archivo = new File([blob], nombre, { type: d.mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [archivo] })) {
    try { await nav.share({ files: [archivo], title: nombre }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
