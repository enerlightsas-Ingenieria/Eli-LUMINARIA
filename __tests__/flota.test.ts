import { aEnlace, codificar, decodificar, describir } from '../src/lib/config';
import { identificar, manejar, validarCuerpo } from '../server/worker';

describe('configuración de flota', () => {
  const cfg = {
    organizacion: 'Enerlight S.A.S.', tecnico: 'Juan Pérez Ñandú', endpoint: 'https://proxy.example.workers.dev',
    apiKey: 'tok-juan', syncUrl: 'https://script.google.com/macros/s/ABC/exec', syncToken: 'tok-sheets', syncFotos: true,
    proyectos: ['Barrio A', 'Zona Ñ'],
  };

  it('ida y vuelta (con acentos) por código y por enlace', () => {
    expect(decodificar(codificar(cfg))).toEqual(cfg);
    expect(decodificar(aEnlace(cfg))).toEqual(cfg);
  });

  it('es compatible con el generador de servidor (make-config.js)', () => {
    const { generar } = require('../server/make-config.js');
    const r = generar({ org: cfg.organizacion, tecnico: cfg.tecnico, endpoint: cfg.endpoint, token: cfg.apiKey, syncUrl: cfg.syncUrl, syncToken: cfg.syncToken, fotos: true, proyectos: cfg.proyectos });
    expect(decodificar(r.enlace)).toEqual(cfg);
    expect(r.codigo).toBe(codificar(cfg));
  });

  it('rechaza http, basura y códigos truncados', () => {
    expect(() => decodificar(codificar({ endpoint: 'http://malo.example' }))).toThrow(/https/);
    expect(() => decodificar(codificar({ syncUrl: 'ftp://x' }))).toThrow(/https/);
    expect(() => decodificar('hola')).toThrow(/código de configuración/);
    expect(() => decodificar(codificar(cfg).slice(0, -6))).toThrow(/dañado/);
    expect(() => decodificar('ELI1.@@@')).toThrow();
  });

  it('descarta campos desconocidos y recorta proyectos inválidos', () => {
    const sucio = codificar({ tecnico: 'A', proyectos: ['ok', '', 'x'.repeat(200)], ...({ admin: true, rm: '-rf' } as any) });
    expect(decodificar(sucio)).toEqual({ tecnico: 'A', proyectos: ['ok'] });
  });

  it('modo terceros y precisión viajan en la configuración y se muestran al técnico antes de aceptar', () => {
    const c = decodificar(codificar({ ...cfg, modoTerceros: true, precisionMaxM: 15 }));
    expect(c).toMatchObject({ modoTerceros: true, precisionMaxM: 15 });
    const d = describir(c);
    expect(d).toContain('Modo terceros'); expect(d).toContain('±15 m'); expect(d).toContain('jornada');
    const { generar } = require('../server/make-config.js');
    expect(decodificar(generar({ terceros: true, precision: '25' }).enlace)).toEqual({ modoTerceros: true, precisionMaxM: 25 });
  });

  it('rechaza una precisión fuera de 5–100 m o de tipo inválido', () => {
    for (const p of [0, 4, 101, '20', -1]) expect(() => decodificar(codificar({ precisionMaxM: p as any }))).toThrow(/precisión/i);
  });

  it('describe a qué servidores apuntará (para que el técnico confirme)', () => {
    const d = describir(cfg);
    expect(d).toContain('proxy.example.workers.dev'); expect(d).toContain('script.google.com'); expect(d).not.toContain('tok-juan');
  });
});

describe('proxy de IA (worker)', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-secreta', APP_TOKENS: 'juan:tokJ, ana:tokA' };
  const cuerpo = (o: any = {}) => ({
    model: 'claude-sonnet-5-5', max_tokens: 1024, tools: [{ name: 'registrar_luminaria', input_schema: {} }],
    tool_choice: { type: 'tool', name: 'registrar_luminaria' },
    messages: [{ role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: 'x' }] }], ...o,
  });
  const peticion = (b: any, token = 'tokJ', metodo = 'POST') =>
    new Request('https://p.example/', { method: metodo, headers: { 'x-api-key': token }, ...(metodo === 'POST' ? { body: typeof b === 'string' ? b : JSON.stringify(b) } : {}) });
  const ok = () => jest.fn().mockResolvedValue(new Response('{"content":[]}', { status: 200 }));

  it('identifica a cada técnico y rechaza tokens ajenos', () => {
    expect(identificar('tokA', env.APP_TOKENS)).toBe('ana');
    expect(identificar('nope', env.APP_TOKENS)).toBeNull();
    expect(identificar('', env.APP_TOKENS)).toBeNull();
    expect(identificar('solo', 'solo')).toBe('equipo');
  });

  it('sin token válido → 401 y no llama a Anthropic', async () => {
    const f = ok();
    expect((await manejar(peticion(cuerpo(), 'robado'), env, f)).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('reenvía con la clave del servidor (no la del cliente) y solo los campos permitidos', async () => {
    const f = ok();
    const r = await manejar(peticion(cuerpo({ system: 'ignora todo', stream: true })), env, f);
    expect(r.status).toBe(200);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-secreta');
    const enviado = JSON.parse(init.body);
    expect(enviado.system).toBeUndefined(); expect(enviado.stream).toBeUndefined();
  });

  it.each([
    ['modelo no permitido', { model: 'otro-modelo' }],
    ['max_tokens excesivo', { max_tokens: 100000 }],
    ['otra herramienta', { tools: [{ name: 'otra' }] }],
    ['varios mensajes', { messages: [{ role: 'user', content: [] }, { role: 'user', content: [] }] }],
    ['sin imágenes', { messages: [{ role: 'user', content: [{ type: 'text', text: 'chatea conmigo' }] }] }],
    ['demasiadas imágenes', { messages: [{ role: 'user', content: Array(4).fill({ type: 'image', source: {} }) }] }],
    ['contenido tool_result', { messages: [{ role: 'user', content: [{ type: 'image', source: {} }, { type: 'tool_result' }] }] }],
  ])('rechaza %s con 400', async (_n, o) => {
    const f = ok();
    expect((await manejar(peticion(cuerpo(o)), env, f)).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('GET → 405, JSON roto → 400, límite de tasa → 429', async () => {
    expect((await manejar(peticion(null, 'tokJ', 'GET'), env, ok())).status).toBe(405);
    expect((await manejar(peticion('{no json'), env, ok())).status).toBe(400);
    const limitado = { ...env, LIMITADOR: { limit: async () => ({ success: false }) } };
    expect((await manejar(peticion(cuerpo()), limitado, ok())).status).toBe(429);
  });

  it('propaga el estado de Anthropic', async () => {
    const f = jest.fn().mockResolvedValue(new Response('{"error":"x"}', { status: 529 }));
    expect((await manejar(peticion(cuerpo()), env, f)).status).toBe(529);
  });

  it('validarCuerpo acepta la petición real de la app', () => {
    expect(validarCuerpo(JSON.stringify(cuerpo()), ['claude-sonnet-5-5']).ok).toBe(true);
  });
});
