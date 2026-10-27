/**
 * Proxy de IA para flotas (Cloudflare Workers). La API key de Anthropic vive SOLO aquí.
 *
 * - Cada técnico recibe su propio token ("nombre:token" en APP_TOKENS) → se puede revocar uno sin afectar al resto.
 * - Solo deja pasar peticiones con la forma EXACTA de ELI-LUMINARIA: la herramienta registrar_luminaria con su esquema
 *   conocido (no uno arbitrario), tool_choice forzado a esa herramienta, 1–3 imágenes JPEG, poco texto, modelo permitido y
 *   max_tokens acotado. Una clave de técnico filtrada no sirve para usar el modelo como chat libre.
 * - Registra quién llamó (sin guardar imágenes) y admite un limitador opcional de Cloudflare (binding LIMITADOR).
 *
 * Rutas (todas POST; admiten CORS para la web):
 *   /  o /analizar  → análisis de fotos con IA (la API key vive aquí)
 *   /sync           → puerta hacia el script de Google (la web nunca ve el token del script; en los latidos el nombre del
 *                      técnico lo pone el proxy según SU token, no lo declara el cliente)
 *   /equipo         → datos del mapa/panel de supervisión (supervisores y administradores)
 *   /ingresar       → entrar con usuario y clave (sin cabecera): devuelve nombre, rol y proyectos
 *   /yo             → quién soy (nombre y rol según la clave)
 *   /contactos      → personas con teléfono para WhatsApp (el técnico ve a sus supervisores; supervisores y administradores, a todos)
 *   /sistema        → ajustes del sistema (guardar la primera foto en Drive): solo administradores
 *   /ia             → administración de la IA: estado, elegir principal (Gemini/Claude), probar (solo administradores)
 *   /usuarios       → menú de administración: listar/crear/editar personas (solo administradores)
 *
 * Usuarios:  lo normal es la pestaña "_Usuarios" de la hoja de Google (nombre, rol, clave, activo): el administrador crea
 *            técnicos y supervisores ahí, sin tocar secretos. APP_TOKENS / ADMIN_TOKENS siguen funcionando como alternativa.
 *
 * Secretos:  wrangler secret put ANTHROPIC_API_KEY
 *            wrangler secret put APP_TOKENS        # (opcional) "juan:tok1,ana:tok2"
 *            wrangler secret put SYNC_URL          # URL /exec de la Web App de Google Apps Script
 *            wrangler secret put SYNC_TOKEN        # = TOKEN del script
 *            wrangler secret put ADMIN_TOKENS      # "admin:claveAdmin"  (los administradores iniciales; después se crean personas desde la app)
 *            wrangler secret put SYNC_TOKEN_ADMIN  # = TOKEN_ADMIN del script
 * IA:        ANTHROPIC_API_KEY (Claude) y/o GEMINI_API_KEY (Gemini, tiene capa gratuita). ORDEN_IA="gemini,claude" (por defecto): si el
 *            primero falla —sin créditos, límite, caída— se usa el siguiente. El administrador cambia cuál va primero desde la app
 *            (Administración → Inteligencia artificial), y eso manda sobre ORDEN_IA.
 *            GEMINI_MODEL (opcional; por defecto el sistema busca solo un modelo disponible en tu cuenta). Con la capa gratuita Google puede usar las fotos para mejorar sus productos.
 * Opcional:  REINTENTO_MS = 1000  (pausa antes de reintentar Gemini si está saturado)
 *            USUARIOS_CACHE_SEG = 60  (segundos que el proxy recuerda una clave antes de volver a preguntar a la hoja)
 *            MODELOS_PERMITIDOS = "claude-sonnet-5-5,claude-haiku-5-5"
 *            ORIGENES_PERMITIDOS = "https://app.tuempresa.com"  (si no se define, cualquier origen; los tokens siguen protegiendo)
 * Despliegue: npx wrangler deploy server/worker.ts --name eli-luminaria-proxy --compatibility-date 2026-01-01
 *
 * Si cambias la herramienta de la app (src/services/analyzer.ts), actualiza PROPIEDADES: una prueba comprueba que coinciden.
 */
const MAX_BYTES = 12_000_000;
const MAX_TOKENS = 1500;
const MAX_IMAGENES = 3;
const MAX_IMAGEN_B64 = 4_500_000;
const MAX_TEXTO_BLOQUE = 3000;
const MAX_TEXTO_TOTAL = 5000;
const HERRAMIENTA = 'registrar_luminaria';
const PROPIEDADES = [
  'fabricante', 'modelo', 'tecnologia', 'potenciaW', 'tensionV', 'fotocelda', 'pinesFotocelda',
  'temperaturaColorK', 'ip', 'montaje', 'estado', 'observaciones', 'confianza',
];

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

const iguales = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

/** Devuelve el nombre del técnico dueño del token, o null. */
export function identificar(token: string, tokens: string | undefined): string | null {
  if (!token) return null;
  for (const par of (tokens ?? '').split(',').map((t) => t.trim()).filter(Boolean)) {
    const i = par.indexOf(':');
    const nombre = i > 0 ? par.slice(0, i) : 'equipo';
    const secreto = i > 0 ? par.slice(i + 1) : par;
    if (iguales(token, secreto)) return nombre;
  }
  return null;
}

export type Rol = 'tecnico' | 'supervisor' | 'admin';
export type Identidad = { nombre: string; usuario: string; rol: Rol; terceros?: boolean };

/** Identidad que devuelve la hoja (nombre completo + usuario para entrar). Si no hay usuario aparte, es el nombre. */
function deLaHoja(u: any): Identidad | null {
  if (!u || typeof u.nombre !== 'string' || !u.nombre) return null;
  return { nombre: u.nombre, usuario: typeof u.usuario === 'string' && u.usuario ? u.usuario : u.nombre, rol: ROLES.includes(u.rol) ? u.rol : 'tecnico', ...(typeof u.terceros === 'boolean' ? { terceros: u.terceros } : {}) };
}
const ROLES: Rol[] = ['tecnico', 'supervisor', 'admin'];

const cacheUsuarios = new Map<string, { v: Identidad | null; hasta: number }>();
export const vaciarCacheUsuarios = () => cacheUsuarios.clear();

/**
 * Quién es esta clave: primero los secretos (sin red), después la pestaña _Usuarios (con memoria de unos segundos para no
 * llamar al script en cada petición; baja o cambio de rol tardan como mucho ese tiempo en aplicarse).
 * Lanza error si la hoja no responde (no es lo mismo que "clave desconocida").
 */
export async function autenticar(clave: string, env: any, llamar: typeof fetch): Promise<Identidad | null> {
  if (!clave) return null;
  const sup = identificar(clave, env.ADMIN_TOKENS);
  if (sup) return { nombre: sup, usuario: sup, rol: 'admin' };   // los de ADMIN_TOKENS son los administradores iniciales
  const tec = identificar(clave, env.APP_TOKENS);
  if (tec) return { nombre: tec, usuario: tec, rol: 'tecnico' };
  if (!env.SYNC_URL || !env.SYNC_TOKEN) return null;

  const llave = env.SYNC_URL + '\n' + clave;
  const ttl = Math.max(0, Number(env.USUARIOS_CACHE_SEG ?? 60)) * 1000;
  const guardado = cacheUsuarios.get(llave);
  if (guardado && guardado.hasta > Date.now()) return guardado.v;

  const r = await haciaHojas({ accion: 'usuario', clave }, env.SYNC_TOKEN, env, llamar);
  const c: any = await r.json().catch(() => null);
  if (!c?.ok) throw new Error('hoja');
  const u = c.usuario;
  const v: Identidad | null = deLaHoja(u);
  if (ttl > 0) {
    if (cacheUsuarios.size > 500) cacheUsuarios.clear();
    cacheUsuarios.set(llave, { v, hasta: Date.now() + ttl });
  }
  return v;
}

const soloClaves = (o: any, permitidas: string[]) => o && typeof o === 'object' && Object.keys(o).every((k) => permitidas.includes(k));

