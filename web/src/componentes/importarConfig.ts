import { decodificar, describir } from '@compartido/lib/config';
import { aplicarConfig } from '../servicios/configuracion';
import { dialogo, avisar } from './dialogos';

/** Decodifica, muestra a dónde apuntará la app y, si el usuario acepta, aplica. Devuelve true si se importó. */
export async function pedirYAplicar(entrada: string, alTerminar: () => void): Promise<boolean> {
  let cfg;
  try { cfg = decodificar(entrada); } catch (e: any) { await avisar('Configuración', e.message ?? String(e)); return false; }
  const r = await dialogo({
    titulo: '¿Importar configuración?',
    mensaje: `${describir(cfg) || 'Sin cambios.'}\n\nSolo acepta si la recibiste de tu empresa.`,
    botones: [{ texto: 'Cancelar', estilo: 'cancelar' }, { texto: 'Importar' }],
  });
  if (r !== 1) return false;
  try {
    const res = await aplicarConfig(cfg);
    alTerminar();
    await avisar('Listo', res.proyectosNuevos ? `Configuración aplicada y ${res.proyectosNuevos} proyecto(s) creados.` : 'Configuración aplicada.');
    return true;
  } catch (e: any) { await avisar('No se pudo importar', e.message ?? String(e)); return false; }
}
