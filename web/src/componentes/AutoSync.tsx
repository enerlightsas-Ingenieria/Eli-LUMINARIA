import { useCallback, useEffect } from 'react';
import { useApp } from '../contexto/App';
import { verificarIdentidad } from '../servicios/identidad';
import { sincronizacion } from '../servicios/nucleo';

const CADA_MS = 45_000;

/**
 * Sincroniza en segundo plano: al guardar (con pausa de 3 s), al volver a la página, al recuperar la conexión y cada 45 s mientras la
 * app está a la vista (así lo que hace un equipo aparece pronto en los demás, y se notan proyectos eliminados, bajas y cambios de rol).
 */
export function AutoSync() {
  const { listo, pendientes, refrescar, recargarAjustes } = useApp();
  const correr = useCallback(async () => {
    try { if ((await sincronizacion.sincronizarTodo()) > 0) await refrescar(); } catch { /* sin conexión: se reintenta luego */ }
  }, [refrescar]);

  const revisarYCorrer = useCallback(async () => {
    try { if (await verificarIdentidad()) { await recargarAjustes(); await refrescar(); } } catch { /* sin conexión */ }
    await correr();
  }, [correr, recargarAjustes, refrescar]);

  useEffect(() => {
    if (!listo) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine !== false) revisarYCorrer(); }, CADA_MS);
    return () => clearInterval(t);
  }, [listo, revisarYCorrer]);

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