/** La herramienta debe ser la conocida: mismas propiedades, todas de texto, descripciones cortas. */
function herramientaValida(t: any): boolean {
  if (!soloClaves(t, ['name', 'description', 'input_schema']) || t.name !== HERRAMIENTA) return false;
  if (typeof t.description !== 'string' || t.description.length > 300) return false;
  const s = t.input_schema;
  if (!soloClaves(s, ['type', 'properties', 'required']) || s.type !== 'object' || !s.properties) return false;
  const claves = Object.keys(s.properties);
  if (claves.length !== PROPIEDADES.length || !PROPIEDADES.every((k) => claves.includes(k))) return false;
  for (const k of claves) {
    const p = s.properties[k];
    if (!soloClaves(p, ['type', 'description', 'enum']) || p.type !== 'string') return false;
    if (typeof p.description !== 'string' || p.description.length > 250) return false;
    if (p.enum !== undefined && !(Array.isArray(p.enum) && p.enum.length <= 5 && p.enum.every((x: unknown) => typeof x === 'string' && x.length <= 20))) return false;
  }
  return Array.isArray(s.required) && s.required.length <= PROPIEDADES.length && s.required.every((r: unknown) => typeof r === 'string' && PROPIEDADES.includes(r));
}

export function validarCuerpo(texto: string, modelos: string[]): { ok: true; cuerpo: any } | { ok: false; error: string } {
  let b: any;
  try { b = JSON.parse(texto); } catch { return { ok: false, error: 'JSON inválido' }; }
  if (!modelos.includes(b?.model)) return { ok: false, error: 'Modelo no permitido' };
  if (!(b.max_tokens > 0 && b.max_tokens <= MAX_TOKENS)) return { ok: false, error: 'max_tokens fuera de rango' };
  if (!Array.isArray(b.tools) || b.tools.length !== 1 || !herramientaValida(b.tools[0])) return { ok: false, error: 'Herramienta no permitida' };
  const tc = b.tool_choice;
  if (!soloClaves(tc, ['type', 'name']) || tc.type !== 'tool' || tc.name !== HERRAMIENTA) return { ok: false, error: 'tool_choice no permitido' };
  if (!Array.isArray(b.messages) || b.messages.length !== 1 || b.messages[0]?.role !== 'user' || !Array.isArray(b.messages[0].content)) {
    return { ok: false, error: 'Mensajes no permitidos' };
  }
  const contenido: any[] = b.messages[0].content;
  let imagenes = 0, textoTotal = 0;
  for (const c of contenido) {
    if (c?.type === 'text' && soloClaves(c, ['type', 'text']) && typeof c.text === 'string' && c.text.length <= MAX_TEXTO_BLOQUE) {
      textoTotal += c.text.length;
    } else if (c?.type === 'image' && soloClaves(c, ['type', 'source']) && soloClaves(c.source, ['type', 'media_type', 'data'])
      && c.source.type === 'base64' && c.source.media_type === 'image/jpeg' && typeof c.source.data === 'string' && c.source.data.length <= MAX_IMAGEN_B64) {
      imagenes++;
    } else {
      return { ok: false, error: 'Contenido no permitido' };
    }
  }
  if (textoTotal > MAX_TEXTO_TOTAL) return { ok: false, error: 'Demasiado texto' };
  if (imagenes < 1 || imagenes > MAX_IMAGENES) return { ok: false, error: `Debe incluir de 1 a ${MAX_IMAGENES} imágenes` };
  return { ok: true, cuerpo: { model: b.model, max_tokens: b.max_tokens, tools: b.tools, tool_choice: b.tool_choice, messages: b.messages } };
}

const CABECERAS_PERMITIDAS = 'content-type, x-api-key, anthropic-version';

function cabecerasCors(request: Request, env: any): Record<string, string> {
  const origen = request.headers.get('origin');
  const permitidos = (env.ORIGENES_PERMITIDOS ?? '').split(',').map((o: string) => o.trim()).filter(Boolean);
  const h: Record<string, string> = { vary: 'Origin' };
  if (!permitidos.length) h['access-control-allow-origin'] = '*';
  else if (origen && permitidos.includes(origen)) h['access-control-allow-origin'] = origen;
  else return h; // origen no permitido: el navegador bloqueará la respuesta
  h['access-control-allow-headers'] = CABECERAS_PERMITIDAS;
  h['access-control-allow-methods'] = 'POST, OPTIONS';
  h['access-control-max-age'] = '86400';
  return h;
}

/** Pasa la petición (formato Anthropic, ya validada) al formato de Gemini: mismas fotos, misma herramienta, respuesta forzada. */
export function aGemini(cuerpo: any): any {
  const t = cuerpo.tools[0];
  const props: Record<string, any> = {};
  for (const [k, p] of Object.entries<any>(t.input_schema.properties)) {
    props[k] = { type: 'STRING', description: p.description, ...(p.enum ? { enum: p.enum } : {}) };
  }
  const parts = cuerpo.messages[0].content.map((c: any) =>
    c.type === 'image' ? { inlineData: { mimeType: c.source.media_type, data: c.source.data } } : { text: c.text });
  return {
    contents: [{ role: 'user', parts }],
    tools: [{ functionDeclarations: [{ name: t.name, description: t.description, parameters: { type: 'OBJECT', properties: props, required: t.input_schema.required } }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [t.name] } },
    generationConfig: { temperature: 0.1, maxOutputTokens: cuerpo.max_tokens },
  };
}

/** Respuesta de Gemini → misma forma que la de Anthropic, para que la app no distinga el proveedor. */
export function deGemini(r: any): any | null {
  const partes: any[] = r?.candidates?.[0]?.content?.parts ?? [];
  const llamada = partes.find((p) => p?.functionCall?.args && typeof p.functionCall.args === 'object')?.functionCall;
  return llamada ? { content: [{ type: 'tool_use', name: llamada.name, input: llamada.args }] } : null;
}

type Intento = { ok: true; respuesta: Response } | { ok: false; estado: number; mensaje?: string };

/** Motivo que da el proveedor (p. ej. "API key not valid"), sin claves y recortado, para que el aviso diga qué pasó. */
async function falla(r: Response, env: any): Promise<{ ok: false; estado: number; mensaje?: string }> {
  const j: any = await r.json().catch(() => null);
  const msg = String(j?.error?.message ?? (typeof j?.error === 'string' ? j.error : '') ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
  return { ok: false, estado: r.status, mensaje: msg ? SIN_CLAVES(msg, env) : undefined };
}

async function conClaude(cuerpo: any, env: any, llamar: typeof fetch): Promise<Intento> {
  const r = await llamar('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': env.ANTHROPIC_API_KEY },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) return falla(r, env);
  return { ok: true, respuesta: new Response(r.body, { status: 200, headers: { 'content-type': 'application/json' } }) };
}

const URL_GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const MODELO_GEMINI_RE = /^gemini-[a-z0-9.\-]{1,60}$/;
const MODELO_GEMINI_DEFECTO = 'gemini-2.5-flash';

/** De los modelos que ofrece la cuenta, el más nuevo y estable de la familia "flash" (con visión). */
export function modelosFlash(nombres: string[]): string[] {
  const clave = (n: string) => { const m = n.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(-preview(?:-[\d-]+)?)?$/); return m ? { v: parseFloat(m[1]), lite: !!m[2], prev: !!m[3] } : null; };
  return nombres.filter((n) => clave(n))
    .sort((a, b) => Number(clave(a)!.prev) - Number(clave(b)!.prev) || clave(b)!.v - clave(a)!.v || Number(clave(a)!.lite) - Number(clave(b)!.lite));
}

export function mejorModelo(nombres: string[]): string | undefined {
  const puntuar = (re: RegExp) => nombres
    .map((n) => ({ n, m: n.match(re) }))
    .filter((x) => x.m)
    .sort((a, b) => parseFloat(b.m![1]) - parseFloat(a.m![1]) || (a.m![2] ? 1 : 0) - (b.m![2] ? 1 : 0))[0]?.n;
  return puntuar(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/) ?? puntuar(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?-preview(?:-[\d-]+)?$/);
}

