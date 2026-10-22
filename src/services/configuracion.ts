import { Alert } from 'react-native';
import { ConfigFlota, decodificar, describir } from '../lib/config';
import { crearProyecto, listarProyectos } from './db';
import { cargarAjustes, guardarAjustes } from './settings';

/** Aplica la configuración: sólo toca lo que el código trae y crea los proyectos que falten. */
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
  });
  const existentes = new Set((await listarProyectos()).map((p) => p.nombre.trim().toLowerCase()));
  let proyectosNuevos = 0;
  for (const nombre of cfg.proyectos ?? []) {
    if (!existentes.has(nombre.toLowerCase())) { await crearProyecto(nombre); existentes.add(nombre.toLowerCase()); proyectosNuevos++; }
  }
  return { proyectosNuevos };
}

/** Decodifica, muestra a dónde apuntará la app y, si el técnico acepta, aplica. */
export function pedirYAplicar(entrada: string, alTerminar: () => void): void {
  let cfg: ConfigFlota;
  try { cfg = decodificar(entrada); } catch (e: any) { Alert.alert('Configuración', e.message ?? String(e)); return; }
  Alert.alert('¿Importar configuración?', `${describir(cfg) || 'Sin cambios.'}\n\nSólo acepta si la recibiste de tu empresa.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Importar', onPress: async () => {
      try {
        const r = await aplicarConfig(cfg);
        alTerminar();
        Alert.alert('Listo', r.proyectosNuevos ? `Configuración aplicada y ${r.proyectosNuevos} proyecto(s) creados.` : 'Configuración aplicada.');
      } catch (e: any) { Alert.alert('No se pudo importar', e.message ?? String(e)); }
    } },
  ]);
}
