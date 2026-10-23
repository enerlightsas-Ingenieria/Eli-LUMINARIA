import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { guardarKv, leerKv, listarLuminarias, listarProyectos } from '../services/db';
import { Luminaria, Proyecto } from '../types';

type ProyectoConCuenta = Proyecto & { cantidad: number };

interface Ctx {
  listo: boolean;
  proyectos: ProyectoConCuenta[];
  proyecto: ProyectoConCuenta | null;
  items: Luminaria[];
  refrescar: () => Promise<void>;
  activar: (id: number) => Promise<void>;
  /** Sube cada vez que se importa una configuración (enlace o código): las pantallas que muestran ajustes deben recargarlos. */
  versionConfig: number;
  configCambiada: () => void;
}

const AppContext = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [listo, setListo] = useState(false);
  const [proyectos, setProyectos] = useState<ProyectoConCuenta[]>([]);
  const [activoId, setActivoId] = useState<number | null>(null);
  const [items, setItems] = useState<Luminaria[]>([]);
  const [versionConfig, setVersionConfig] = useState(0);
  const configCambiada = useCallback(() => setVersionConfig((v) => v + 1), []);

  const cargar = useCallback(async (preferido?: number | null) => {
    const ps = await listarProyectos();
    const guardado = preferido ?? Number(await leerKv('proyectoActivo'));
    const activo = ps.find((p) => p.id === guardado) ?? ps[0] ?? null;
    setProyectos(ps);
    setActivoId(activo?.id ?? null);
    setItems(activo ? await listarLuminarias(activo.id) : []);
    setListo(true);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const refrescar = useCallback(() => cargar(activoId), [cargar, activoId]);
  const activar = useCallback(async (id: number) => { await guardarKv('proyectoActivo', String(id)); await cargar(id); }, [cargar]);

  const value = useMemo<Ctx>(() => ({
    listo, proyectos, proyecto: proyectos.find((p) => p.id === activoId) ?? null, items, refrescar, activar, versionConfig, configCambiada,
  }), [listo, proyectos, activoId, items, refrescar, activar, versionConfig, configCambiada]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
