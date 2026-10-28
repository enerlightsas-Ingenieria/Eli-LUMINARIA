import { rolDe, type Rol } from '@compartido/core/ajustes';
import { codificar, type ConfigFlota } from '@compartido/lib/config';
import { cargarAjustes, guardarAjustes } from './ajustes';
import { dejarAviso, fijarClaveDeSesion, guardarVerificador, olvidarVerificador, verificarLocal } from './sesion';
import { conciliarProyectos, conciliarProyectosInfo, ProyectoRemoto } from './almacen';
import { listarProyectos } from './almacen';
import { asegurarProyectos } from './configuracion';

export interface Usuario { nombre: string; usuario: string; rol: Rol; clave: string; activo: boolean; terceros?: boolean; telefono?: string; proyectos?: string[]; tecnicos?: string[] }
export interface Contacto { nombre: string; usuario: string; rol: Rol; telefono: string }

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
    let r: Response;
    try { r = await fetch(`${p.base}${ruta}`, { method: 'POST', headers: { 'x-api-key': p.clave, 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo), signal: ctl.signal }); }
    catch (e: any) {
      if (e?.name === 'AbortError' || ctl.signal.aborted) throw Object.assign(new Error('El servidor tardó demasiado en responder (la hoja de Google puede estar lenta u ocupada). Si era un cambio, puede haberse aplicado: espera un momento, mira si cambió y, si no, inténtalo de nuevo.'), { estado: 0, tiempoAgotado: true });
      throw Object.assign(new Error('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'), { estado: 0 });
    }
    const j = await r.json().catch(() => null);
    if (r.status === 401) throw Object.assign(new Error('Esta cuenta no tiene permiso para esto.'), { estado: 401 });
    if (!r.ok || !j?.ok) throw Object.assign(new Error(j?.error ?? `El servidor respondió ${r.status}.`), { estado: r.status });
    return j;
  } finally { clearTimeout(t); }
}

/**
 * Pregunta al servidor quién es esta clave y guarda su rol, nombre, usuario, modo contratista y política de fotos (los decide el
 * administrador, no la persona). Sin conexión o con el servidor caído no cambia nada. Si el servidor dice que la clave ya no vale
 * (baja o clave cambiada), se cierra la sesión. Devuelve true si cambió algo.
 */
export async function verificarIdentidad(): Promise<boolean> {
  if (!(await baseProxy())) return false;
  let j: any;
  try { j = await llamarProxy('/yo', {}, 8000); }
  catch (e: any) {
    if (e?.estado === 401) {   // dado de baja o clave cambiada
      await cerrarSesion(); olvidarVerificador();
      dejarAviso('Tu acceso ya no está activo o tu clave cambió. Pide ayuda a tu administrador.');
      return true;
    }
    return false;
  }
  const a = await cargarAjustes();
  const terceros = typeof j.terceros === 'boolean' ? j.terceros : a.modoTerceros;   // lo decide el administrador (si el servidor lo informa)
  const fotos = typeof j.fotos === 'boolean' ? j.fotos : a.syncFotos;
  const usuario = typeof j.usuario === 'string' && j.usuario ? j.usuario : a.usuario;
  // Quita primero lo que el administrador eliminó y luego crea lo que falte (si el servidor no informó la lista, no se toca nada)
  const creados = await alinearProyectos(j);
  if (rolDe(a) === j.rol && a.rol === j.rol && a.tecnico === j.nombre && !a.supervisor && a.modoTerceros === terceros && a.syncFotos === fotos && a.usuario === usuario) return creados > 0;
  await guardarAjustes({ ...a, rol: j.rol, supervisor: false, tecnico: j.nombre, usuario, modoTerceros: terceros, syncFotos: fotos });
  if (usuario && usuario !== a.usuario) await guardarVerificador(usuario, a.apiKey).catch(() => {});   // el usuario correcto para entrar sin conexión
  return true;
}

/** Dirección y barrio del punto (los propone el servidor a partir de OpenStreetMap). null si no hay conexión o el mapa no responde. */
export async function direccionDelPunto(latitud: number, longitud: number): Promise<{ direccion: string; barrio: string } | null> {
  try {
    const j = await llamarProxy('/direccion', { latitud, longitud }, 12000);
    return { direccion: String(j.direccion ?? ''), barrio: String(j.barrio ?? '') };
  } catch { return null; }
}

/** Proyectos de este dispositivo = los del servidor (con ids, nombres, cliente, notas y estado). Con un servidor antiguo solo hay nombres. Devuelve cuántos cambios hubo. */
async function alinearProyectos(j: any): Promise<number> {
  if (Array.isArray(j.proyectosInfo)) return conciliarProyectosInfo(j.proyectosInfo as ProyectoRemoto[]).catch(() => 0);
  if (!Array.isArray(j.proyectos)) return 0;
  const quitados = await conciliarProyectos(j.proyectos).catch(() => 0);
  return quitados + (await asegurarProyectos(j.proyectos));
}

/* Proyectos compartidos: solo el administrador los cambia (el servidor lo comprueba). Necesitan conexión: si no, el cambio se perdería o el proyecto reaparecería. */
export type RefProyecto = { id?: string; nombre: string };

