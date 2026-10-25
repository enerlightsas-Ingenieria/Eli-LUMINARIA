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
const cuerpoPrueba = () => aGemini({
  max_tokens: 64,
  tools: [{ name: 'registrar_luminaria', description: 'Registra lo que se ve.', input_schema: { type: 'object', properties: { fabricante: { type: 'string', description: 'Fabricante' }, confianza: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Confianza' } }, required: ['confianza'] } }],
  messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PRUEBA_JPEG } }, { type: 'text', text: 'Registra lo que ves; si no ves nada, deja el fabricante vacío.' }] }],
});

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

export type Proveedor = 'claude' | 'gemini';
const otro = (p: Proveedor): Proveedor => (p === 'claude' ? 'gemini' : 'claude');

/**
 * Proveedores de IA con clave configurada, en orden. `principal` (lo que el administrador eligió en la app) va primero y el otro
 * queda de respaldo; sin elección se usa ORDEN_IA (por defecto Gemini primero y Claude de respaldo).
 */
export function proveedores(env: any, principal?: Proveedor): Proveedor[] {
  const orden = principal
    ? [principal, otro(principal)]
    : String(env.ORDEN_IA ?? 'gemini,claude').split(',').map((x) => x.trim().toLowerCase());
  return (['claude', 'gemini'] as const)
    .filter((p) => orden.includes(p) && !!(p === 'claude' ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY))
    .sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
}

