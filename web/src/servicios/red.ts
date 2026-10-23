/** false solo si el navegador asegura que no hay conexión; ante la duda deja que el intento real decida. */
export const hayConexion = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
