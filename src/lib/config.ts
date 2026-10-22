/**
 * Código de configuración para flotas: un texto/enlace que deja un teléfono listo (endpoint de IA, token,
 * destino de sincronización, nombre del técnico, proyectos) sin que el técnico toque nada.
 * Formato: "ELI1." + JSON (sólo ASCII) en base64 url-safe. Enlace: eliluminaria://config?c=<código>
 */
export interface ConfigFlota {
  organizacion?: string;
  endpoint?: string;
  apiKey?: string;
  modelo?: string;
  syncUrl?: string;
  syncToken?: string;
  syncFotos?: boolean;
  tecnico?: string;
  proyectos?: string[];
  /** Capturas solo con jornada activa, solo cámara, GPS preciso y coordenadas no editables. */
  modoTerceros?: boolean;
  /** Precisión GPS máxima exigida (5–100 m) en modo terceros. */
  precisionMaxM?: number;
}

export const PREFIJO = 'ELI1.';
export const ESQUEMA = 'eliluminaria://config';
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function aB64(ascii: string): string {
  let out = '';
  for (let i = 0; i < ascii.length; i += 3) {
    const n = (ascii.charCodeAt(i) << 16) | ((ascii.charCodeAt(i + 1) || 0) << 8) | (ascii.charCodeAt(i + 2) || 0);
    out += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63];
    if (i + 1 < ascii.length) out += ABC[(n >> 6) & 63];
    if (i + 2 < ascii.length) out += ABC[n & 63];
  }
  return out;
}

function deB64(b64: string): string {
  let bits = 0, acc = 0, out = '';
  for (const ch of b64) {
    const v = ABC.indexOf(ch);
    if (v < 0) throw new Error('Código de configuración inválido.');
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 255); }
  }
  return out;
}

const soloAscii = (json: string) => json.replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export const codificar = (cfg: ConfigFlota): string => PREFIJO + aB64(soloAscii(JSON.stringify(cfg)));
export const aEnlace = (cfg: ConfigFlota): string => `${ESQUEMA}?c=${codificar(cfg)}`;

const https = (u: unknown) => typeof u === 'string' && /^https:\/\/[^\s/]+/i.test(u) && u.length <= 2000;
const txt = (v: unknown, max = 500) => (typeof v === 'string' && v.length <= max ? v.trim() : undefined);

/** Acepta el código solo o el enlace completo; valida y descarta campos desconocidos. */
export function decodificar(entrada: string): ConfigFlota {
  let t = entrada.trim();
  const m = t.match(/[?&]c=([^&\s]+)/);
  if (m) t = m[1];
  if (!t.startsWith(PREFIJO)) throw new Error('No parece un código de configuración de ELI-LUMINARIA.');
  let bruto: any;
  try { bruto = JSON.parse(deB64(t.slice(PREFIJO.length))); } catch { throw new Error('El código está dañado o incompleto.'); }
  if (!bruto || typeof bruto !== 'object') throw new Error('El código está dañado o incompleto.');

  const cfg: ConfigFlota = {};
  if (bruto.endpoint !== undefined) { if (!https(bruto.endpoint)) throw new Error('El endpoint debe empezar por https://'); cfg.endpoint = bruto.endpoint.trim(); }
  if (bruto.syncUrl !== undefined) { if (!https(bruto.syncUrl)) throw new Error('La URL de sincronización debe empezar por https://'); cfg.syncUrl = bruto.syncUrl.trim(); }
  const o = txt(bruto.organizacion, 80); if (o) cfg.organizacion = o;
  const k = txt(bruto.apiKey, 300); if (k) cfg.apiKey = k;
  const mo = txt(bruto.modelo, 80); if (mo) cfg.modelo = mo;
  const st = txt(bruto.syncToken, 300); if (st) cfg.syncToken = st;
  const tc = txt(bruto.tecnico, 80); if (tc) cfg.tecnico = tc;
  if (typeof bruto.syncFotos === 'boolean') cfg.syncFotos = bruto.syncFotos;
  if (typeof bruto.modoTerceros === 'boolean') cfg.modoTerceros = bruto.modoTerceros;
  if (bruto.precisionMaxM !== undefined) {
    if (typeof bruto.precisionMaxM !== 'number' || bruto.precisionMaxM < 5 || bruto.precisionMaxM > 100) throw new Error('La precisión GPS máxima debe estar entre 5 y 100 m.');
    cfg.precisionMaxM = Math.round(bruto.precisionMaxM);
  }
  if (Array.isArray(bruto.proyectos)) {
    cfg.proyectos = bruto.proyectos.map((p: unknown) => txt(p, 80)).filter((p: string | undefined): p is string => !!p).slice(0, 50);
  }
  return cfg;
}

const host = (u?: string) => u?.match(/^https:\/\/([^/?#]+)/i)?.[1] ?? '';

/** Texto para que el técnico confirme QUÉ servidores se van a configurar (evita enlaces maliciosos). */
export function describir(cfg: ConfigFlota): string {
  return [
    cfg.organizacion && `Organización: ${cfg.organizacion}`,
    cfg.tecnico && `Técnico: ${cfg.tecnico}`,
    cfg.endpoint && `Análisis con IA → ${host(cfg.endpoint)}`,
    cfg.syncUrl && `Sincronización → ${host(cfg.syncUrl)}`,
    cfg.proyectos?.length && `Proyectos: ${cfg.proyectos.join(', ')}`,
    cfg.modoTerceros && `Modo terceros: solo podrás capturar con la jornada activa, con la cámara de la app y con GPS de ±${cfg.precisionMaxM ?? 20} m o mejor. Cada captura se registra con su hora, ubicación y jornada.`,
  ].filter(Boolean).join('\n');
}
