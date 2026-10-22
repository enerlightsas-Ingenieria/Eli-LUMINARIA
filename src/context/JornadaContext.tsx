import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useApp } from './AppContext';
import { cambiarFase, cargarJornada, enviarLatido, EstadoJornada, INTERVALO_MS, iniciarJornada } from '../services/jornada';

interface Ctx {
  estado: EstadoJornada | null;
  /** Última vez que el servidor confirmó un latido en esta sesión. */
  ultimoEnvio: Date | null;
  iniciar: () => Promise<void>;
  pausar: () => Promise<void>;
  reanudar: () => Promise<void>;
  terminar: () => Promise<void>;
}

const JornadaContext = createContext<Ctx>(null as any);
export const useJornada = () => useContext(JornadaContext);

export function JornadaProvider({ children }: { children: React.ReactNode }) {
  const { proyecto } = useApp();
  const nombre = proyecto?.nombre;
  const [estado, setEstado] = useState<EstadoJornada | null>(null);
  const [ultimoEnvio, setUltimoEnvio] = useState<Date | null>(null);

  const latir = useCallback(async () => {
    if (await enviarLatido(nombre)) setUltimoEnvio(new Date());
    setEstado(await cargarJornada());
  }, [nombre]);

  useEffect(() => { cargarJornada().then(setEstado); }, []);

  // Con la app abierta: latido cada 5 min y al volver a primer plano. Se reintenta también un cambio de estado sin enviar.
  const necesitaLatir = estado?.fase === 'activa' || !!estado?.sinEnviar;
  useEffect(() => {
    if (!necesitaLatir) return;
    const t = setInterval(latir, INTERVALO_MS);
    const sub = AppState.addEventListener('change', (e) => { if (e === 'active') latir(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [necesitaLatir, latir]);

  const cambiar = useCallback(async (fase: 'activa' | 'pausada' | 'terminada') => {
    setEstado(await cambiarFase(fase));
    await latir();
  }, [latir]);

  const valor = useMemo<Ctx>(() => ({
    estado, ultimoEnvio,
    iniciar: async () => { setEstado(await iniciarJornada()); await latir(); },
    pausar: () => cambiar('pausada'),
    reanudar: () => cambiar('activa'),
    terminar: () => cambiar('terminada'),
  }), [estado, ultimoEnvio, latir, cambiar]);

  return <JornadaContext.Provider value={valor}>{children}</JornadaContext.Provider>;
}
