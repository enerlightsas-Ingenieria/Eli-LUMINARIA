import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Browser, Page, Route } from '@playwright/test';
import { manejar } from '../../server/worker';
import { crearServidor } from '../../__tests__/helpers/hoja';

const require = createRequire(import.meta.url);
const { generar } = require('../../server/make-config.js');

export const WEB = 'http://localhost:4173';
export const WORKER = 'https://worker.test';

/** Backend de prueba: el proxy real delante del script de Google real (sobre una hoja simulada). La IA es un doble fijo. */
export function crearBackend(respuestaIA: Record<string, string> = { fabricante: 'Philips', tecnologia: 'LED', potenciaW: '150', pinesFotocelda: '7', confianza: 'alta' }) {
  const gs = crearServidor(fileURLToPath(new URL('../../server/google-apps-script.gs', import.meta.url)));
  const env = {
    ANTHROPIC_API_KEY: 'sk-secreta', APP_TOKENS: 'Ana:tokAna,Beto:tokBeto', ADMIN_TOKENS: 'Sup:tokSup',
    SYNC_URL: 'https://gs.test/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN',
  };
  const estado = { llamadasIA: 0, ultimaPeticionIA: null as any };

  const llamar = async (url: any, init: any): Promise<Response> => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com')) {
      estado.llamadasIA++; estado.ultimaPeticionIA = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', input: respuestaIA }] }), { status: 200 });
    }
    if (u.startsWith('https://gs.test')) return gs.llamar(u, init);
    throw new Error('URL inesperada: ' + u);
  };

  /** Atiende las peticiones del navegador al "worker" pasándolas por el código real del proxy (incluido CORS). */
  const atender = async (route: Route) => {
    const r = route.request();
    const peticion = new Request(r.url(), { method: r.method(), headers: r.headers(), body: ['GET', 'HEAD'].includes(r.method()) ? undefined : (r.postData() ?? undefined) });
    const resp = await manejar(peticion, env, llamar as any);
    await route.fulfill({ status: resp.status, headers: Object.fromEntries(resp.headers), body: await resp.text() });
  };

  return { gs, env, estado, atender };
}

export type Backend = ReturnType<typeof crearBackend>;

export function enlace(o: { tecnico?: string; token: string; proyectos?: string[]; terceros?: boolean; precision?: string; supervisor?: boolean; sinSync?: boolean }) {
  const r = generar({ worker: WORKER, token: o.token, tecnico: o.tecnico, proyectos: o.proyectos, terceros: o.terceros, precision: o.precision, supervisor: o.supervisor, web: WEB });
  return r.enlaceWeb as string;
}

/** Un "teléfono": contexto con GPS en Bogotá y cámara simulada, conectado al backend de prueba. */
export async function telefono(browser: Browser, backend: Backend, opciones: { precision?: number } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    permissions: ['geolocation', 'camera'], geolocation: { latitude: 4.711, longitude: -74.0721, accuracy: opciones.precision ?? 8 },
    viewport: { width: 390, height: 844 }, locale: 'es-CO',
  });
  await ctx.route(`${WORKER}/**`, backend.atender);
  await ctx.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (r) => r.abort());   // sin mapas reales en las pruebas
  const page = await ctx.newPage();
  return { ctx, page };
}
