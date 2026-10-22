/**
 * Proxy opcional para el análisis con IA (Cloudflare Workers).
 * La API key de Anthropic vive aquí, no en los teléfonos. La app envía el token del equipo
 * en el campo "API key" de Ajustes y apunta su "Endpoint" a la URL de este Worker.
 *
 * Variables (wrangler secret put ...): ANTHROPIC_API_KEY, APP_TOKENS (lista separada por comas).
 * Despliegue: `npx wrangler deploy server/worker.js --name eli-luminaria-proxy`
 */
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const token = request.headers.get('x-api-key') ?? '';
    const permitidos = (env.APP_TOKENS ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    if (!permitidos.includes(token)) return new Response('Unauthorized', { status: 401 });

    const body = await request.text();
    if (body.length > 12_000_000) return new Response('Payload too large', { status: 413 });

    const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': env.ANTHROPIC_API_KEY,
      },
      body,
    });
    return new Response(respuesta.body, { status: respuesta.status, headers: { 'content-type': 'application/json' } });
  },
};