/** Modelos de Gemini que la clave puede usar para generar contenido (sin el prefijo "models/"). */
async function listarModelosGemini(env: any, llamar: typeof fetch): Promise<string[]> {
  const r = await llamar(`${URL_GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
  if (!r.ok) { await r.body?.cancel().catch(() => {}); return []; }
  const j: any = await r.json().catch(() => null);
  return ((j?.models ?? []) as any[])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => String(m.name ?? '').replace(/^models\//, ''))
    .filter((n) => MODELO_GEMINI_RE.test(n) && esModeloUtil(n));
}

/** Fuera los modelos de voz, imagen, audio en vivo, embeddings, etc.: no analizan fotos ni usan herramientas. */
/** Petición mínima pero REAL: una imagen y una herramienta de respuesta forzada, como hace el análisis. */
const PRUEBA_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooA/9k=';
const cuerpoPruebaBase = () => ({
  max_tokens: 64,
  tools: [{ name: 'registrar_luminaria', description: 'Registra lo que se ve.', input_schema: { type: 'object', properties: { fabricante: { type: 'string', description: 'Fabricante' }, confianza: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Confianza' } }, required: ['confianza'] } }],
  messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PRUEBA_JPEG } }, { type: 'text', text: 'Registra lo que ves; si no ves nada, deja el fabricante vacío.' }] }],
});
const cuerpoPrueba = () => aGemini(cuerpoPruebaBase());

const NO_SIRVEN = /(tts|image|imagen|live|audio|embed|aqa|veo|robotics|computer|learnlm|gemma|native|speech|transcri|translate)/;
export const esModeloUtil = (n: string) => !NO_SIRVEN.test(n);

let modeloDetectado: { modelo: string; hasta: number } | null = null;
export const olvidarModeloDetectado = () => { modeloDetectado = null; };

/** Modelo a usar: el que eligió el administrador, luego GEMINI_MODEL, luego el que se detectó, luego el de siempre. */
async function modeloGemini(env: any, llamar: typeof fetch): Promise<{ modelo: string; origen: 'admin' | 'env' | 'detectado' | 'defecto' }> {
  const cfg = await configIA(env, llamar);
  if (cfg.modelo) return { modelo: cfg.modelo, origen: 'admin' };
  if (env.GEMINI_MODEL) return { modelo: env.GEMINI_MODEL, origen: 'env' };
  if (modeloDetectado && modeloDetectado.hasta > Date.now()) return { modelo: modeloDetectado.modelo, origen: 'detectado' };
  return { modelo: MODELO_GEMINI_DEFECTO, origen: 'defecto' };
}

/**
 * Llama a Gemini. Si el modelo no existe para esta cuenta (404) y no lo fijó el administrador, busca entre los modelos
 * disponibles el mejor y reintenta una vez (queda recordado una hora).
 */
async function generarConGemini(cuerpoGemini: any, env: any, llamar: typeof fetch, forzar?: string): Promise<{ r: Response; modelo: string; autoElegido: boolean }> {
  const { modelo, origen } = forzar ? { modelo: forzar, origen: 'admin' as const } : await modeloGemini(env, llamar);
  const enviar = (m: string) => llamar(`${URL_GEMINI}/models/${encodeURIComponent(m)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(cuerpoGemini),
  });
  const descartar = (x: Response) => x.body?.cancel().catch(() => {});
  const pausa = () => new Promise((ok) => setTimeout(ok, Math.max(0, Number(env.REINTENTO_MS ?? 1000))));
  const sobrecarga = (x: Response) => x.status === 503 || x.status === 429;

  let r = await enviar(modelo);
  if (r.status === 503) { await descartar(r); await pausa(); r = await enviar(modelo); }   // saturación momentánea: un reintento
  if (r.ok || origen === 'admin' || (r.status !== 404 && !sobrecarga(r))) return { r, modelo, autoElegido: false };

  // El modelo no existe en la cuenta (404) o está saturado / sin cupo (503, 429): se prueba con otros modelos disponibles.
  const otros = modelosFlash(await listarModelosGemini(env, llamar)).filter((m) => m !== modelo).slice(0, 3);
  for (const m of otros) {
    await descartar(r);
    r = await enviar(m);
    if (r.ok) { modeloDetectado = { modelo: m, hasta: Date.now() + (r.status === 200 ? 3_600_000 : 0) }; return { r, modelo: m, autoElegido: true }; }
    if (!sobrecarga(r) && r.status !== 404) break;
  }
  return { r, modelo, autoElegido: false };
}

async function conGemini(cuerpo: any, env: any, llamar: typeof fetch): Promise<Intento> {
  const { r } = await generarConGemini(aGemini(cuerpo), env, llamar);
  if (!r.ok) return falla(r, env);
  const convertida = deGemini(await r.json().catch(() => null));
  if (!convertida) return { ok: false, estado: 502 };   // bloqueada por seguridad o sin llamada a la herramienta
  return { ok: true, respuesta: new Response(JSON.stringify(convertida), { status: 200, headers: { 'content-type': 'application/json' } }) };
}

export type Proveedor = string;

interface InfoProveedor { id: string; nombre: string; tipo: 'claude' | 'gemini' | 'openai'; base?: string; gratis: boolean; nota: string; donde: string; modeloDefecto?: string }

/**
 * IAs que el sistema sabe usar para analizar fotos. Gemini y Claude tienen conexión propia; el resto habla el mismo "idioma" que ChatGPT
 * (chat/completions con imágenes y herramientas), así que añadir otra es una línea. Hace falta que el modelo ACEPTE IMÁGENES: por eso no
 * están DeepSeek (su API oficial no recibe fotos), Perplexity ni Copilot (no tienen API para esto).
 */
export const PROVEEDORES: InfoProveedor[] = [
  { id: 'gemini', nombre: 'Gemini (Google)', tipo: 'gemini', gratis: true, nota: 'Capa gratuita con límites de uso. Entiende fotos.', donde: 'aistudio.google.com → Get API key' },
  { id: 'claude', nombre: 'Claude (Anthropic)', tipo: 'claude', gratis: false, nota: 'De pago por foto. Muy buena leyendo placas.', donde: 'console.anthropic.com → API keys' },
  { id: 'groq', nombre: 'Groq (Llama con visión)', tipo: 'openai', base: 'https://api.groq.com/openai/v1', gratis: true, nota: 'Capa gratuita con límites. Modelos con visión (p. ej. Qwen 3.6). Si el modelo por defecto deja de existir, elige otro en la lista.', donde: 'console.groq.com → API Keys', modeloDefecto: 'qwen/qwen3.6-27b' },
  { id: 'openrouter', nombre: 'OpenRouter (modelos gratis)', tipo: 'openai', base: 'https://openrouter.ai/api/v1', gratis: true, nota: 'Reúne muchos modelos; los que terminan en ":free" no cuestan (límites bajos).', donde: 'openrouter.ai → Keys' },
  { id: 'mistral', nombre: 'Mistral', tipo: 'openai', base: 'https://api.mistral.ai/v1', gratis: true, nota: 'Plan gratuito de pruebas con límites. Modelos con visión (Pixtral, Mistral Small).', donde: 'console.mistral.ai → API keys', modeloDefecto: 'mistral-small-latest' },
  { id: 'qwen', nombre: 'Qwen (Alibaba)', tipo: 'openai', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', gratis: false, nota: 'Cuota inicial para cuentas nuevas; luego de pago. Modelos Qwen-VL con visión.', donde: 'Alibaba Cloud Model Studio → API-KEY', modeloDefecto: 'qwen-vl-plus' },
  { id: 'kimi', nombre: 'Kimi (Moonshot)', tipo: 'openai', base: 'https://api.moonshot.ai/v1', gratis: false, nota: 'De pago (puede dar crédito inicial). Modelos con visión.', donde: 'platform.moonshot.ai → API Keys', modeloDefecto: 'moonshot-v1-8k-vision-preview' },
  { id: 'openai', nombre: 'ChatGPT (OpenAI)', tipo: 'openai', base: 'https://api.openai.com/v1', gratis: false, nota: 'De pago por uso.', donde: 'platform.openai.com → API keys', modeloDefecto: 'gpt-4o-mini' },
  { id: 'otra', nombre: 'Otra compatible con OpenAI', tipo: 'openai', gratis: false, nota: 'Cualquier servicio con la API de ChatGPT que acepte imágenes (Together, Fireworks, un servidor propio…). Necesita su dirección.', donde: 'La que indique tu proveedor' },
];
export const IDS_IA = PROVEEDORES.map((p) => p.id);
const infoDe = (id: string) => PROVEEDORES.find((p) => p.id === id);
const CLAVE_ENV: Record<string, string> = {
  gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY', groq: 'GROQ_API_KEY', openrouter: 'OPENROUTER_API_KEY', mistral: 'MISTRAL_API_KEY',
  qwen: 'QWEN_API_KEY', kimi: 'KIMI_API_KEY', openai: 'OPENAI_API_KEY', otra: 'OTRA_API_KEY',
};
export const claveDe = (env: any, id: string): string => String(env?.[CLAVE_ENV[id]] ?? '');
/** ¿Se puede usar? Hay clave y, para "otra", también su dirección. */
export const tieneClave = (env: any, id: string) => !!claveDe(env, id) && (id !== 'otra' || !!env.OTRA_BASE_URL);
const baseDe = (env: any, id: string) => (id === 'otra' ? String(env.OTRA_BASE_URL ?? '') : infoDe(id)?.base ?? '').replace(/\/+$/, '');
const ORDEN_DEFECTO = ['gemini', 'claude', 'groq', 'openrouter', 'mistral', 'qwen', 'kimi', 'openai', 'otra'];

/**
 * Proveedores con clave, en orden. `principal` (lo que eligió el administrador) va primero y los demás quedan de respaldo en el orden
 * por defecto (Gemini, Claude, Groq…); sin elección manda ORDEN_IA o ese orden por defecto.
 */
export function proveedores(env: any, principal?: Proveedor): Proveedor[] {
  let orden: string[];
  if (principal && IDS_IA.includes(principal)) orden = [principal, ...ORDEN_DEFECTO.filter((x) => x !== principal)];
  else if (env.ORDEN_IA) orden = String(env.ORDEN_IA).split(',').map((x) => x.trim().toLowerCase()).filter((x) => IDS_IA.includes(x));
  else orden = ORDEN_DEFECTO;
  return orden.filter((id) => tieneClave(env, id));
}

/* ---------- IAs compatibles con la API de ChatGPT (Groq, OpenRouter, Mistral, Qwen, Kimi, OpenAI, otra) ---------- */

/** Petición (formato Anthropic ya validado) → chat/completions con imágenes y herramienta de respuesta forzada. */
export function aOpenAI(cuerpo: any, modelo: string): any {
  const t = cuerpo.tools[0];
  const content = cuerpo.messages[0].content.map((c: any) =>
    c.type === 'image' ? { type: 'image_url', image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } } : { type: 'text', text: c.text });
  return {
    model: modelo, max_tokens: cuerpo.max_tokens, temperature: 0.1,
    messages: [{ role: 'user', content }],
    tools: [{ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }],
    tool_choice: { type: 'function', function: { name: t.name } },
  };
}

