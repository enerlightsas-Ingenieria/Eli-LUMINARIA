import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { aCsv, aGeoJson, aKml } from '../lib/formats';
import { Luminaria, Proyecto } from '../types';

export type Formato = 'csv' | 'geojson' | 'kml';

const DEF: Record<Formato, { ext: string; mime: string; uti: string; gen: (i: Luminaria[], p?: Proyecto) => string }> = {
  csv: { ext: 'csv', mime: 'text/csv', uti: 'public.comma-separated-values-text', gen: aCsv },
  geojson: { ext: 'geojson', mime: 'application/geo+json', uti: 'public.json', gen: aGeoJson },
  kml: { ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', uti: 'com.google.earth.kml', gen: aKml },
};

export async function exportar(formato: Formato, items: Luminaria[], proyecto?: Proyecto): Promise<void> {
  const d = DEF[formato];
  const slug = (proyecto?.nombre ?? 'luminarias').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'luminarias';
  const file = new File(Paths.cache, `${slug}_${new Date().toISOString().slice(0, 10)}.${d.ext}`);
  file.create({ overwrite: true });
  file.write(d.gen(items, proyecto));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartir no está disponible en este dispositivo.');
  await Sharing.shareAsync(file.uri, { mimeType: d.mime, dialogTitle: 'Exportar luminarias', UTI: d.uti });
}
