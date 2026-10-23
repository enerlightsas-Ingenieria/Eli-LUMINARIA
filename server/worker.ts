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
 *   /equipo         → datos del mapa/panel de supervisión (solo tokens de ADMIN_TOKENS)
 *
 * Secretos:  wrangler secret put ANTHROPIC_API_KEY
 *            wrangler secret put APP_TOKENS        # "juan:tok1,ana:tok2"
 *            wrangler secret put SYNC_URL          # URL /exec de la Web App de Google Apps Script
 *            wrangler secret put SYNC_TOKEN        # = TOKEN del script
 *            wrangler secret put ADMIN_TOKENS      # "supervisora:tokA"   (quienes pueden abrir el panel)
 *            wrangler secret put SYNC_TOKEN_ADMIN  # = TOKEN_ADMIN del script
 * Opcional:  MODELOS_PERMITIDOS = "claude-sonnet-5-5,claude-haiku-5-5"
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
  'marca', 'fabricante', 'modelo', 'tipoLuminaria', 'tecnologia', 'potenciaW', 'tensionV', 'fotocelda', 'pinesFotocelda',
  'temperaturaColorK', 'flujoLuminosoLm', 'ip', 'montaje', 'alturaM', 'estado', 'observaciones', 'confianza',
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

async function analizar(request: Request, env: any, llamar: typeof fetch, tecnico: string): Promise<Response> {
  const texto = await request.text();
  if (texto.length > MAX_BYTES) return json(413, { error: 'Payload too large' });
  const modelos = (env.MODELOS_PERMITIDOS ?? 'claude-sonnet-5-5,claude-haiku-5-5,claude-opus-5-5').split(',').map((m: string) => m.trim());
  const v = validarCuerpo(texto, modelos);
  if (!v.ok) return json(400, { error: v.error });

  const r = await llamar('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': env.ANTHROPIC_API_KEY },
    body: JSON.stringify(v.cuerpo),
  });
  console.log(JSON.stringify({ tecnico, estado: r.status, modelo: v.cuerpo.model }));
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
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

async function sincronizar(request: Request, env: any, llamar: typeof fetch, tecnico: string): Promise<Response> {
  const texto = await request.text();
  if (texto.length > MAX_BYTES) return json(413, { ok: false, error: 'Payload too large' });
  let c: any;
  try { c = JSON.parse(texto); } catch { return json(400, { ok: false, error: 'JSON inválido' }); }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return json(400, { ok: false, error: 'Cuerpo inválido' });
  if (!ACCIONES_SYNC.includes(c.accion)) return json(400, { ok: false, error: 'Acción no permitida' });
  delete c.token;                                  // el cliente no puede imponer el token del script
  if (c.accion === 'latido') c.tecnico = tecnico;  // la presencia se atribuye al dueño del token, no a lo que diga el cliente
  return haciaHojas(c, env.SYNC_TOKEN, env, llamar);
}

async function enrutar(request: Request, env: any, llamar: typeof fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const ruta = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const clave = request.headers.get('x-api-key') ?? '';

  if (ruta === '/equipo') {
    if (!identificar(clave, env.ADMIN_TOKENS)) return json(401, { error: 'Unauthorized' });
    return haciaHojas({ accion: 'equipo' }, env.SYNC_TOKEN_ADMIN, env, llamar);
  }
  if (ruta !== '/' && ruta !== '/analizar' && ruta !== '/sync') return json(404, { error: 'Not found' });

  const tecnico = identificar(clave, env.APP_TOKENS);
  if (!tecnico) return json(401, { error: 'Unauthorized' });
  if (env.LIMITADOR && !(await env.LIMITADOR.limit({ key: tecnico })).success) return json(429, { error: 'Demasiadas solicitudes' });

  return ruta === '/sync' ? sincronizar(request, env, llamar, tecnico) : analizar(request, env, llamar, tecnico);
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
