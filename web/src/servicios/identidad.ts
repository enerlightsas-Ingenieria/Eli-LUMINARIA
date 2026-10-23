import { rolDe, type Rol } from '@compartido/core/ajustes';
import { codificar, type ConfigFlota } from '@compartido/lib/config';
import { cargarAjustes, guardarAjustes } from './ajustes';

export interface Usuario { nombre: string; rol: Rol; clave: string; activo: boolean }

const ANTHROPIC = 'api.anthropic.com';

/** Dirección base del proxy, o null si la app apunta directo a Anthropic / aún no está configurada. */
export async function baseProxy(): Promise<{ base: string; clave: string } | null> {
  const a = await cargarAjustes();
  const base = a.endpoint.trim().replace(/\/+$/, '').replace(/\/analizar$/, '');
  if (!a.apiKey || !/^https:\/\//i.test(base) || base.includes(ANTHROPIC)) return null;
  return { base, clave: a.apiKey };
}

async function llamarProxy(ruta: string, cuerpo: object, timeoutMs = 15000): Promise<any> {
  const p = await baseProxy();
  if (!p) throw new Error('La app aún no está configurada con el servidor de tu empresa.');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${p.base}${ruta}`, { method: 'POST', headers: { 'x-api-key': p.clave, 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (r.status === 401) throw Object.assign(new Error('Esta cuenta no tiene permiso para esto.'), { estado: 401 });
    if (!r.ok || !j?.ok) throw Object.assign(new Error(j?.error ?? `El servidor respondió ${r.status}.`), { estado: r.status });
    return j;
  } finally { clearTimeout(t); }
}

/**
 * Pregunta al servidor quién es esta clave y guarda su rol y su nombre (el nombre lo manda el servidor: lo escribe el administrador,
 * no la persona). Sin conexión o con el servidor caído no cambia nada. Devuelve true si cambió algo.
 */
export async function verificarIdentidad(): Promise<boolean> {
  if (!(await baseProxy())) return false;
  let j: any;
  try { j = await llamarProxy('/yo', {}, 8000); } catch { return false; }
  const a = await cargarAjustes();
  if (rolDe(a) === j.rol && a.rol === j.rol && a.tecnico === j.nombre && !a.supervisor) return false;
  await guardarAjustes({ ...a, rol: j.rol, supervisor: false, tecnico: j.nombre });
  return true;
}

export async function listarUsuarios(): Promise<Usuario[]> {
  return (await llamarProxy('/usuarios', { accion: 'listar' })).usuarios as Usuario[];
}

export async function guardarUsuario(u: { nombre: string; rol: Rol; activo: boolean; claveNueva?: boolean }): Promise<Usuario> {
  return (await llamarProxy('/usuarios', { accion: 'guardar', ...u })).usuario as Usuario;
}

/** Enlace que deja el teléfono de esa persona listo con un toque: lleva su clave, así que se envía en privado. */
export async function enlaceDeAcceso(u: Usuario, opciones: { proyectos?: string[]; terceros?: boolean; precision?: number } = {}): Promise<string> {
  const p = await baseProxy();
  if (!p) throw new Error('La app aún no está configurada con el servidor de tu empresa.');
  const cfg: ConfigFlota = { endpoint: p.base, syncUrl: `${p.base}/sync`, apiKey: u.clave, tecnico: u.nombre };
  if (opciones.proyectos?.length) cfg.proyectos = opciones.proyectos;
  if (opciones.terceros) { cfg.modoTerceros = true; cfg.precisionMaxM = opciones.precision ?? 20; }
  return `${location.origin}${location.pathname}#/config?c=${codificar(cfg)}`;
}

export type Proveedor = 'gemini' | 'claude';
export interface EstadoIA { ok: true; principal: Proveedor; disponibles: Record<Proveedor, boolean>; modeloGemini: string }
export interface ResultadoPrueba { ok: boolean; estado: number; mensaje: string }

export const estadoIA = (): Promise<EstadoIA> => llamarProxy('/ia', { accion: 'estado' });
export const elegirIA = (proveedor: Proveedor): Promise<EstadoIA> => llamarProxy('/ia', { accion: 'guardar', proveedor });
export async function probarIA(): Promise<Record<Proveedor, ResultadoPrueba>> {
  return (await llamarProxy('/ia', { accion: 'probar' }, 40000)).resultados;
}
export const modelosGemini = (): Promise<{ modelos: string[]; actual: string; sugerido: string; mensaje?: string }> => llamarProxy('/ia', { accion: 'modelos' });
export const elegirModeloGemini = (modelo: string): Promise<EstadoIA> => llamarProxy('/ia', { accion: 'modelo', modelo });
