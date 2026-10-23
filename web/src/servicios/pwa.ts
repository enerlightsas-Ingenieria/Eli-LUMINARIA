declare const __BUILD__: string;

let eventoInstalar: any = null;
const oyentes = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); eventoInstalar = e; oyentes.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { eventoInstalar = null; oyentes.forEach((f) => f()); });
}

export const puedeInstalar = () => !!eventoInstalar;
export const alCambiarInstalable = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };
export async function instalar(): Promise<boolean> {
  if (!eventoInstalar) return false;
  eventoInstalar.prompt();
  const r = await eventoInstalar.userChoice;
  eventoInstalar = null;
  return r?.outcome === 'accepted';
}

export const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const esInstalada = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

/** Registra el service worker (solo en producción): la app abre sin conexión una vez cargada. */
export function registrarServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`./sw.js?v=${typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}`).catch(() => {});
  });
}

/** Pide al navegador que NO borre los datos locales por falta de espacio o inactividad (clave en iPhone). */
export async function pedirAlmacenamientoPersistente(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export type EstadoSinConexion = 'lista' | 'preparando' | 'no-disponible';

/** ¿Ya están guardados en este dispositivo todos los archivos de la app para abrirla sin internet? */
export async function estadoSinConexion(): Promise<EstadoSinConexion> {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'no-disponible';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || reg.active?.state !== 'activated') return 'preparando';
    // el service worker solo se activa cuando terminó de guardar todos los archivos (precache.json)
    return (await caches.keys()).some((k) => k.startsWith('eli-')) ? 'lista' : 'preparando';
  } catch { return 'no-disponible'; }
}
