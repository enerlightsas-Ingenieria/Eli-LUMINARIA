/**
 * Proxy de IA para flotas (Cloudflare Workers). La API key de Anthropic vive SOLO aquí.
 *
 * - Cada técnico recibe su propio token ("nombre:token" en APP_TOKENS) → se puede revocar uno sin afectar al resto.
 * - Sólo deja pasar peticiones con la forma exacta de ELI-LUMINARIA (1 mensaje, ≤3 imágenes, herramienta
 *   registrar_luminaria, modelo permitido, max_tokens acotado), así una clave filtrada no sirve de chat gratuito.
 * - Registra quién llamó (sin guardar imágenes) y admite un limitador opcional de Cloudflare (binding LIMITADOR).
 *
 * Secretos:  wrangler secret put ANTHROPIC_API_KEY
 *            wrangler secret put APP_TOKENS        # "juan:tok1,ana:tok2"
 * Opcional:  MODELOS_PERMITIDOS = "claude-sonnet-5-5,claude-haiku-5-5"
 * Despliegue: npx wrangler deploy server/worker.ts --name eli-luminaria-proxy --compatibility-date 2026-01-01
 */
const MAX_BYTES = 12_000_000;
const MAX_TOKENS = 1500;
const MAX_IMAGENES = 3;
const HERRAMIENTA = 'registrar_luminaria';

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

export function validarCuerpo(texto: string, modelos: string[]): { ok: true; cuerpo: any } | { ok: false; error: string } {
  let b: any;
  try { b = JSON.parse(texto); } catch { return { ok: false, error: 'JSON inválido' }; }
  if (!modelos.includes(b?.model)) return { ok: false, error: 'Modelo no permitido' };
  if (!(b.max_tokens > 0 && b.max_tokens <= MAX_TOKENS)) return { ok: false, error: 'max_tokens fuera de rango' };
  if (!Array.isArray(b.tools) || b.tools.length !== 1 || b.tools[0]?.name !== HERRAMIENTA) return { ok: false, error: 'Herramienta no permitida' };
  if (!Array.isArray(b.messages) || b.messages.length !== 1 || b.messages[0]?.role !== 'user' || !Array.isArray(b.messages[0].content)) {
    return { ok: false, error: 'Mensajes no permitidos' };
  }
  const contenido: any[] = b.messages[0].content;
  if (contenido.some((c) => c?.type !== 'text' && c?.type !== 'image')) return { ok: false, error: 'Contenido no permitido' };
  const imagenes = contenido.filter((c) => c.type === 'image');
  if (imagenes.length < 1 || imagenes.length > MAX_IMAGENES) return { ok: false, error: `Debe incluir de 1 a ${MAX_IMAGENES} imágenes` };
  return { ok: true, cuerpo: { model: b.model, max_tokens: b.max_tokens, tools: b.tools, tool_choice: b.tool_choice, messages: b.messages } };
}

export async function manejar(request: Request, env: any, llamar: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const tecnico = identificar(request.headers.get('x-api-key') ?? '', env.APP_TOKENS);
  if (!tecnico) return json(401, { error: 'Unauthorized' });

  if (env.LIMITADOR && !(await env.LIMITADOR.limit({ key: tecnico })).success) return json(429, { error: 'Demasiadas solicitudes' });

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

export default { fetch: (request: Request, env: any) => manejar(request, env) };