/** Crea un proyecto en la hoja (la única forma de que exista uno nuevo) y lo trae a este dispositivo. Devuelve su id local. */
export async function crearProyectoDelEquipo(p: { nombre: string; cliente: string; notas: string }): Promise<number | null> {
  const j = await llamarProxy('/sistema', { accion: 'crear_proyecto', nombre: p.nombre, cliente: p.cliente, notas: p.notas }, 60000);
  if (Array.isArray(j.proyectos)) await conciliarProyectosInfo(j.proyectos);
  const creado = (await listarProyectos()).find((x) => x.nombre.trim().toLowerCase() === p.nombre.trim().toLowerCase());
  return creado?.id ?? null;
}

export async function guardarProyectoDelEquipo(p: RefProyecto & { nuevoNombre: string; cliente: string; notas: string }): Promise<void> {
  const j = await llamarProxy('/sistema', { accion: 'guardar_proyecto', id: p.id, nombreAnterior: p.nombre, nombre: p.nuevoNombre, cliente: p.cliente, notas: p.notas }, 60000);
  if (Array.isArray(j.proyectos)) await conciliarProyectosInfo(j.proyectos);
}

export async function activarProyectoDelEquipo(p: RefProyecto, activo: boolean): Promise<void> {
  const j = await llamarProxy('/sistema', { accion: 'activar_proyecto', id: p.id, nombre: p.nombre, activo }, 60000);
  if (Array.isArray(j.proyectos)) await conciliarProyectosInfo(j.proyectos);
}

/** Elimina el proyecto para TODO el equipo: pestaña, filas y fotos de la hoja. */
export async function eliminarProyectoDelEquipo(p: RefProyecto): Promise<void> {
  await llamarProxy('/sistema', { accion: 'eliminar_proyecto', id: p.id, nombre: p.nombre }, 120000);
}

/** Dirección del servidor de la empresa: la que trae la web publicada (servidor.json); si falta, se pide a mano al entrar. */
export async function servidorPorDefecto(): Promise<string> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}servidor.json`, { cache: 'no-cache' });
    const j = await r.json();
    return typeof j?.proxy === 'string' && /^https:\/\//i.test(j.proxy) ? j.proxy.replace(/\/+$/, '') : '';
  } catch { return ''; }
}

export class ErrorIngreso extends Error {
  /** No se pudo hablar con el servidor (sin internet o servidor caído): no es lo mismo que "clave incorrecta". */
  constructor(mensaje: string, public sinRed = false) { super(mensaje); }
}

/** Entrar con usuario y clave: el servidor confirma quién es y la app queda lista (servidor, cuenta, rol y proyectos). */
export async function ingresar(servidor: string, usuario: string, clave: string): Promise<{ nombre: string; rol: Rol }> {
  const base = servidor.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/i.test(base)) throw new ErrorIngreso('La dirección del servidor debe empezar por https://');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ErrorIngreso('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.', true);   // sin red: no se espera a que falle
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  let r: Response;
  try { r = await fetch(`${base}/ingresar`, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ usuario: usuario.trim(), clave: clave.trim() }), signal: ctl.signal }); }
  catch { throw new ErrorIngreso('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.', true); }
  finally { clearTimeout(t); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new ErrorIngreso(j?.error ?? `El servidor respondió ${r.status}.`, r.status >= 500);
  const a = await cargarAjustes();
  const login = typeof j.usuario === 'string' && j.usuario ? j.usuario : usuario.trim();
  await guardarAjustes({
    ...a, endpoint: base, syncUrl: `${base}/sync`, apiKey: clave.trim(), tecnico: j.nombre, usuario: login, rol: j.rol, supervisor: false,
    modoTerceros: typeof j.terceros === 'boolean' ? j.terceros : a.modoTerceros,
    syncFotos: typeof j.fotos === 'boolean' ? j.fotos : a.syncFotos,
  });
  await guardarVerificador(login, clave);
  await alinearProyectos(j);
  return { nombre: j.nombre, rol: j.rol };
}

/**
 * Volver a entrar en un dispositivo que ya tuvo una cuenta. Con internet lo decide el servidor (así se notan las bajas y los cambios
 * de rol); sin internet se comprueba contra el verificador guardado la última vez, para poder trabajar en campo.
 */
export async function reingresar(usuario: string, clave: string): Promise<{ sinConexion: boolean }> {
  const a = await cargarAjustes();
  const base = /^https:\/\//i.test(a.endpoint) && !a.endpoint.includes(ANTHROPIC) ? a.endpoint.replace(/\/+$/, '') : await servidorPorDefecto();
  try { await ingresar(base, usuario, clave); return { sinConexion: false }; }
  catch (e) {
    if (!(e instanceof ErrorIngreso) || !e.sinRed) throw e;
    if (await verificarLocal(usuario, clave)) { fijarClaveDeSesion(clave); return { sinConexion: true }; }
    throw new ErrorIngreso('Sin conexión no se pudo comprobar. Revisa el usuario y la clave (la primera vez en un teléfono necesitas internet).');
  }
}

/** Salir: la clave se olvida (queda solo el usuario para facilitar el próximo ingreso). Los registros guardados se conservan. */
export async function cerrarSesion(): Promise<void> {
  fijarClaveDeSesion('');
}

/** Dejar este dispositivo sin cuenta (otra persona va a usarlo). Los registros guardados NO se borran. */
export async function cambiarDeUsuario(): Promise<void> {
  fijarClaveDeSesion(''); olvidarVerificador();
  const a = await cargarAjustes();
  await guardarAjustes({ ...a, apiKey: '', rol: undefined, supervisor: false, tecnico: '', usuario: '', modoTerceros: false, syncFotos: false });
}

export async function listarUsuarios(): Promise<{ usuarios: Usuario[]; superusuarios: string[] }> {
  const j = await llamarProxy('/usuarios', { accion: 'listar' });
  return { usuarios: j.usuarios as Usuario[], superusuarios: Array.isArray(j.superusuarios) ? j.superusuarios : [] };
}

/** Personas con teléfono a las que esta cuenta puede escribir (técnico: sus supervisores; supervisor y administrador: todos). */
export async function listarContactos(): Promise<Contacto[]> { return (await llamarProxy('/contactos', {})).contactos as Contacto[]; }

export async function eliminarUsuario(usuario: string): Promise<void> { await llamarProxy('/usuarios', { accion: 'borrar', usuario }); }

/** ¿Se guarda la primera foto de cada luminaria en Drive? (lo decide el administrador). */
export const estadoSistema = (): Promise<{ fotos: boolean }> => llamarProxy('/sistema', { accion: 'estado' });
export const guardarFotosEnDrive = (fotos: boolean): Promise<{ fotos: boolean }> => llamarProxy('/sistema', { accion: 'guardar', fotos });

export async function guardarUsuario(u: { nombre: string; usuario?: string; telefono?: string; rol: Rol; activo: boolean; claveNueva?: boolean; clave?: string; terceros?: boolean; proyectos?: string[]; tecnicos?: string[] }): Promise<Usuario> {
  return (await llamarProxy('/usuarios', { accion: 'guardar', ...u })).usuario as Usuario;
}

/** Enlace que deja el teléfono de esa persona listo con un toque: lleva su clave, así que se envía en privado. */
export async function enlaceDeAcceso(u: Usuario, opciones: { proyectos?: string[]; terceros?: boolean; precision?: number } = {}): Promise<string> {
  const p = await baseProxy();
  if (!p) throw new Error('La app aún no está configurada con el servidor de tu empresa.');
  const cfg: ConfigFlota = { endpoint: p.base, syncUrl: `${p.base}/sync`, apiKey: u.clave, tecnico: u.nombre, usuario: u.usuario };
  if (opciones.proyectos?.length) cfg.proyectos = opciones.proyectos;
  if (opciones.terceros) { cfg.modoTerceros = true; cfg.precisionMaxM = opciones.precision ?? 20; }
  return `${location.origin}${location.pathname}#/config?c=${codificar(cfg)}`;
}

