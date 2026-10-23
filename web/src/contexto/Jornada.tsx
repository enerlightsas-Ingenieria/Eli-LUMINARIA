import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { INTERVALO_MS } from '@compartido/core/jornada';
import type { EstadoJornada } from '@compartido/core/jornada';
import { jornada } from '../servicios/nucleo';
import { useApp } from './App';

interface Ctx {
  estado: EstadoJornada | null;
  ultimoEnvio: Date | null;
  iniciar: () => Promise<void>;
  pausar: () => Promise<void>;
  reanudar: () => Promise<void>;
  terminar: () => Promise<void>;
}
const JornadaCtx = createContext<Ctx>(null as any);
export const useJornada = () => useContext(JornadaCtx);

export function JornadaProvider({ children }: { children: ReactNode }) {
  const { proyecto } = useApp();
  const nombre = proyecto?.nombre;
  const [estado, setEstado] = useState<EstadoJornada | null>(null);
  const [ultimoEnvio, setUltimoEnvio] = useState<Date | null>(null);

  const latir = useCallback(async () => {
    if (await jornada.enviarLatido(nombre)) setUltimoEnvio(new Date());
    setEstado(await jornada.cargarJornada());
  }, [nombre]);

  useEffect(() => { jornada.cargarJornada().then(setEstado); }, []);

  // Con la página abierta: latido cada 5 min, al volver a verla y al recuperar la conexión; también reintenta un cierre sin enviar.
  const necesitaLatir = estado?.fase === 'activa' || !!estado?.sinEnviar;
  useEffect(() => {
    if (!necesitaLatir) return;
    const t = setInterval(latir, INTERVALO_MS);
    const visible = () => { if (document.visibilityState === 'visible') latir(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', latir);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', latir); };
  }, [necesitaLatir, latir]);

  // Mantiene la pantalla encendida durante la jornada activa (si el navegador lo permite): un navegador en segundo plano no envía latidos.
  const activa = estado?.fase === 'activa';
  useEffect(() => {
    if (!activa || !('wakeLock' in navigator)) return;
    let sentinela: WakeLockSentinel | null = null;
    let cancelado = false;
    const pedir = async () => {
      try { const s = await navigator.wakeLock.request('screen'); if (cancelado) s.release().catch(() => {}); else sentinela = s; } catch { /* sin permiso o sin soporte */ }
    };
    pedir();
    const volver = () => { if (document.visibilityState === 'visible') pedir(); }; // el sistema la libera al ocultar la página
    document.addEventListener('visibilitychange', volver);
    return () => { cancelado = true; document.removeEventListener('visibilitychange', volver); sentinela?.release().catch(() => {}); };
  }, [activa]);

  const cambiar = useCallback(async (fase: 'activa' | 'pausada' | 'terminada') => {
    setEstado(await jornada.cambiarFase(fase));
    await latir();
  }, [latir]);

  const valor = useMemo<Ctx>(() => ({
    estado, ultimoEnvio,
    iniciar: async () => { setEstado(await jornada.iniciarJornada()); await latir(); },
    pausar: () => cambiar('pausada'),
    reanudar: () => cambiar('activa'),
    terminar: () => cambiar('terminada'),
  }), [estado, ultimoEnvio, latir, cambiar]);

  return <JornadaCtx.Provider value={valor}>{children}</JornadaCtx.Provider>;
}
