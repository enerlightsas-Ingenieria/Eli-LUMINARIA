import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { crearJornada } from '../core/jornada';
import { obtenerPosicion } from './captura';
import * as db from './db';
import { postServidor } from './servidor';
import { cargarAjustes } from './settings';

export { INTERVALO_MS, MAX_HORAS } from '../core/jornada';
export type { EstadoJornada, FaseJornada } from '../core/jornada';

// Las dependencias se resuelven en cada llamada (no al cargar el módulo) para que las pruebas puedan sustituirlas.
const jornada = crearJornada({
  almacen: {
    leerKv: (k) => db.leerKv(k),
    guardarKv: (k, v) => db.guardarKv(k, v),
    contarDesde: (t, d) => db.contarDesde(t, d),
    contarEntre: (t, a, b) => db.contarEntre(t, a, b),
  },
  nuevoUuid: () => db.nuevoUuid(),
  cargarAjustes: () => cargarAjustes(),
  obtenerPosicion: (p) => obtenerPosicion(p),
  post: (a, c, t) => postServidor(a, c, t),
  plataforma: () => Platform.OS,
  version: () => Constants.expoConfig?.version ?? '',
});

export const { dispositivoId, cargarJornada, haAceptado, registrarConsentimiento, iniciarJornada, cambiarFase, enviarLatido } = jornada;