/** Respuesta de chat/completions → misma forma que la de Anthropic. Acepta también el JSON escrito en el texto si el modelo no usa herramientas. */
export function deOpenAI(r: any): any | null {
  const msg = r?.choices?.[0]?.message;
  const llamada = msg?.tool_calls?.[0]?.function;
  let args: any = null;
  if (llamada?.arguments) { try { args = typeof llamada.arguments === 'string' ? JSON.parse(llamada.arguments) : llamada.arguments; } catch { args = null; } }
  else if (typeof msg?.content === 'string') { const m = msg.content.match(/\{[\s\S]*\}/); if (m) { try { args = JSON.parse(m[0]); } catch { args = null; } } }
  return args && typeof args === 'object' && !Array.isArray(args) ? { content: [{ type: 'tool_use', name: llamada?.name ?? 'registrar_luminaria', input: args }] } : null;
}

const NO_CHAT = /(embed|whisper|tts|orpheus|playai|guard|safeguard|moderat|rerank|dall|transcri|speech|audio|image-gen|stable-diffusion|flux|compound|allam)/i;
const PARECE_VISION = /(vision|-vl\b|vl-|\bvl\b|pixtral|llava|scout|qwen3\.[5-9]|maverick|4o|gpt-4\.1|gpt-5|gemini|gemma-?3|mistral-(small|medium|large)|claude)/i;

export interface ModeloListado { id: string; vision?: boolean }

/** Ordena lo que ofrece un proveedor: primero lo que dice aceptar imágenes, luego lo que "parece" de visión; sin voz ni embeddings. Los ":free" van antes. */
export function ordenarModelosVision(lista: ModeloListado[]): ModeloListado[] {
  const util = lista.filter((m) => m.id && !NO_CHAT.test(m.id));
  const puntos = (m: ModeloListado) => (m.vision === true ? 4 : 0) + (PARECE_VISION.test(m.id) ? 2 : 0) + (/:free$/.test(m.id) ? 1 : 0);
  return util.slice().sort((a, b) => puntos(b) - puntos(a) || a.id.localeCompare(b.id));
}

/** Solo los que ACEPTAN imágenes según el proveedor o lo parecen por su nombre. Nunca se adivina: sin evidencia, no se prueba. */
export function candidatosVision(lista: ModeloListado[]): ModeloListado[] {
  return ordenarModelosVision(lista).filter((m) => m.vision === true || (m.vision !== false && PARECE_VISION.test(m.id)));
}

async function listarModelosOpenAI(id: string, env: any, llamar: typeof fetch): Promise<ModeloListado[]> {
  const r = await llamar(`${baseDe(env, id)}/models`, { headers: { authorization: `Bearer ${claveDe(env, id)}` } });
  if (!r.ok) { await r.body?.cancel().catch(() => {}); return []; }
  const j: any = await r.json().catch(() => null);
  const datos: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  return datos.map((m) => {
    const vision = m?.architecture?.input_modalities?.includes?.('image') ?? m?.capabilities?.vision ?? undefined;   // OpenRouter y Mistral lo informan
    return { id: String(m?.id ?? ''), ...(typeof vision === 'boolean' ? { vision } : {}) };
  }).filter((m) => m.id);
}

const detectadoOpenAI = new Map<string, { modelo: string; hasta: number }>();
export const olvidarModelosDetectados = () => { detectadoOpenAI.clear(); olvidarModeloDetectado(); };

async function modeloOpenAI(id: string, env: any, llamar: typeof fetch): Promise<{ modelo: string; origen: 'admin' | 'env' | 'detectado' | 'defecto' | 'ninguno' }> {
  const cfg = await configIA(env, llamar);
  if (cfg.modelos?.[id]) return { modelo: cfg.modelos[id], origen: 'admin' };
  const deEnv = env[`MODELO_${id.toUpperCase()}`];
  if (deEnv) return { modelo: String(deEnv), origen: 'env' };
  const d = detectadoOpenAI.get(id);
  if (d && d.hasta > Date.now()) return { modelo: d.modelo, origen: 'detectado' };
  const def = infoDe(id)?.modeloDefecto;
  return def ? { modelo: def, origen: 'defecto' } : { modelo: '', origen: 'ninguno' };
}

/**
 * Llama a la IA compatible con ChatGPT. Si el modelo no existe en la cuenta y no lo fijó el administrador, busca entre los que ofrece
 * el proveedor el que parece de visión y reintenta (queda recordado una hora). `forzar` = probar justo ese modelo, sin buscar otro.
 */
async function generarConOpenAI(id: string, cuerpoAnthropic: any, env: any, llamar: typeof fetch, forzar?: string): Promise<{ r: Response; modelo: string; autoElegido: boolean }> {
  const { modelo, origen } = forzar ? { modelo: forzar, origen: 'admin' as const } : await modeloOpenAI(id, env, llamar);
  const enviar = (m: string) => llamar(`${baseDe(env, id)}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${claveDe(env, id)}` }, body: JSON.stringify(aOpenAI(cuerpoAnthropic, m)),
  });
  const sinModelo = (m: string) => new Response(JSON.stringify({ error: { message: `No se encontró un modelo con visión en ${infoDe(id)?.nombre}${m ? ` (${m} no existe)` : ''}. Elige uno en la lista.` } }), { status: 404 });
  const buscar = async (excluir: string) => candidatosVision(await listarModelosOpenAI(id, env, llamar)).map((m) => m.id).filter((m) => m !== excluir).slice(0, 2);

  let r: Response;
  if (!modelo) {
    const candidatos = await buscar('');
    if (!candidatos.length) return { r: sinModelo(''), modelo: '', autoElegido: false };
    r = await enviar(candidatos[0]);
    if (r.ok) detectadoOpenAI.set(id, { modelo: candidatos[0], hasta: Date.now() + 3_600_000 });
    return { r, modelo: candidatos[0], autoElegido: true };
  }
  r = await enviar(modelo);
  if (r.status === 503) { await r.body?.cancel().catch(() => {}); await new Promise((ok) => setTimeout(ok, Math.max(0, Number(env.REINTENTO_MS ?? 1000)))); r = await enviar(modelo); }
  if (r.ok || origen === 'admin' || (r.status !== 404 && r.status !== 400)) return { r, modelo, autoElegido: false };
  const texto = await r.clone().text().catch(() => '');
  if (!/model|modelo/i.test(texto)) return { r, modelo, autoElegido: false };   // un 400 por otra causa (imagen inválida…) no se arregla cambiando de modelo
  const original = r.clone();
  const candidatos = await buscar(modelo);
  if (!candidatos.length) return { r: original, modelo, autoElegido: false };   // sin evidencia de visión no se prueba nada: se muestra el error real del modelo por defecto
  for (const m of candidatos) {
    void r.body?.cancel().catch(() => {});   // sin await: si hay un clon sin leer, cancelar esperaría a que también se cierre
    r = await enviar(m);
    if (r.ok) { detectadoOpenAI.set(id, { modelo: m, hasta: Date.now() + 3_600_000 }); return { r, modelo: m, autoElegido: true }; }
  }
  return { r, modelo, autoElegido: false };
}

