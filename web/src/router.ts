import { useEffect, useState } from 'react';

export interface Ruta { camino: string[]; consulta: URLSearchParams; crudo: string }

/** Enrutador por "#": funciona en cualquier hosting estático y los enlaces de configuración se abren con un toque. */
export function leerRuta(hash = location.hash): Ruta {
  const t = hash.replace(/^#/, '') || '/';
  const [ruta, ...resto] = t.split('?');
  return { camino: ruta.split('/').filter(Boolean), consulta: new URLSearchParams(resto.join('?')), crudo: t };
}

export function useRuta(): Ruta {
  const [ruta, setRuta] = useState<Ruta>(() => leerRuta());
  useEffect(() => {
    const f = () => setRuta(leerRuta());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return ruta;
}

export function ir(destino: string, reemplazar = false) {
  if (reemplazar) location.replace(`#${destino}`);
  else location.hash = destino;
}

export const volver = () => (history.length > 1 ? history.back() : ir('/', true));
