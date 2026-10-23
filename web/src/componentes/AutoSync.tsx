import { useCallback, useEffect } from 'react';
import { useApp } from '../contexto/App';
import { sincronizacion } from '../servicios/nucleo';

/** Envía en segundo plano lo pendiente: al guardar (con pausa de 3 s), al volver a la página y al recuperar la conexión. */
export function AutoSync() {
  const { listo, pendientes, refrescar } = useApp();
  const correr = useCallback(async () => {
    try { if ((await sincronizacion.sincronizarTodo()) > 0) await refrescar(); } catch { /* sin conexión: se reintenta luego */ }
  }, [refrescar]);

  useEffect(() => {
    if (!listo || !pendientes) return;
    const t = setTimeout(correr, 3000);
    return () => clearTimeout(t);
  }, [listo, pendientes, correr]);

  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') correr(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', correr);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', correr); };
  }, [correr]);
  return null;
}
