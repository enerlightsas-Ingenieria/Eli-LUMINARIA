import type { ConfigFlota } from '@compartido/lib/config';
import { cargarAjustes, guardarAjustes } from './ajustes';
import { crearProyecto, listarProyectos } from './almacen';

/** Aplica la configuración: solo toca lo que el código trae y crea los proyectos que falten. */
export async function aplicarConfig(cfg: ConfigFlota): Promise<{ proyectosNuevos: number }> {
  const a = await cargarAjustes();
  await guardarAjustes({
    ...a,
    endpoint: cfg.endpoint ?? a.endpoint,
    apiKey: cfg.apiKey ?? a.apiKey,
    modelo: cfg.modelo ?? a.modelo,
    syncUrl: cfg.syncUrl ?? a.syncUrl,
    syncToken: cfg.syncToken ?? a.syncToken,
    syncFotos: cfg.syncFotos ?? a.syncFotos,
    tecnico: cfg.tecnico ?? a.tecnico,
    modoTerceros: cfg.modoTerceros ?? a.modoTerceros,
    precisionMaxM: cfg.precisionMaxM ?? a.precisionMaxM,
    supervisor: cfg.supervisor ?? a.supervisor,
    rol: cfg.apiKey && cfg.apiKey !== a.apiKey ? undefined : a.rol,   // otra cuenta en este teléfono: el rol se vuelve a pedir al servidor
  });
  const existentes = new Set((await listarProyectos()).map((p) => p.nombre.trim().toLowerCase()));
  let proyectosNuevos = 0;
  for (const nombre of cfg.proyectos ?? []) {
    if (!existentes.has(nombre.toLowerCase())) { await crearProyecto(nombre); existentes.add(nombre.toLowerCase()); proyectosNuevos++; }
  }
  return { proyectosNuevos };
}