async function conOpenAI(id: string, cuerpo: any, env: any, llamar: typeof fetch): Promise<Intento> {
  const { r } = await generarConOpenAI(id, cuerpo, env, llamar);
  if (!r.ok) return falla(r, env);
  const conv = deOpenAI(await r.json().catch(() => null));
  if (!conv) return { ok: false, estado: 502, mensaje: 'El modelo respondió sin datos estructurados (¿acepta imágenes?).' };
  return { ok: true, respuesta: new Response(JSON.stringify(conv), { status: 200, headers: { 'content-type': 'application/json' } }) };
}

/* ---------- claves que el administrador pega desde la app (se guardan en el script de Google) ---------- */

const cacheClaves = new Map<string, { v: Record<string, string>; hasta: number }>();
export const olvidarClavesGuardadas = () => cacheClaves.clear();

async function clavesGuardadas(env: any, llamar: typeof fetch): Promise<Record<string, string>> {
  if (!env.SYNC_URL || !env.SYNC_TOKEN_ADMIN) return {};
  const ttl = Math.max(0, Number(env.USUARIOS_CACHE_SEG ?? 60)) * 1000;
  const g = cacheClaves.get(env.SYNC_URL);
  if (g && g.hasta > Date.now()) return g.v;
  try {
    const c: any = await (await haciaHojas({ accion: 'ia_claves' }, env.SYNC_TOKEN_ADMIN, env, llamar)).json();
    const v: Record<string, string> = c?.ok && c.claves && typeof c.claves === 'object' ? c.claves : {};
    if (ttl > 0) cacheClaves.set(env.SYNC_URL, { v, hasta: Date.now() + ttl });
    return v;
  } catch { return {}; }
}

/** env + las claves pegadas desde la app (los secretos de Cloudflare mandan) + la dirección de "otra". */
async function conClaves(env: any, llamar: typeof fetch): Promise<any> {
  const guardadas = await clavesGuardadas(env, llamar);
  const e = { ...env };
  for (const id of IDS_IA) if (!e[CLAVE_ENV[id]] && guardadas[id]) e[CLAVE_ENV[id]] = guardadas[id];
  if (!e.OTRA_BASE_URL) { const b = (await configIA(env, llamar)).baseOtra; if (b) e.OTRA_BASE_URL = b; }
  return e;
}

async function analizar(request: Request, entorno: any, llamar: typeof fetch, tecnico: string): Promise<Response> {
  const env = await conClaves(entorno, llamar);
  const texto = await request.text();
  if (texto.length > MAX_BYTES) return json(413, { error: 'Payload too large' });
  const modelos = (env.MODELOS_PERMITIDOS ?? 'claude-sonnet-5-5,claude-haiku-5-5,claude-opus-5-5').split(',').map((m: string) => m.trim());
  const v = validarCuerpo(texto, modelos);
  if (!v.ok) return json(400, { error: v.error });

  const lista = proveedores(env, await iaPrincipal(env, llamar));
  if (!lista.length) return json(503, { error: 'La IA no está configurada en el servidor (el administrador debe agregar una clave en Administración → Inteligencia artificial).' });

  let ultimo = 502;
  const detalle: string[] = [];
  for (const p of lista.slice(0, 4)) {   // la principal y hasta 3 de respaldo (cada intento fallido cuesta tiempo)
    let intento: Intento;
    const tipo = infoDe(p)?.tipo;
    try { intento = tipo === 'claude' ? await conClaude(v.cuerpo, env, llamar) : tipo === 'gemini' ? await conGemini(v.cuerpo, env, llamar) : await conOpenAI(p, v.cuerpo, env, llamar); }
    catch { intento = { ok: false, estado: 502 }; }
    console.log(JSON.stringify({ tecnico, proveedor: p, estado: intento.ok ? 200 : intento.estado }));
    if (intento.ok) {
      const h = new Headers(intento.respuesta.headers); h.set('x-ia-proveedor', p);
      return new Response(intento.respuesta.body, { status: 200, headers: h });
    }
    ultimo = intento.estado;   // sin créditos, límite, caída o error: se prueba el siguiente
    detalle.push(`${p} ${intento.estado}${intento.mensaje ? ': ' + intento.mensaje : ''}`);
  }
  return json(ultimo === 429 ? 429 : ultimo === 401 || ultimo === 403 ? 502 : ultimo, { error: `El servicio de IA no respondió (${detalle.join('; ')}).` });
}

interface ConfigIA { ia?: Proveedor; modelo?: string; modelos?: Record<string, string>; baseOtra?: string; fotos?: boolean }
const cacheIA = new Map<string, { v: ConfigIA; hasta: number }>();
export const vaciarCacheIA = () => cacheIA.clear();

/** Ajustes que eligió el administrador (pestaña _Config: IA principal y modelo de Gemini), con memoria corta. Sin hoja → vacío. */
async function configIA(env: any, llamar: typeof fetch): Promise<ConfigIA> {
  if (!env.SYNC_URL || !env.SYNC_TOKEN) return {};
  const ttl = Math.max(0, Number(env.USUARIOS_CACHE_SEG ?? 60)) * 1000;
  const g = cacheIA.get(env.SYNC_URL);
  if (g && g.hasta > Date.now()) return g.v;
  try {
    const r = await haciaHojas({ accion: 'config' }, env.SYNC_TOKEN, env, llamar);
    const c: any = await r.json();
    const k = c?.ok ? c.config ?? {} : {};
    const v = {
      ia: typeof k.ia === 'string' && IDS_IA.includes(k.ia) ? (k.ia as Proveedor) : undefined,
      modelos: Object.fromEntries(IDS_IA.filter((id) => id !== 'gemini' && /^[A-Za-z0-9._:/-]{1,100}$/.test(String(k[`modelo_${id}`] ?? ''))).map((id) => [id, String(k[`modelo_${id}`])])),
      baseOtra: typeof k.base_otra === 'string' && /^https:\/\//.test(k.base_otra) ? k.base_otra : undefined,
      fotos: k.fotos === 'no' ? false : k.fotos === 'si' ? true : undefined,
      modelo: typeof k.gemini_modelo === 'string' && MODELO_GEMINI_RE.test(k.gemini_modelo) && esModeloUtil(k.gemini_modelo) ? (k.gemini_modelo as string) : undefined,   // un modelo de voz/imagen ya guardado se ignora
    };
    if (ttl > 0) cacheIA.set(env.SYNC_URL, { v, hasta: Date.now() + ttl });
    return v;
  } catch { return {}; }
}
/** ¿Se guarda la primera foto de cada luminaria en Drive? Lo decide el administrador (por defecto, sí). */
const guardarFotos = async (env: any, llamar: typeof fetch) => (await configIA(env, llamar)).fotos !== false;
const iaPrincipal = async (env: any, llamar: typeof fetch) => (await configIA(env, llamar)).ia;

const SIN_CLAVES = (txt: string, env: any) => IDS_IA.map((id) => claveDe(env, id)).filter((k) => k.length >= 4).reduce((t: string, k: string) => t.split(k).join('***'), txt);