async function analizar(request: Request, env: any, llamar: typeof fetch, tecnico: string): Promise<Response> {
  const texto = await request.text();
  if (texto.length > MAX_BYTES) return json(413, { error: 'Payload too large' });
  const modelos = (env.MODELOS_PERMITIDOS ?? 'claude-sonnet-5-5,claude-haiku-5-5,claude-opus-5-5').split(',').map((m: string) => m.trim());
  const v = validarCuerpo(texto, modelos);
  if (!v.ok) return json(400, { error: v.error });

  const lista = proveedores(env, await iaPrincipal(env, llamar));
  if (!lista.length) return json(503, { error: 'La IA no está configurada en el servidor (falta ANTHROPIC_API_KEY o GEMINI_API_KEY).' });

  let ultimo = 502;
  const detalle: string[] = [];
  for (const p of lista) {
    let intento: Intento;
    try { intento = p === 'claude' ? await conClaude(v.cuerpo, env, llamar) : await conGemini(v.cuerpo, env, llamar); }
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

const cacheIA = new Map<string, { v: { ia?: Proveedor; modelo?: string; fotos?: boolean }; hasta: number }>();
export const vaciarCacheIA = () => cacheIA.clear();

/** Ajustes que eligió el administrador (pestaña _Config: IA principal y modelo de Gemini), con memoria corta. Sin hoja → vacío. */
async function configIA(env: any, llamar: typeof fetch): Promise<{ ia?: Proveedor; modelo?: string; fotos?: boolean }> {
  if (!env.SYNC_URL || !env.SYNC_TOKEN) return {};
  const ttl = Math.max(0, Number(env.USUARIOS_CACHE_SEG ?? 60)) * 1000;
  const g = cacheIA.get(env.SYNC_URL);
  if (g && g.hasta > Date.now()) return g.v;
  try {
    const r = await haciaHojas({ accion: 'config' }, env.SYNC_TOKEN, env, llamar);
    const c: any = await r.json();
    const k = c?.ok ? c.config ?? {} : {};
    const v = {
      ia: k.ia === 'claude' || k.ia === 'gemini' ? (k.ia as Proveedor) : undefined,
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

const SIN_CLAVES = (txt: string, env: any) => [env.ANTHROPIC_API_KEY, env.GEMINI_API_KEY].filter(Boolean).reduce((t: string, k: string) => t.split(k).join('***'), txt);

/** Llamada mínima a un proveedor para el botón "Probar la IA" del administrador: dice si funciona y, si no, por qué (sin claves). */
async function probarProveedor(p: Proveedor, env: any, llamar: typeof fetch): Promise<{ ok: boolean; estado: number; mensaje: string }> {
  try {
    let usado = '', auto = false;
    const r = p === 'claude'
      ? await llamar('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': env.ANTHROPIC_API_KEY },
        body: JSON.stringify({ model: String(env.MODELOS_PERMITIDOS ?? 'claude-haiku-5-5').split(',')[0].trim(), max_tokens: 8, messages: [{ role: 'user', content: 'Responde solo: ok' }] }),
      })
      : await (async () => {
        const g = await generarConGemini(cuerpoPrueba(), env, llamar);
        usado = g.modelo; auto = g.autoElegido;
        return g.r;
      })();
    if (r.ok && p === 'gemini' && !deGemini(await r.clone().json().catch(() => null))) {
      return { ok: false, estado: 200, mensaje: `El modelo ${usado} respondió, pero no sabe analizar imágenes con herramientas (no sirve para esto). Elige otro modelo o "Automático".` };
    }
    if (r.ok) { await r.body?.cancel().catch(() => {}); return { ok: true, estado: r.status, mensaje: usado ? `Funciona con el modelo ${usado}${auto ? ' (elegido automáticamente porque el anterior no existe para tu cuenta)' : ''}.` : 'Funciona.' }; }
    const j: any = await r.json().catch(() => null);
    const msg = String(j?.error?.message ?? j?.error ?? '').slice(0, 220);
    return { ok: false, estado: r.status, mensaje: SIN_CLAVES(msg, env) || `Respondió ${r.status}.` };
  } catch { return { ok: false, estado: 0, mensaje: 'No se pudo conectar con el proveedor.' }; }
}

/** Menú de administración → Inteligencia artificial: ver estado, elegir cuál va primero, probar. Solo administradores. */
async function administrarIA(request: Request, env: any, llamar: typeof fetch): Promise<Response> {
  const texto = await request.text();
  if (texto.length > 2000) return json(413, { ok: false, error: 'Payload too large' });
  let c: any;
  try { c = JSON.parse(texto); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  const disponibles = { claude: !!env.ANTHROPIC_API_KEY, gemini: !!env.GEMINI_API_KEY };
  const estado = async () => ({ ok: true, principal: (await iaPrincipal(env, llamar)) ?? proveedores({ ...env, ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'x' })[0], disponibles, modeloGemini: (await modeloGemini(env, llamar)).modelo });
  if (c?.accion === 'estado') { cacheIA.clear(); return json(200, await estado()); }
  if (c?.accion === 'guardar') {
    if (c.proveedor !== 'claude' && c.proveedor !== 'gemini') return json(400, { ok: false, error: 'Proveedor inválido' });
    const r = await haciaHojas({ accion: 'config_guardar', clave: 'ia', valor: c.proveedor }, env.SYNC_TOKEN_ADMIN, env, llamar);
    cacheIA.clear();
    const j: any = await r.clone().json().catch(() => null);
    return j?.ok ? json(200, await estado()) : r;
  }
  if (c?.accion === 'modelos') {
    if (!disponibles.gemini) return json(200, { ok: true, modelos: [], actual: '', mensaje: 'Sin clave de Gemini en el servidor.' });
    const todos = await listarModelosGemini(env, llamar);
    const orden = [...todos].sort((a, b) => Number(/flash/.test(b)) - Number(/flash/.test(a)) || b.localeCompare(a));
    return json(200, { ok: true, modelos: orden.slice(0, 30), actual: (await modeloGemini(env, llamar)).modelo, sugerido: mejorModelo(todos) ?? '' });
  }
  if (c?.accion === 'modelo') {
    const m = c.modelo === 'auto' ? 'auto' : c.modelo;
    if (typeof m !== 'string' || (m !== 'auto' && !MODELO_GEMINI_RE.test(m))) return json(400, { ok: false, error: 'Modelo inválido' });
    if (m !== 'auto' && disponibles.gemini) {   // no se guarda un modelo que no sirve (voz, solo texto, inexistente…); 429/503 son momentáneos y sí se guarda
      const g = await generarConGemini(cuerpoPrueba(), env, llamar, m);
      const malo = g.r.status === 400 || g.r.status === 404 || (g.r.ok && !deGemini(await g.r.clone().json().catch(() => null)));
      if (malo) return json(400, { ok: false, error: `El modelo ${m} no sirve para analizar fotos (${g.r.ok ? 'no usa herramientas' : 'error ' + g.r.status}). Elige otro de la lista.` });
      await g.r.body?.cancel().catch(() => {});
    }
    const r = await haciaHojas({ accion: 'config_guardar', clave: 'gemini_modelo', valor: m }, env.SYNC_TOKEN_ADMIN, env, llamar);
    cacheIA.clear(); olvidarModeloDetectado();
    const j: any = await r.clone().json().catch(() => null);
    return j?.ok ? json(200, await estado()) : r;
  }
  if (c?.accion === 'probar') {
    const res: Record<string, any> = {};
    for (const p of ['gemini', 'claude'] as Proveedor[]) res[p] = disponibles[p] ? await probarProveedor(p, env, llamar) : { ok: false, estado: 0, mensaje: 'Sin clave configurada en el servidor.' };
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
  if (c.accion === 'guardar') {
    if (typeof c.nombre !== 'string' || !c.nombre.trim() || c.nombre.length > 60) return json(400, { ok: false, error: 'Nombre inválido' });
    if (!ROLES.includes(c.rol)) return json(400, { ok: false, error: 'Rol inválido' });
    if (c.clave !== undefined && c.clave !== '' && (typeof c.clave !== 'string' || !/^\S{8,64}$/.test(c.clave))) return json(400, { ok: false, error: 'La clave debe tener entre 8 y 64 caracteres, sin espacios.' });
    if (c.usuario !== undefined && (typeof c.usuario !== 'string' || c.usuario.trim().length < 2 || c.usuario.length > 40 || /^[=+\-@_]/.test(c.usuario.trim()))) return json(400, { ok: false, error: 'Usuario inválido' });
    const r = await haciaHojas({ accion: 'usuarios_guardar', nombre: c.nombre, ...(typeof c.usuario === 'string' ? { usuario: c.usuario.trim() } : {}), rol: c.rol, activo: c.activo !== false, claveNueva: c.claveNueva === true, terceros: c.terceros === true, ...(c.clave ? { clave: c.clave } : {}), por: quien.usuario }, env.SYNC_TOKEN_ADMIN, env, llamar);
    vaciarCacheUsuarios();   // los cambios se notan al instante en este servidor (en otros, tras USUARIOS_CACHE_SEG)
    return r;
  }
  return json(400, { ok: false, error: 'Acción no permitida' });
}

async function enrutar(request: Request, env: any, llamar: typeof fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const ruta = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const clave = request.headers.get('x-api-key') ?? '';

  if (!['/', '/analizar', '/sync', '/equipo', '/yo', '/usuarios', '/ia', '/ingresar', '/sistema'].includes(ruta)) return json(404, { error: 'Not found' });

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
