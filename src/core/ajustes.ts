/** Ajustes de la app (tipos y valores por defecto). Sin dependencias de plataforma: los comparten móvil y web. */
export type Rol = 'tecnico' | 'supervisor' | 'admin';
export type PreferenciaTema = 'auto' | 'claro' | 'oscuro';

export interface Ajustes {
  apiKey: string;
  /** URL opcional de un proxy propio (recomendado en producción para no exponer la clave en el teléfono). */
  endpoint: string;
  modelo: string;
  /** URL de la Web App de Google Apps Script (o cualquier servidor compatible). */
  syncUrl: string;
  syncToken: string;
  syncFotos: boolean;
  /** Envía solo, en segundo plano, cuando hay conexión. */
  autoSync: boolean;
  /** Nombre del técnico; se registra en cada luminaria. */
  tecnico: string;
  /** Solo web: usuario con el que se ingresa (distinto del nombre). */
  usuario?: string;
  tema: PreferenciaTema;
  /** Modo terceros: capturas solo con jornada activa, solo cámara, GPS preciso y coordenadas no editables. */
  modoTerceros: boolean;
  /** Precisión GPS máxima (m) exigida en modo terceros. */
  precisionMaxM: number;
  /** Solo web: rol de la cuenta según el servidor (se refresca al abrir con conexión). */
  rol?: Rol;
  /** @deprecated Enlaces antiguos de supervisor; usa `rol`. */
  supervisor?: boolean;
  /** Solo web: permite apagar el análisis con IA (cada análisis consume crédito de la API). Por defecto activado. */
  iaActiva?: boolean;
}

/** Rol efectivo (los ajustes antiguos solo traían `supervisor`). */
export const rolDe = (a: Pick<Ajustes, 'rol' | 'supervisor'>): Rol => a.rol ?? (a.supervisor ? 'supervisor' : 'tecnico');
export const veEquipo = (r: Rol) => r === 'supervisor' || r === 'admin';

export const MODELO_POR_DEFECTO = 'claude-sonnet-5-5';
export const ENDPOINT_POR_DEFECTO = 'https://api.anthropic.com/v1/messages';
