import { rolDe, type Rol } from '@compartido/core/ajustes';
import { codificar, type ConfigFlota } from '@compartido/lib/config';
import { ajustesPorDefecto, cargarAjustes, guardarAjustes } from './ajustes';
import { asegurarProyectos } from './configuracion';

export interface Usuario { nombre: string; rol: Rol; clave: string; activo: boolean; terceros?: boolean }

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
  const terceros = typeof j.terceros === 'boolean' ? j.terceros : a.modoTerceros;   // lo decide el administrador (si el servidor lo informa)
  const creados = Array.isArray(j.proyectos) ? await asegurarProyectos(j.proyectos) : 0;
  if (rolDe(a) === j.rol && a.rol === j.rol && a.tecnico === j.nombre && !a.supervisor && a.modoTerceros === terceros) return creados > 0;
  await guardarAjustes({ ...a, rol: j.rol, supervisor: false, tecnico: j.nombre, modoTerceros: terceros });
  return true;
}

/** Dirección del servidor de la empresa: la que trae la web publicada (servidor.json); si falta, se pide a mano al entrar. */
export async function servidorPorDefecto(): Promise<string> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}servidor.json`, { cache: 'no-cache' });
    const j = await r.json();
    return typeof j?.proxy === 'string' && /^https:\/\//i.test(j.proxy) ? j.proxy.replace(/\/+$/, '') : '';
  } catch { return ''; }
}

export class ErrorIngreso extends Error {}

/** Entrar con usuario y clave: el servidor confirma quién es y la app queda lista (servidor, cuenta, rol y proyectos). */
export async function ingresar(servidor: string, usuario: string, clave: string): Promise<{ nombre: string; rol: Rol }> {
  const base = servidor.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/i.test(base)) throw new ErrorIngreso('La dirección del servidor debe empezar por https://');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  let r: Response;
  try { r = await fetch(`${base}/ingresar`, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ usuario: usuario.trim(), clave: clave.trim() }), signal: ctl.signal }); }
  catch { throw new ErrorIngreso('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); }
  finally { clearTimeout(t); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new ErrorIngreso(j?.error ?? `El servidor respondió ${r.status}.`);
  const a = await cargarAjustes();
  await guardarAjustes({
    ...a, endpoint: base, syncUrl: `${base}/sync`, apiKey: clave.trim(), tecnico: j.nombre, rol: j.rol, supervisor: false,
    modoTerceros: typeof j.terceros === 'boolean' ? j.terceros : a.modoTerceros,
  });
  if (Array.isArray(j.proyectos)) await asegurarProyectos(j.proyectos);
  return { nombre: j.nombre, rol: j.rol };
}

/** Sale de la cuenta: borra la clave y el rol de este dispositivo. Los registros guardados se conservan. */
export async function cerrarSesion(): Promise<void> {
  const a = await cargarAjustes();
  const base = ajustesPorDefecto();
  await guardarAjustes({ ...a, apiKey: '', rol: undefined, supervisor: false, tecnico: '', endpoint: base.endpoint, syncUrl: '', modoTerceros: false });
}

export async function listarUsuarios(): Promise<Usuario[]> {
  return (await llamarProxy('/usuarios', { accion: 'listar' })).usuarios as Usuario[];
}

export async function guardarUsuario(u: { nombre: string; rol: Rol; activo: boolean; claveNueva?: boolean; clave?: string; terceros?: boolean }): Promise<Usuario> {
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
