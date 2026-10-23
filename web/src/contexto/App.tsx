import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Ajustes } from '@compartido/core/ajustes';
import type { Luminaria } from '@compartido/types';
import { ajustesPorDefecto, cargarAjustes } from '../servicios/ajustes';
import { verificarIdentidad } from '../servicios/identidad';
import { guardarKv, leerKv, listarLuminarias, listarProyectos, ProyectoConCuenta } from '../servicios/almacen';

export interface ContextoApp {
  listo: boolean;
  proyectos: ProyectoConCuenta[];
  proyecto: ProyectoConCuenta | null;
  items: Luminaria[];
  pendientes: number;
  ajustes: Ajustes;
  refrescar: () => Promise<void>;
  activar: (id: number) => Promise<void>;
  recargarAjustes: () => Promise<void>;
  /** Sube cada vez que se importa una configuración: las pantallas que muestran ajustes deben recargarlos. */
  versionConfig: number;
  configCambiada: () => void;
}

const Ctx = createContext<ContextoApp>(null as any);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [listo, setListo] = useState(false);
  const [proyectos, setProyectos] = useState<ProyectoConCuenta[]>([]);
  const [activoId, setActivoId] = useState<number | null>(null);
  const [items, setItems] = useState<Luminaria[]>([]);
  const [ajustes, setAjustes] = useState<Ajustes>(ajustesPorDefecto());
  const [versionConfig, setVersionConfig] = useState(0);

  const cargar = useCallback(async (preferido?: number | null) => {
    const ps = await listarProyectos();
    const guardado = preferido ?? Number(await leerKv('proyectoActivo'));
    const activo = ps.find((p) => p.id === guardado) ?? ps[0] ?? null;
    setProyectos(ps);
    setActivoId(activo?.id ?? null);
    setItems(activo ? await listarLuminarias(activo.id) : []);
    setAjustes(await cargarAjustes());
    setListo(true);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { document.documentElement.dataset.tema = ajustes.tema; }, [ajustes.tema]);

  // El servidor es quien dice el rol y el nombre de la cuenta: se consulta al abrir y al importar una configuración (si hay conexión).
  useEffect(() => {
    if (!listo) return;
    let vivo = true;
    verificarIdentidad().then((cambio) => { if (cambio && vivo) cargarAjustes().then(setAjustes); });
    return () => { vivo = false; };
  }, [listo, versionConfig]);

  const refrescar = useCallback(() => cargar(activoId), [cargar, activoId]);
  const activar = useCallback(async (id: number) => { await guardarKv('proyectoActivo', String(id)); await cargar(id); }, [cargar]);
  const recargarAjustes = useCallback(async () => setAjustes(await cargarAjustes()), []);
  const configCambiada = useCallback(() => { setVersionConfig((v) => v + 1); cargarAjustes().then(setAjustes); }, []);

  const valor = useMemo<ContextoApp>(() => ({
    listo, proyectos, proyecto: proyectos.find((p) => p.id === activoId) ?? null, items, ajustes,
    pendientes: items.filter((l) => !l.sincronizado).length,
    refrescar, activar, recargarAjustes, versionConfig, configCambiada,
  }), [listo, proyectos, activoId, items, ajustes, refrescar, activar, recargarAjustes, versionConfig, configCambiada]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