export type Proveedor = string;
export interface InfoIA { id: Proveedor; nombre: string; gratis: boolean; nota: string; donde: string; configurado: boolean; origenClave: 'servidor' | 'app' | null; modelo: string; base?: string }
export interface EstadoIA { ok: true; principal: Proveedor; disponibles: Record<Proveedor, boolean>; modeloGemini: string; proveedores: InfoIA[]; prueba?: ResultadoPrueba }
export interface ResultadoPrueba { ok: boolean; estado: number; mensaje: string }
export interface ModelosIA { modelos: string[]; actual: string; sugerido?: string; mensaje?: string }

export const estadoIA = (): Promise<EstadoIA> => llamarProxy('/ia', { accion: 'estado' });
export const elegirIA = (proveedor: Proveedor): Promise<EstadoIA> => llamarProxy('/ia', { accion: 'guardar', proveedor });
/** Prueba real (imagen + herramienta). Sin proveedor, prueba todos los que tienen clave. */
export async function probarIA(proveedor?: Proveedor): Promise<Record<Proveedor, ResultadoPrueba>> {
  return (await llamarProxy('/ia', { accion: 'probar', ...(proveedor ? { proveedor } : {}) }, 60000)).resultados;
}
export const modelosIA = (proveedor: Proveedor): Promise<ModelosIA> => llamarProxy('/ia', { accion: 'modelos', proveedor }, 30000);
export const elegirModeloIA = (proveedor: Proveedor, modelo: string): Promise<EstadoIA> => llamarProxy('/ia', { accion: 'modelo', proveedor, modelo }, 40000);
/** Pega (o, con '', quita) la clave de un proveedor. El servidor la prueba antes de guardarla y nunca la devuelve. */
export const guardarClaveIA = (proveedor: Proveedor, clave: string): Promise<EstadoIA> => llamarProxy('/ia', { accion: 'clave', proveedor, clave }, 40000);
export const guardarBaseIA = (base: string): Promise<EstadoIA> => llamarProxy('/ia', { accion: 'base', base });
