import { useEffect, useState } from 'react';
import { EstadoSinConexion, estadoSinConexion } from './pwa';

/** Estado de preparación para trabajar sin conexión (se consulta hasta que esté lista). */
export function useEstadoSinConexion(): EstadoSinConexion {
  const [estado, setEstado] = useState<EstadoSinConexion>('preparando');
  useEffect(() => {
    let vivo = true;
    const consultar = async () => { const e = await estadoSinConexion(); if (vivo) setEstado(e); return e; };
    consultar();
    const t = setInterval(async () => { if ((await consultar()) !== 'preparando') clearInterval(t); }, 1500);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  return estado;
}

/** true cuando se instaló una versión nueva mientras la página estaba abierta (hay que recargar para usarla). */
export function useActualizacionDisponible(): boolean {
  const [nueva, setNueva] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const habiaControlador = !!navigator.serviceWorker.controller; // la primera instalación no cuenta como "actualización"
    const f = () => { if (habiaControlador) setNueva(true); };
    navigator.serviceWorker.addEventListener('controllerchange', f);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', f);
  }, []);
  return nueva;
}