/** Llamada mínima y REAL (una imagen y una herramienta) a un proveedor: dice si funciona y, si no, por qué (sin claves). */
async function probarProveedor(p: Proveedor, env: any, llamar: typeof fetch, forzar?: string): Promise<{ ok: boolean; estado: number; mensaje: string }> {
  const tipo = infoDe(p)?.tipo;
  try {
    let usado = '', auto = false;
    let r: Response;
    if (tipo === 'claude') {
      r = await llamar('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': claveDe(env, 'claude') },
        body: JSON.stringify({ model: String(env.MODELOS_PERMITIDOS ?? 'claude-haiku-5-5').split(',')[0].trim(), max_tokens: 8, messages: [{ role: 'user', content: 'Responde solo: ok' }] }),
      });
    } else if (tipo === 'gemini') {
      const g = await generarConGemini(cuerpoPrueba(), env, llamar, forzar);
      usado = g.modelo; auto = g.autoElegido; r = g.r;
      if (r.ok && !deGemini(await r.clone().json().catch(() => null))) {
        return { ok: false, estado: 200, mensaje: `El modelo ${usado} respondió, pero no sabe analizar imágenes con herramientas (no sirve para esto). Elige otro modelo o "Automático".` };
      }
    } else {
      const g = await generarConOpenAI(p, cuerpoPruebaBase(), env, llamar, forzar);
      usado = g.modelo; auto = g.autoElegido; r = g.r;
      if (r.ok && !deOpenAI(await r.clone().json().catch(() => null))) {
        return { ok: false, estado: 200, mensaje: `El modelo ${usado} respondió, pero no devolvió datos estructurados a partir de una imagen (¿acepta imágenes?). Elige otro modelo.` };
      }
    }
    if (r.ok) { await r.body?.cancel().catch(() => {}); return { ok: true, estado: r.status, mensaje: usado ? `Funciona con el modelo ${usado}${auto ? ' (elegido automáticamente porque el anterior no existe para tu cuenta)' : ''}.` : 'Funciona.' }; }
    const j: any = await r.json().catch(() => null);
    const msg = String(j?.error?.message ?? (typeof j?.error === 'string' ? j.error : '') ?? j?.message ?? '').slice(0, 220);
    return { ok: false, estado: r.status, mensaje: SIN_CLAVES(msg, env) || `Respondió ${r.status}.` };
  } catch { return { ok: false, estado: 0, mensaje: 'No se pudo conectar con el proveedor.' }; }
}

/** Menú de administración → Inteligencia artificial: proveedores, claves, modelos, cuál va primero y pruebas. Solo administradores. */
async function administrarIA(request: Request, entorno: any, llamar: typeof fetch): Promise<Response> {
  const texto = await request.text();
  if (texto.length > 2000) return json(413, { ok: false, error: 'Payload too large' });
  let c: any;
  try { c = JSON.parse(texto); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  const guardadasAntes = await clavesGuardadas(entorno, llamar);
  const env = await conClaves(entorno, llamar);
  const disponibles: Record<string, boolean> = Object.fromEntries(IDS_IA.map((id) => [id, tieneClave(env, id)]));
  const idValido = (x: unknown): x is string => typeof x === 'string' && IDS_IA.includes(x);

  // El estado se calcula SIEMPRE de nuevo (claves, dirección y modelos pueden haber cambiado justo antes).
  const estado = async () => {
    const guardadas = await clavesGuardadas(entorno, llamar);
    const e = await conClaves(entorno, llamar);
    const cfg = await configIA(e, llamar);
    const dispo: Record<string, boolean> = Object.fromEntries(IDS_IA.map((id) => [id, tieneClave(e, id)]));
    const modeloActual = async (id: string) => (id === 'gemini' ? (await modeloGemini(e, llamar)).modelo : id === 'claude' ? '' : (await modeloOpenAI(id, e, llamar)).modelo);
    const lista = [];
    for (const p of PROVEEDORES) {
      lista.push({
        id: p.id, nombre: p.nombre, gratis: p.gratis, nota: p.nota, donde: p.donde, configurado: dispo[p.id],
        origenClave: claveDe(entorno, p.id) ? 'servidor' : guardadas[p.id] ? 'app' : null,
        modelo: dispo[p.id] ? await modeloActual(p.id) : '', ...(p.id === 'otra' ? { base: e.OTRA_BASE_URL ?? '' } : {}),
      });
    }
    return { ok: true, principal: cfg.ia ?? proveedores(e)[0] ?? 'gemini', disponibles: dispo, modeloGemini: (await modeloGemini(e, llamar)).modelo, proveedores: lista };
  };
  const guardarConfig = async (clave: string, valor: string) => {
    const r = await haciaHojas({ accion: 'config_guardar', clave, valor }, env.SYNC_TOKEN_ADMIN, env, llamar);
    cacheIA.clear(); olvidarModelosDetectados();
    const j: any = await r.clone().json().catch(() => null);
    return j?.ok ? null : r;
  };

  if (c?.accion === 'estado') { cacheIA.clear(); cacheClaves.clear(); return json(200, await estado()); }

  if (c?.accion === 'guardar') {
    if (!idValido(c.proveedor)) return json(400, { ok: false, error: 'Proveedor inválido' });
    const fallo = await guardarConfig('ia', c.proveedor);
    return fallo ?? json(200, await estado());
  }

  if (c?.accion === 'clave') {   // pegar (o quitar) la clave de un proveedor desde la app
    if (!idValido(c.proveedor)) return json(400, { ok: false, error: 'Proveedor inválido' });
    if (c.clave === '' || c.clave === null) {
      if (claveDe(entorno, c.proveedor)) return json(400, { ok: false, error: 'Esa clave está fijada en el servidor (Cloudflare); desde la app solo se pueden quitar las que se pegaron aquí.' });
      await haciaHojas({ accion: 'ia_clave_guardar', proveedor: c.proveedor, clave: '' }, env.SYNC_TOKEN_ADMIN, env, llamar);
      cacheClaves.clear(); cacheIA.clear();
      return json(200, await estado());
    }
    if (typeof c.clave !== 'string' || !/^\S{8,400}$/.test(c.clave.trim())) return json(400, { ok: false, error: 'La clave debe tener entre 8 y 400 caracteres, sin espacios.' });
    const clave = c.clave.trim();
    const e2 = { ...env, [CLAVE_ENV[c.proveedor]]: clave };
    if (c.proveedor === 'otra' && !e2.OTRA_BASE_URL) return json(400, { ok: false, error: 'Primero escribe la dirección del servicio.' });
    const prueba = await probarProveedor(c.proveedor, e2, llamar);
    if (prueba.estado === 401 || prueba.estado === 403) return json(400, { ok: false, error: `El proveedor rechazó la clave (${prueba.estado}). ${prueba.mensaje}`.slice(0, 300) });
    const r = await haciaHojas({ accion: 'ia_clave_guardar', proveedor: c.proveedor, clave }, env.SYNC_TOKEN_ADMIN, env, llamar);
    const j: any = await r.clone().json().catch(() => null);
    if (!j?.ok) return r;
    cacheClaves.clear(); cacheIA.clear();
    return json(200, { ...(await estado()), prueba });
  }

  if (c?.accion === 'base') {   // dirección de la IA "otra compatible con OpenAI"
    const b = typeof c.base === 'string' ? c.base.trim().replace(/\/+$/, '') : '';
    if (b && !/^https:\/\/[A-Za-z0-9._:/-]{4,200}$/.test(b)) return json(400, { ok: false, error: 'La dirección debe empezar por https:// (por ejemplo https://api.together.xyz/v1).' });
    const fallo = await guardarConfig('base_otra', b || 'auto');
    return fallo ?? json(200, await estado());
  }

  if (c?.accion === 'modelos') {
    const id = c.proveedor === undefined ? 'gemini' : c.proveedor;
    if (!idValido(id)) return json(400, { ok: false, error: 'Proveedor inválido' });
    if (!disponibles[id]) return json(200, { ok: true, proveedor: id, modelos: [], actual: '', mensaje: `Sin clave de ${infoDe(id)!.nombre}.` });
    if (id === 'claude') return json(200, { ok: true, proveedor: id, modelos: [], actual: '', mensaje: 'El modelo de Claude lo define la app (Ajustes → Modelo).' });
    if (id === 'gemini') {
      const todos = await listarModelosGemini(env, llamar);
      const orden = [...todos].sort((a, b) => Number(/flash/.test(b)) - Number(/flash/.test(a)) || b.localeCompare(a));
      return json(200, { ok: true, proveedor: id, modelos: orden.slice(0, 30), actual: (await modeloGemini(env, llamar)).modelo, sugerido: mejorModelo(todos) ?? '' });
    }
    const todos = await listarModelosOpenAI(id, env, llamar);
    const orden = ordenarModelosVision(todos);
    return json(200, { ok: true, proveedor: id, modelos: orden.slice(0, 60).map((m) => m.id), actual: (await modeloOpenAI(id, env, llamar)).modelo, sugerido: candidatosVision(todos)[0]?.id ?? '' });
  }

  if (c?.accion === 'modelo') {
    const id = c.proveedor === undefined ? 'gemini' : c.proveedor;
    if (!idValido(id) || id === 'claude') return json(400, { ok: false, error: 'Proveedor inválido' });
    const m = c.modelo === 'auto' ? 'auto' : c.modelo;
    const formato = id === 'gemini' ? MODELO_GEMINI_RE : /^[A-Za-z0-9._:/-]{1,100}$/;
    if (typeof m !== 'string' || (m !== 'auto' && !formato.test(m))) return json(400, { ok: false, error: 'Modelo inválido' });
    if (m !== 'auto' && disponibles[id]) {   // no se guarda un modelo que no sirve (voz, solo texto, inexistente…); 429/503 son momentáneos y sí se guarda
      const g = id === 'gemini' ? await generarConGemini(cuerpoPrueba(), env, llamar, m) : await generarConOpenAI(id, cuerpoPruebaBase(), env, llamar, m);
      const cuerpo = await g.r.clone().json().catch(() => null);
      const sinHerramienta = g.r.ok && !(id === 'gemini' ? deGemini(cuerpo) : deOpenAI(cuerpo));
      if (g.r.status === 400 || g.r.status === 404 || sinHerramienta) return json(400, { ok: false, error: `El modelo ${m} no sirve para analizar fotos (${g.r.ok ? 'no usa herramientas o no acepta imágenes' : 'error ' + g.r.status}). Elige otro de la lista.` });
      await g.r.body?.cancel().catch(() => {});
    }
    const fallo = await guardarConfig(id === 'gemini' ? 'gemini_modelo' : `modelo_${id}`, m);
    return fallo ?? json(200, await estado());
  }

  if (c?.accion === 'probar') {
    const res: Record<string, any> = {};
    const ids = idValido(c.proveedor) ? [c.proveedor] : IDS_IA;
    for (const id of ids) res[id] = disponibles[id] ? await probarProveedor(id, env, llamar) : { ok: false, estado: 0, mensaje: 'Sin clave configurada en el servidor.' };
    return json(200, { ok: true, resultados: res });
  }
  return json(400, { ok: false, error: 'Acción no permitida' });
}

/** Ajustes del sistema que decide el administrador (por ahora: guardar la primera foto en Drive). */
async function administrarSistema(request: Request, env: any, llamar: typeof fetch): Promise<Response> {
  const texto = await request.text();
  if (texto.length > 1000) return json(413, { ok: false, error: 'Payload too large' });
  let c: any;
  try { c = JSON.parse(texto); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  if (c?.accion === 'estado') { cacheIA.clear(); return json(200, { ok: true, fotos: await guardarFotos(env, llamar) }); }
  if (c?.accion === 'guardar' && typeof c.fotos === 'boolean') {
    const r = await haciaHojas({ accion: 'config_guardar', clave: 'fotos', valor: c.fotos ? 'si' : 'no' }, env.SYNC_TOKEN_ADMIN, env, llamar);
    cacheIA.clear();
    const j: any = await r.clone().json().catch(() => null);
    return j?.ok ? json(200, { ok: true, fotos: c.fotos }) : r;
  }
  return json(400, { ok: false, error: 'Acción no permitida' });
}

const ACCIONES_SYNC = [undefined, 'listar', 'latido'];

/** Reenvía al script de Google poniendo AQUÍ el token del script (el navegador nunca lo conoce). */
async function haciaHojas(cuerpo: any, token: string, env: any, llamar: typeof fetch): Promise<Response> {
  if (!env.SYNC_URL || !token) return json(500, { ok: false, error: 'El proxy no tiene configurado el destino de sincronización (SYNC_URL / SYNC_TOKEN).' });
  let r: Response;
  try {
    r = await llamar(env.SYNC_URL, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...cuerpo, token }), redirect: 'follow' });
  } catch { return json(502, { ok: false, error: 'No se pudo contactar con el servidor de hojas.' }); }
  const texto = await r.text();
  try { JSON.parse(texto); } catch { return json(502, { ok: false, error: 'El servidor de hojas devolvió una respuesta inválida.' }); }
  return new Response(texto, { status: 200, headers: { 'content-type': 'application/json' } });
}

