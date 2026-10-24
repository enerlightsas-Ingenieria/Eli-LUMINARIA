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
  return { proyectosNuevos: await asegurarProyectos(cfg.proyectos ?? []) };
}

/** Crea los proyectos que falten (sin distinguir mayúsculas). Devuelve cuántos creó. */
export async function asegurarProyectos(nombres: string[]): Promise<number> {
  const existentes = new Set((await listarProyectos()).map((p) => p.nombre.trim().toLowerCase()));
  let nuevos = 0;
  for (const nombre of nombres) {
    const n = nombre.trim();
    if (n && !existentes.has(n.toLowerCase())) { await crearProyecto(n); existentes.add(n.toLowerCase()); nuevos++; }
  }
  return nuevos;
}
