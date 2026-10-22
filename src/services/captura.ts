import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export interface Foto { uri: string; base64: string; origen: 'camara' | 'galeria'; exifLat?: number; exifLng?: number }
/** simulada: Android marca la ubicación como proveniente de una app de GPS falso (iOS no expone este dato). */
export interface Posicion { latitud: number; longitud: number; precisionM: number | null; simulada?: boolean }

/** Abre cámara o galería, reduce la imagen (1280 px) y devuelve JPEG + base64. */
export async function tomarFoto(origen: 'camara' | 'galeria'): Promise<Foto | null> {
  if (origen === 'camara') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error('Se necesita permiso de cámara. Actívalo en los ajustes del teléfono.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: true };
  const r = origen === 'camara' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.[0]) return null;

  const a = r.assets[0];
  const exif: any = a.exif ?? {};
  const small = await manipulateAsync(a.uri, [{ resize: { width: 1280 } }], { compress: 0.8, format: SaveFormat.JPEG, base64: true });
  const lat = typeof exif.GPSLatitude === 'number' ? exif.GPSLatitude * (exif.GPSLatitudeRef === 'S' ? -1 : 1) : undefined;
  const lng = typeof exif.GPSLongitude === 'number' ? exif.GPSLongitude * (exif.GPSLongitudeRef === 'W' ? -1 : 1) : undefined;
  return { uri: small.uri, base64: small.base64 ?? '', origen, exifLat: lat, exifLng: lng };
}

/** 'alta' para registrar una luminaria; 'balanceada' para los latidos de la jornada (menos batería). */
export async function obtenerPosicion(precision: 'alta' | 'balanceada' = 'alta'): Promise<Posicion | null> {
  const p = await Location.requestForegroundPermissionsAsync();
  if (!p.granted) return null;
  try {
    if (precision === 'balanceada') {
      const reciente = await Location.getLastKnownPositionAsync({ maxAge: 120000 }).catch(() => null);
      if (reciente) return { latitud: reciente.coords.latitude, longitud: reciente.coords.longitude, precisionM: reciente.coords.accuracy ?? null, simulada: !!reciente.mocked };
    }
    const l = await Location.getCurrentPositionAsync({ accuracy: precision === 'alta' ? Location.Accuracy.High : Location.Accuracy.Balanced });
    return { latitud: l.coords.latitude, longitud: l.coords.longitude, precisionM: l.coords.accuracy ?? null, simulada: !!l.mocked };
  } catch {
    const l = await Location.getLastKnownPositionAsync().catch(() => null);
    return l ? { latitud: l.coords.latitude, longitud: l.coords.longitude, precisionM: l.coords.accuracy ?? null, simulada: !!l.mocked } : null;
  }
}

export async function direccionDe(lat: number, lng: number): Promise<string> {
  try {
    const [d] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!d) return '';
    return [d.street && `${d.street}${d.streetNumber ? ' ' + d.streetNumber : ''}`, d.district ?? d.subregion, d.city].filter(Boolean).join(', ');
  } catch {
    return '';
  }
}