async function sincronizar(request: Request, env: any, llamar: typeof fetch, quien: Identidad): Promise<Response> {
  const texto = await request.text();
  if (texto.length > MAX_BYTES) return json(413, { ok: false, error: 'Payload too large' });
  let c: any;
  try { c = JSON.parse(texto); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return json(400, { ok: false, error: 'Cuerpo inválido' });
  if (!ACCIONES_SYNC.includes(c.accion)) return json(400, { ok: false, error: 'Acción no permitida' });
  delete c.token;                                  // el cliente no puede imponer el token del script
  delete c.por;                                    // ni declarar quién es: el autor lo sella el servidor
  if (c.accion === 'latido') c.tecnico = quien.nombre;   // la presencia se atribuye al dueño de la clave, no a lo que diga el cliente
  if (c.accion === undefined) {
    c.por = { usuario: quien.usuario, nombre: quien.nombre };
    if (Array.isArray(c.luminarias) && !(await guardarFotos(env, llamar))) for (const l of c.luminarias) if (l && typeof l === 'object') delete l.foto;   // el administrador desactivó guardar fotos
  }
  return haciaHojas(c, env.SYNC_TOKEN, env, llamar);
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Intentos fallidos de ingreso por conexión+usuario (en memoria): frena adivinar claves probando. */
const intentos = new Map<string, { n: number; hasta: number }>();
export const olvidarIntentos = () => intentos.clear();
const MAX_INTENTOS = 8, VENTANA_MS = 10 * 60 * 1000;

/** Usuario y clave → identidad. Primero los secretos (nombre:clave) y luego la pestaña _Usuarios. */
async function verificarIngreso(usuario: string, clave: string, env: any, llamar: typeof fetch): Promise<Identidad | null> {
  if (!usuario || !clave) return null;
  for (const [lista, rol] of [[env.ADMIN_TOKENS, 'admin'], [env.APP_TOKENS, 'tecnico']] as const) {
    const nombre = identificar(clave, lista);
    if (nombre && norm(nombre) === norm(usuario)) return { nombre, usuario: nombre, rol };
  }
  if (!env.SYNC_URL || !env.SYNC_TOKEN) return null;
  const r = await haciaHojas({ accion: 'ingresar', usuario, clave }, env.SYNC_TOKEN, env, llamar);
  const c: any = await r.json().catch(() => null);
  if (!c?.ok) throw new Error('hoja');
  const u = c.usuario;
  return deLaHoja(u);
}

/** Nombres de los proyectos que ya existen en la hoja (para que cada persona los vea al entrar). Si la hoja no responde, vacío. */
async function proyectosDeLaHoja(env: any, llamar: typeof fetch): Promise<string[]> {
  if (!env.SYNC_URL || !env.SYNC_TOKEN) return [];
  try {
    const c: any = await (await haciaHojas({ accion: 'proyectos' }, env.SYNC_TOKEN, env, llamar)).json();
    return c?.ok && Array.isArray(c.proyectos) ? c.proyectos.filter((x: unknown) => typeof x === 'string').slice(0, 100) : [];
  } catch { return []; }
}

/** POST /ingresar { usuario, clave } → { ok, nombre, rol, terceros?, proyectos }. No requiere cabecera: es la puerta de entrada. */
async function ingresar(request: Request, env: any, llamar: typeof fetch): Promise<Response> {
  const texto = await request.text();
  if (texto.length > 1000) return json(413, { ok: false, error: 'Payload too large' });
  let c: any;
  try { c = JSON.parse(texto); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  if (typeof c?.usuario !== 'string' || typeof c?.clave !== 'string' || !c.usuario.trim() || !c.clave || c.usuario.length > 80 || c.clave.length > 100) {
    return json(400, { ok: false, error: 'Escribe tu usuario y tu clave.' });
  }
  const ip = request.headers.get('cf-connecting-ip') ?? 'sin-ip';
  const llave = `${ip}|${norm(c.usuario)}`, ahora = Date.now();
  const previo = intentos.get(llave);
  if (previo && previo.hasta > ahora && previo.n >= MAX_INTENTOS) return json(429, { ok: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });

  let quien: Identidad | null;
  try { quien = await verificarIngreso(c.usuario.trim(), c.clave.trim(), env, llamar); }
  catch { return json(502, { ok: false, error: 'No se pudo verificar el usuario (la hoja de Google no respondió). Inténtalo de nuevo.' }); }
  if (!quien) {
    if (intentos.size > 2000) intentos.clear();
    intentos.set(llave, { n: (previo && previo.hasta > ahora ? previo.n : 0) + 1, hasta: ahora + VENTANA_MS });
    return json(401, { ok: false, error: 'Usuario o clave incorrectos.' });
  }
  intentos.delete(llave);
  return json(200, { ok: true, nombre: quien.nombre, usuario: quien.usuario, rol: quien.rol, ...(quien.terceros !== undefined ? { terceros: quien.terceros } : {}), fotos: await guardarFotos(env, llamar), proyectos: await proyectosDeLaHoja(env, llamar) });
}

/** Menú de administración: listar y crear/editar personas. El token del administrador del script se pone AQUÍ. */
async function administrarUsuarios(request: Request, env: any, llamar: typeof fetch, quien: Identidad): Promise<Response> {
  const texto = await request.text();
  if (texto.length > 2000) return json(413, { ok: false, error: 'Payload too large' });
  let c: any;
  try { c = JSON.parse(texto); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return json(400, { ok: false, error: 'Cuerpo inválido' });
  if (c.accion === 'listar') {
    const r = await haciaHojas({ accion: 'usuarios_listar' }, env.SYNC_TOKEN_ADMIN, env, llamar);
    const j: any = await r.clone().json().catch(() => null);
    if (!j?.ok) return r;
    // Los administradores de Cloudflare (ADMIN_TOKENS) son "superusuarios": se muestran (solo el nombre, nunca la clave) y no se editan desde la app.
    const superusuarios = String(env.ADMIN_TOKENS ?? '').split(',').map((t: string) => t.trim()).filter(Boolean).map((t: string) => (t.indexOf(':') > 0 ? t.slice(0, t.indexOf(':')) : 'equipo'));
    return json(200, { ...j, superusuarios });
  }
  if (c.accion === 'borrar') {
    if (typeof c.usuario !== 'string' || !c.usuario.trim() || c.usuario.length > 40) return json(400, { ok: false, error: 'Usuario inválido' });
    const r = await haciaHojas({ accion: 'usuarios_borrar', usuario: c.usuario.trim(), por: quien.usuario }, env.SYNC_TOKEN_ADMIN, env, llamar);
    vaciarCacheUsuarios();   // la persona deja de poder usar la app de inmediato (en este servidor)
    return r;
  }
  if (c.accion === 'guardar') {
    if (typeof c.nombre !== 'string' || !c.nombre.trim() || c.nombre.length > 60) return json(400, { ok: false, error: 'Nombre inválido' });
    if (!ROLES.includes(c.rol)) return json(400, { ok: false, error: 'Rol inválido' });
    if (c.clave !== undefined && c.clave !== '' && (typeof c.clave !== 'string' || !/^\S{8,64}$/.test(c.clave))) return json(400, { ok: false, error: 'La clave debe tener entre 8 y 64 caracteres, sin espacios.' });
    if (c.usuario !== undefined && (typeof c.usuario !== 'string' || c.usuario.trim().length < 2 || c.usuario.length > 40 || /^[=+\-@_]/.test(c.usuario.trim()))) return json(400, { ok: false, error: 'Usuario inválido' });
    if (c.telefono !== undefined && (typeof c.telefono !== 'string' || !/^[0-9 +()\-]{0,25}$/.test(c.telefono))) return json(400, { ok: false, error: 'Teléfono inválido (solo números, espacios, + - y paréntesis).' });
    const r = await haciaHojas({ accion: 'usuarios_guardar', nombre: c.nombre, ...(typeof c.telefono === 'string' ? { telefono: c.telefono.trim() } : {}), ...(typeof c.usuario === 'string' ? { usuario: c.usuario.trim() } : {}), rol: c.rol, activo: c.activo !== false, claveNueva: c.claveNueva === true, terceros: c.terceros === true, ...(c.clave ? { clave: c.clave } : {}), por: quien.usuario }, env.SYNC_TOKEN_ADMIN, env, llamar);
    vaciarCacheUsuarios();   // los cambios se notan al instante en este servidor (en otros, tras USUARIOS_CACHE_SEG)
    return r;
  }
  return json(400, { ok: false, error: 'Acción no permitida' });
}

async function enrutar(request: Request, env: any, llamar: typeof fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const ruta = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const clave = request.headers.get('x-api-key') ?? '';

  if (!['/', '/analizar', '/sync', '/equipo', '/yo', '/usuarios', '/ia', '/ingresar', '/sistema', '/contactos'].includes(ruta)) return json(404, { error: 'Not found' });

  if (ruta === '/ingresar') return ingresar(request, env, llamar);

  let quien: Identidad | null;
  try { quien = await autenticar(clave, env, llamar); }
  catch { return json(502, { error: 'No se pudo verificar el usuario (la hoja de Google no respondió).' }); }
  if (!quien) return json(401, { error: 'Unauthorized' });

  if (ruta === '/yo') return json(200, { ok: true, nombre: quien.nombre, usuario: quien.usuario, rol: quien.rol, ...(quien.terceros !== undefined ? { terceros: quien.terceros } : {}), fotos: await guardarFotos(env, llamar), proyectos: await proyectosDeLaHoja(env, llamar) });
  if (ruta === '/equipo') {
    if (quien.rol === 'tecnico') return json(401, { error: 'Unauthorized' });
    return haciaHojas({ accion: 'equipo' }, env.SYNC_TOKEN_ADMIN, env, llamar);
  }
  if (ruta === '/contactos') {
    // Un técnico solo ve a quienes lo supervisan; supervisores y administradores ven a todos. Nunca claves.
    const r = await haciaHojas({ accion: 'contactos' }, env.SYNC_TOKEN, env, llamar);
    const j: any = await r.json().catch(() => null);
    if (!j?.ok) return json(502, { ok: false, error: 'No se pudieron leer los contactos.' });
    const mios = (j.contactos as any[]).filter((u) => norm(u.usuario) !== norm(quien.usuario) && (quien.rol !== 'tecnico' || u.rol !== 'tecnico'));
    return json(200, { ok: true, contactos: mios.map((u) => ({ nombre: u.nombre, usuario: u.usuario, rol: u.rol, telefono: u.telefono })) });
  }
  if (ruta === '/sistema') {
    if (quien.rol !== 'admin') return json(401, { error: 'Unauthorized' });
    return administrarSistema(request, env, llamar);
  }
  if (ruta === '/ia') {
    if (quien.rol !== 'admin') return json(401, { error: 'Unauthorized' });
    return administrarIA(request, env, llamar);
  }
  if (ruta === '/usuarios') {
    if (quien.rol !== 'admin') return json(401, { error: 'Unauthorized' });
    return administrarUsuarios(request, env, llamar, quien);
  }
  if (env.LIMITADOR && !(await env.LIMITADOR.limit({ key: quien.nombre })).success) return json(429, { error: 'Demasiadas solicitudes' });

  return ruta === '/sync' ? sincronizar(request, env, llamar, quien) : analizar(request, env, llamar, quien.nombre);
}

export async function manejar(request: Request, env: any, llamar: typeof fetch = fetch): Promise<Response> {
  const cors = cabecerasCors(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const r = await enrutar(request, env, llamar);
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
}

export default { fetch: (request: Request, env: any) => manejar(request, env) };
