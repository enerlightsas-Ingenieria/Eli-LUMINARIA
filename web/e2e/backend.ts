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
export const MODELOS_GEMINI = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash-preview-05-20', 'gemini-3.5-flash-lite-preview-06-17', 'gemini-3.1-flash-lite-preview', 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];

export function crearBackend(respuestaIA: Record<string, string> = { fabricante: 'Philips', tecnologia: 'LED', potenciaW: '150', control: 'Fotocelda', montaje: 'Poste', materialPoste: 'Concreto', confianza: 'alta' }, opciones: { gemini?: boolean } = {}) {
  const gs = crearServidor(fileURLToPath(new URL('../../server/google-apps-script.gs', import.meta.url)));
  gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'listar', proyecto: { nombre: 'Barrio A' }, desde: '' }) });   // proyecto que ya existe en la hoja (solo el administrador crea proyectos)
  const env = {
    ANTHROPIC_API_KEY: 'sk-secreta', APP_TOKENS: 'Ana:tokAna,Beto:tokBeto', ADMIN_TOKENS: 'Sup:tokSup',
    ...(opciones.gemini ? { GEMINI_API_KEY: 'AIza-prueba' } : {}),
    SYNC_URL: 'https://gs.test/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN',
  };
  const estado = { llamadasIA: 0, llamadasGroq: 0, ultimaPeticionIA: null as any };

  const llamar = async (url: any, init: any): Promise<Response> => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com')) {
      estado.llamadasIA++; estado.ultimaPeticionIA = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', input: respuestaIA }] }), { status: 200 });
    }
    if (u.startsWith('https://api.groq.com')) {                                       // una IA "compatible con ChatGPT"
      if (u.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'meta-llama/llama-4-scout-17b-16e-instruct' }, { id: 'whisper-large-v3' }] }), { status: 200 });
      estado.llamadasGroq++;
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'registrar_luminaria', arguments: JSON.stringify(respuestaIA) } }] } }] }), { status: 200 });
    }
    if (u.startsWith('https://generativelanguage.googleapis.com')) {
      if (u.includes('/models?')) return new Response(JSON.stringify({ models: MODELOS_GEMINI.map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }), { status: 200 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'registrar_luminaria', args: respuestaIA } }] } }] }), { status: 200 });
    }
    if (u.startsWith('https://nominatim.openstreetmap.org')) {                         // el mapa que da la dirección de una coordenada
      return new Response(JSON.stringify({ address: { road: 'Carrera 7', house_number: '12-30', neighbourhood: 'La Candelaria', city: 'Bogotá' } }), { status: 200 });
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
