import { useEffect, useState } from 'react';

/** false solo si el navegador asegura que no hay conexión; ante la duda deja que el intento real decida. */
export const hayConexion = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** Estado de conexión reactivo (eventos online/offline del navegador). */
export function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(hayConexion);
  useEffect(() => {
    const on = () => setEnLinea(true), off = () => setEnLinea(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return enLinea;
}
