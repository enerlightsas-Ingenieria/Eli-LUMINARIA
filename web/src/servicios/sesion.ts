/**
 * Sesión de la web. La clave de acceso NO se guarda en el dispositivo: vive solo en la memoria de la página y se pierde al cerrarla,
 * por eso al abrir la app siempre se pide ingresar. Para poder entrar SIN internet (trabajo en campo) se guarda un verificador:
 * un resumen irreversible (PBKDF2) de usuario + clave, que solo sirve para comprobar lo que la persona escribe.
 */
const CLAVE = 'eli.sesion.v1';
const ITERACIONES = 150_000;

interface Verificador { usuario: string; sal: string; hash: string }

export const normalizar = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Minutos sin tocar la app antes de pedir la clave de nuevo. */
export const INACTIVIDAD_MINUTOS = 15;

let claveEnMemoria = '';
export const claveDeSesion = () => claveEnMemoria;
export const fijarClaveDeSesion = (clave: string) => { claveEnMemoria = String(clave ?? '').trim(); };

let aviso = '';
/** Mensaje para la pantalla de ingreso (p. ej. "tu acceso fue desactivado"): se muestra una vez. */
export const dejarAviso = (texto: string) => { aviso = texto; };
export const tomarAviso = () => { const a = aviso; aviso = ''; return a; };

const aB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const deB64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

async function resumen(usuario: string, clave: string, sal: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${normalizar(usuario)}\u0000${clave}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: ITERACIONES }, material, 256);
  return aB64(new Uint8Array(bits));
}

function leer(): Verificador | null {
  try { const v = JSON.parse(localStorage.getItem(CLAVE) ?? 'null'); return v && typeof v.usuario === 'string' && v.sal && v.hash ? v : null; } catch { return null; }
}

export const usuarioGuardado = () => leer()?.usuario ?? '';
export const hayVerificador = () => !!leer();
export function olvidarVerificador() { try { localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ } }

export async function guardarVerificador(usuario: string, clave: string): Promise<void> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const v: Verificador = { usuario: usuario.trim(), sal: aB64(sal), hash: await resumen(usuario, clave.trim(), sal) };
  try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch { /* sin almacenamiento: no habrá ingreso sin conexión */ }
}

/** ¿Coinciden usuario y clave con los de la última vez que se ingresó con internet en este dispositivo? */
export async function verificarLocal(usuario: string, clave: string): Promise<boolean> {
  const v = leer();
  if (!v || normalizar(v.usuario) !== normalizar(usuario)) return false;
  return (await resumen(usuario, clave.trim(), deB64(v.sal))) === v.hash;
}
