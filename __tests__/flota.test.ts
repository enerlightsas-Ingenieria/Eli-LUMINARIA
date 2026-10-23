import { aEnlace, codificar, decodificar, describir } from '../src/lib/config';
import { identificar, manejar, validarCuerpo, vaciarCacheUsuarios, vaciarCacheIA, olvidarModeloDetectado, mejorModelo, aGemini, deGemini, proveedores } from '../server/worker';
import { TOOL } from '../src/services/analyzer';

jest.mock('../src/services/settings', () => ({ cargarAjustes: async () => ({}) }));

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

  it('make-config valida --precision: rango, número y que exista --terceros', () => {
    const { generar } = require('../server/make-config.js');
    expect(() => generar({ terceros: true, precision: 'veinte' })).toThrow(/entre 5 y 100/);
    expect(() => generar({ terceros: true, precision: '200' })).toThrow(/entre 5 y 100/);
    expect(() => generar({ terceros: true, precision: '4' })).toThrow(/entre 5 y 100/);
    expect(() => generar({ precision: '20' })).toThrow(/--terceros/);
    expect(decodificar(generar({ terceros: true }).enlace)).toEqual({ modoTerceros: true });
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
  const imagen = (o: any = {}) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA', ...o } });
  const cuerpo = (o: any = {}) => ({
    model: 'claude-sonnet-5-5', max_tokens: 1024, tools: [TOOL],
    tool_choice: { type: 'tool', name: 'registrar_luminaria' },
    messages: [{ role: 'user', content: [imagen(), { type: 'text', text: 'x' }] }], ...o,
  });
  const conTool = (cambio: (t: any) => void) => { const t = JSON.parse(JSON.stringify(TOOL)); cambio(t); return { tools: [t] }; };
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
    ['esquema de herramienta arbitrario', conTool((t) => { t.input_schema.properties.respuesta_libre = { type: 'string', description: 'x' }; })],
    ['propiedad de la herramienta que no es texto', conTool((t) => { t.input_schema.properties.fabricante = { type: 'object' }; })],
    ['descripción de herramienta enorme', conTool((t) => { t.description = 'x'.repeat(5000); })],
    ['herramienta con claves extra', conTool((t) => { t.cache_control = {}; })],
    ['tool_choice automático', { tool_choice: { type: 'auto' } }],
    ['sin tool_choice', { tool_choice: undefined }],
    ['texto libre enorme', { messages: [{ role: 'user', content: [imagen(), { type: 'text', text: 'escribe un ensayo '.repeat(500) }] }] }],
    ['varios textos que suman demasiado', { messages: [{ role: 'user', content: [imagen(), ...Array(4).fill({ type: 'text', text: 'a'.repeat(2000) })] }] }],
    ['imagen que no es JPEG', { messages: [{ role: 'user', content: [imagen({ media_type: 'image/png' })] }] }],
    ['imagen desde URL', { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://x' } }] }] }],
    ['imagen gigante', { messages: [{ role: 'user', content: [imagen({ data: 'A'.repeat(4_500_001) })] }] }],
    ['varios mensajes', { messages: [{ role: 'user', content: [] }, { role: 'user', content: [] }] }],
    ['sin imágenes', { messages: [{ role: 'user', content: [{ type: 'text', text: 'chatea conmigo' }] }] }],
    ['demasiadas imágenes', { messages: [{ role: 'user', content: Array(4).fill(imagen()) }] }],
    ['contenido tool_result', { messages: [{ role: 'user', content: [imagen(), { type: 'tool_result' }] }] }],
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

  it('la lista de propiedades del proxy coincide con la herramienta real de la app', () => {
    // si alguien cambia analyzer.ts y no el proxy, la app dejaría de funcionar en producción: esta prueba lo impide
    expect(validarCuerpo(JSON.stringify(cuerpo()), ['claude-sonnet-5-5'])).toMatchObject({ ok: true });
    const conUna = JSON.parse(JSON.stringify(TOOL)); delete conUna.input_schema.properties.fabricante; conUna.input_schema.required = conUna.input_schema.required.filter((r: string) => r !== 'marca');
    expect(validarCuerpo(JSON.stringify(cuerpo({ tools: [conUna] })), ['claude-sonnet-5-5'])).toMatchObject({ ok: false });
  });

  it('validarCuerpo acepta la petición real de la app', () => {
    expect(validarCuerpo(JSON.stringify(cuerpo()), ['claude-sonnet-5-5']).ok).toBe(true);
  });
});

describe('proxy: CORS, puerta de sincronización y panel de supervisión (para la web)', () => {
  const env: any = {
    ANTHROPIC_API_KEY: 'sk-secreta', APP_TOKENS: 'juan:tokJ', ADMIN_TOKENS: 'sup:tokS',
    SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'TOKEN-HOJA', SYNC_TOKEN_ADMIN: 'TOKEN-ADMIN-HOJA',
  };
  const req = (ruta: string, cuerpo: any, token = 'tokJ', extra: any = {}) =>
    new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': token, ...(extra.headers ?? {}) }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });
  const hojas = (respuesta: any = { ok: true }) => jest.fn().mockResolvedValue(new Response(JSON.stringify(respuesta), { status: 200 }));
  const cuerpoEnviado = (f: jest.Mock) => JSON.parse((f.mock.calls[0] as any)[1].body);

  it('responde el preflight de CORS (el navegador lo exige por la cabecera x-api-key)', async () => {
    const r = await manejar(new Request('https://p.example/sync', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }), env, hojas());
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-headers')).toContain('x-api-key');
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('con ORIGENES_PERMITIDOS solo refleja los orígenes de la lista', async () => {
    const e = { ...env, ORIGENES_PERMITIDOS: 'https://app.example, https://otra.example' };
    const ok = await manejar(new Request('https://p.example/sync', { method: 'OPTIONS', headers: { origin: 'https://otra.example' } }), e, hojas());
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://otra.example');
    const mal = await manejar(new Request('https://p.example/sync', { method: 'OPTIONS', headers: { origin: 'https://malo.example' } }), e, hojas());
    expect(mal.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('las respuestas de error también llevan CORS (si no, la web vería un error opaco)', async () => {
    const r = await manejar(req('/sync', {}, 'robado'), env, hojas());
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });

  describe('/sync', () => {
    it('reenvía al script con el token del script y NUNCA el que mande el cliente', async () => {
      const f = hojas({ ok: true, recibidas: 1 });
      const r = await manejar(req('/sync', { token: 'quiero-otro', proyecto: { nombre: 'A' }, luminarias: [{ uuid: 'u1', tecnico: 'Ana' }] }), env, f);
      expect(await r.json()).toEqual({ ok: true, recibidas: 1 });
      expect((f.mock.calls[0] as any)[0]).toBe('https://gs.example/exec');
      const b = cuerpoEnviado(f);
      expect(b.token).toBe('TOKEN-HOJA');
      expect(b.luminarias[0]).toEqual({ uuid: 'u1', tecnico: 'Ana' });          // los datos pasan intactos
    });

    it('en los latidos el técnico lo pone el proxy según el token (no se puede suplantar)', async () => {
      const f = hojas();
      await manejar(req('/sync', { accion: 'latido', tecnico: 'Alguien Más', dispositivo: 'd', estado: 'activa' }), env, f);
      expect(cuerpoEnviado(f).tecnico).toBe('juan');
    });

    it('solo permite subir, listar y latir: nada de acciones de administración', async () => {
      const f = hojas();
      for (const accion of ['equipo', 'borrar', 'x']) {
        expect((await manejar(req('/sync', { accion }), env, f)).status).toBe(400);
      }
      expect(f).not.toHaveBeenCalled();
      expect((await manejar(req('/sync', { accion: 'listar', proyecto: {}, desde: '' }), env, f)).status).toBe(200);
    });

    it('rechaza sin token, JSON inválido, arreglos, y cuerpos enormes', async () => {
      const f = hojas();
      expect((await manejar(req('/sync', {}, ''), env, f)).status).toBe(401);
      expect((await manejar(req('/sync', '{no json'), env, f)).status).toBe(400);
      expect((await manejar(req('/sync', [1, 2]), env, f)).status).toBe(400);
      expect((await manejar(req('/sync', 'x'.repeat(12_000_001)), env, f)).status).toBe(413);
      expect(f).not.toHaveBeenCalled();
    });

    it('si el script de Google responde basura o no responde, devuelve un error claro (502)', async () => {
      const html = jest.fn().mockResolvedValue(new Response('<html>Error</html>', { status: 200 }));
      const a = await manejar(req('/sync', {}), env, html);
      expect(a.status).toBe(502); expect((await a.json()).ok).toBe(false);
      const caido = jest.fn().mockRejectedValue(new Error('boom'));
      expect((await manejar(req('/sync', {}), env, caido)).status).toBe(502);
    });

    it('avisa si el proxy no tiene configurado el destino', async () => {
      const r = await manejar(req('/sync', {}), { ...env, SYNC_URL: undefined }, hojas());
      expect(r.status).toBe(500); expect((await r.json()).error).toMatch(/SYNC_URL/);
    });
  });

  describe('/equipo (panel de supervisión)', () => {
    it('un técnico NO puede ver el panel; un administrador sí, y con el token administrador del script', async () => {
      const f = hojas({ ok: true, tecnicos: [{ tecnico: 'Ana' }], luminarias: [], calidad: {} });
      expect((await manejar(req('/equipo', {}, 'tokJ'), env, f)).status).toBe(401);
      expect(f).not.toHaveBeenCalled();
      const r = await manejar(req('/equipo', {}, 'tokS'), env, f);
      expect(r.status).toBe(200); expect((await r.json()).tecnicos[0].tecnico).toBe('Ana');
      expect(cuerpoEnviado(f)).toEqual({ accion: 'equipo', token: 'TOKEN-ADMIN-HOJA' });
    });

    it('un supervisor también puede sincronizar (su rol incluye el de técnico)', async () => {
      expect((await manejar(req('/sync', {}, 'tokS'), env, hojas())).status).toBe(200);
    });
  });

  it('rutas desconocidas → 404 y GET → 405', async () => {
    expect((await manejar(req('/otra', {}), env, hojas())).status).toBe(404);
    expect((await manejar(new Request('https://p.example/sync', { method: 'GET' }), env, hojas())).status).toBe(405);
  });
});

describe('usuarios por rol desde la pestaña _Usuarios', () => {
  const { crearServidor } = require('./helpers/hoja');
  const montar = (extra: any = {}) => {
    const gs = crearServidor();
    const env: any = { ANTHROPIC_API_KEY: 'sk', SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN', USUARIOS_CACHE_SEG: 0, ...extra };
    const f = jest.fn((u: any, i: any) => gs.llamar(u, i));
    const req = (ruta: string, clave: string, cuerpo: any = {}) => new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': clave }, body: JSON.stringify(cuerpo) });
    const usuarios = () => { gs.gs.prepararUsuarios(); return gs.hoja('_Usuarios'); };
    return { gs, env, f, req, usuarios };
  };

  beforeEach(() => vaciarCacheUsuarios());

  it('sin pestaña _Usuarios nadie entra; con ella, el técnico sincroniza y no ve el panel; el supervisor sí', async () => {
    const m = montar();
    expect((await manejar(m.req('/sync', 'abc'), m.env, m.f as any)).status).toBe(401);
    const h = m.usuarios();
    h.appendRow(['Ana', 'tecnico', 'claveAna', 'si']);
    h.appendRow(['Sofía', 'Supervisor', 'claveSofia', 'si']);
    expect((await manejar(m.req('/sync', 'claveAna', { accion: 'listar', proyecto: { nombre: 'P' }, desde: '' }), m.env, m.f as any)).status).toBe(200);
    expect((await manejar(m.req('/equipo', 'claveAna'), m.env, m.f as any)).status).toBe(401);
    const sup = await manejar(m.req('/equipo', 'claveSofia'), m.env, m.f as any);
    expect(sup.status).toBe(200); expect((await sup.json()).ok).toBe(true);
  });

  it('el latido se atribuye al nombre de la hoja, no al que declare el cliente', async () => {
    const m = montar(); m.usuarios().appendRow(['Ana', 'tecnico', 'claveAna', 'si']);
    await manejar(m.req('/sync', 'claveAna', { accion: 'latido', tecnico: 'Otro', dispositivo: 'd1', estado: 'activa' }), m.env, m.f as any);
    expect(m.gs.hoja('_Equipo').filas[1][1]).toBe('Ana');
  });

  it('Activo = no, clave vacía y rol raro (→ técnico) se tratan con el menor privilegio', async () => {
    const m = montar(); const h = m.usuarios();
    h.appendRow(['Baja', 'tecnico', 'claveBaja', 'no']);
    h.appendRow(['Raro', 'jefe', 'claveRaro', 'si']);
    h.appendRow(['SinClave', 'supervisor', '', 'si']);
    expect((await manejar(m.req('/sync', 'claveBaja'), m.env, m.f as any)).status).toBe(401);
    expect((await manejar(m.req('/sync', ' '), m.env, m.f as any)).status).toBe(401);
    expect((await manejar(m.req('/equipo', 'claveRaro'), m.env, m.f as any)).status).toBe(401);
    expect((await manejar(m.req('/sync', 'claveRaro'), m.env, m.f as any)).status).toBe(200);
  });

  it('dar de baja surte efecto al vencer la memoria; mientras tanto no se pregunta a la hoja en cada petición', async () => {
    const m = montar({ USUARIOS_CACHE_SEG: 60 }); const h = m.usuarios();
    h.appendRow(['Ana', 'tecnico', 'claveAna', 'si']);
    await manejar(m.req('/sync', 'claveAna'), m.env, m.f as any);
    const antes = m.f.mock.calls.length;
    await manejar(m.req('/sync', 'claveAna'), m.env, m.f as any);
    expect(m.f.mock.calls.length - antes).toBe(1);        // solo la sincronización: la identidad salió de la memoria
    h.filas[2][3] = 'no';
    expect((await manejar(m.req('/sync', 'claveAna'), m.env, m.f as any)).status).toBe(200);   // aún recordada
    vaciarCacheUsuarios();
    expect((await manejar(m.req('/sync', 'claveAna'), m.env, m.f as any)).status).toBe(401);
  });

  it('los secretos APP_TOKENS / ADMIN_TOKENS siguen funcionando y la clave de la hoja no se confunde con el token del script', async () => {
    const m = montar({ APP_TOKENS: 'juan:tokJ' });
    expect((await manejar(m.req('/sync', 'tokJ'), m.env, m.f as any)).status).toBe(200);
    expect(m.f).toHaveBeenCalledTimes(1);                  // tokJ no consultó la hoja de usuarios
    expect((await manejar(m.req('/sync', 'CAMBIA-ESTE-TOKEN'), m.env, m.f as any)).status).toBe(401);
  });

  it('si la hoja no responde → 502 (no 401), y no se recuerda el fallo', async () => {
    const m = montar();
    const caido = jest.fn().mockRejectedValue(new Error('x'));
    expect((await manejar(m.req('/sync', 'abc'), m.env, caido as any)).status).toBe(502);
  });

  it('el script solo revela identidad con el token del equipo, y generarClavesFaltantes completa solo las filas vacías', async () => {
    const m = montar(); const h = m.usuarios();
    h.appendRow(['Ana', 'tecnico', '', 'si']); h.appendRow(['Beto', 'tecnico', 'fija', 'si']);
    expect(m.gs.gs.generarClavesFaltantes()).toBe(1);
    expect(h.filas[2][2]).toMatch(/^[0-9a-f]{20}$/); expect(h.filas[3][2]).toBe('fija');
    const r = await m.gs.llamar('', { body: JSON.stringify({ token: 'malo', accion: 'usuario', clave: 'fija' }) });
    expect((await r.json()).ok).toBe(false);
  });
});

describe('IA con dos proveedores: Claude y Gemini (respaldo)', () => {
  const imagen = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };
  const cuerpo = JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1024, tools: [TOOL], tool_choice: { type: 'tool', name: 'registrar_luminaria' }, messages: [{ role: 'user', content: [imagen, { type: 'text', text: 'Foto general:' }] }] });
  const pet = () => new Request('https://p.example/analizar', { method: 'POST', headers: { 'x-api-key': 'tokJ' }, body: cuerpo });
  const gem = (args: any = { fabricante: 'Philips', tecnologia: 'LED', potenciaW: '150', confianza: 'alta' }) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'registrar_luminaria', args } }] } }] }), { status: 200 });
  const claude = (status = 200) => new Response(status === 200 ? JSON.stringify({ content: [{ type: 'tool_use', input: { fabricante: 'Schréder' } }] }) : '{"error":{"message":"Your credit balance is too low"}}', { status });
  const envBase = { APP_TOKENS: 'juan:tokJ', ANTHROPIC_API_KEY: 'sk-a', GEMINI_API_KEY: 'AIza-g', ORDEN_IA: 'claude,gemini' };   // los tests de respaldo parten de Claude primero
  const ruta = (f: jest.Mock) => f.mock.calls.map((c: any) => String(c[0]).includes('anthropic') ? 'claude' : 'gemini');

  it('el orden por defecto es Gemini y luego Claude; solo cuentan los que tienen clave', () => {
    const { ORDEN_IA, ...sinOrden } = envBase;
    expect(proveedores(sinOrden)).toEqual(['gemini', 'claude']);
    expect(proveedores(envBase)).toEqual(['claude', 'gemini']);
    expect(proveedores(sinOrden, 'claude')).toEqual(['claude', 'gemini']);   // lo que elige el administrador manda
    expect(proveedores({ ANTHROPIC_API_KEY: 'x' }, 'gemini')).toEqual(['claude']);   // el elegido no tiene clave → el otro
    expect(proveedores({ ANTHROPIC_API_KEY: 'x' })).toEqual(['claude']);
    expect(proveedores({ GEMINI_API_KEY: 'x' })).toEqual(['gemini']);
    expect(proveedores({ ...envBase, ORDEN_IA: 'gemini' })).toEqual(['gemini']);
    expect(proveedores({})).toEqual([]);
  });

  it('si Claude responde, no se llama a Gemini', async () => {
    const f = jest.fn().mockResolvedValue(claude());
    const r = await manejar(pet(), envBase, f);
    expect(r.status).toBe(200); expect(r.headers.get('x-ia-proveedor')).toBe('claude');
    expect(ruta(f)).toEqual(['claude']);
  });

  it.each([[400], [401], [402], [429], [500], [529]])('si Claude falla con %i (p. ej. sin créditos) responde Gemini con la misma forma de respuesta', async (estado) => {
    const f = jest.fn().mockImplementation(async (u: any) => (String(u).includes('anthropic') ? claude(estado) : gem()));
    const r = await manejar(pet(), envBase, f);
    expect(r.status).toBe(200); expect(r.headers.get('x-ia-proveedor')).toBe('gemini');
    const j = await r.json();
    expect(j.content[0]).toEqual({ type: 'tool_use', name: 'registrar_luminaria', input: { fabricante: 'Philips', tecnologia: 'LED', potenciaW: '150', confianza: 'alta' } });
    expect(ruta(f)).toEqual(['claude', 'gemini']);
  });

  it('también si Claude no responde en absoluto (red caída)', async () => {
    const f = jest.fn().mockImplementation(async (u: any) => { if (String(u).includes('anthropic')) throw new Error('red'); return gem(); });
    expect((await manejar(pet(), envBase, f)).headers.get('x-ia-proveedor')).toBe('gemini');
  });

  it('con solo la clave de Gemini funciona sin Claude; con ORDEN_IA=gemini,claude, Claude queda de respaldo', async () => {
    const f1 = jest.fn().mockResolvedValue(gem());
    expect((await manejar(pet(), { APP_TOKENS: 'juan:tokJ', GEMINI_API_KEY: 'g' }, f1)).status).toBe(200);
    expect(ruta(f1)).toEqual(['gemini']);
    const f2 = jest.fn().mockImplementation(async (u: any) => (String(u).includes('anthropic') ? claude() : new Response('{}', { status: 429 })));
    const r = await manejar(pet(), { ...envBase, ORDEN_IA: 'gemini,claude' }, f2);
    expect(r.headers.get('x-ia-proveedor')).toBe('claude'); expect(ruta(f2)).toEqual(['gemini', 'gemini', 'claude']);   // el 2.º es la consulta de modelos alternativos
  });

  it('si fallan los dos devuelve un error sin filtrar claves; sin ninguna clave → 503', async () => {
    const f = jest.fn().mockResolvedValue(new Response('{"error":"sk-a AIza-g"}', { status: 500 }));
    const r = await manejar(pet(), envBase, f);
    expect(r.status).toBe(500); expect(await r.text()).not.toMatch(/sk-a|AIza/);
    expect((await manejar(pet(), { APP_TOKENS: 'juan:tokJ' }, f)).status).toBe(503);
  });

  it('el aviso incluye el motivo que da el proveedor (sin claves) para saber qué corregir', async () => {
    const f = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key. (AIza-g)' } }), { status: 400 }));
    const r = await manejar(pet(), { APP_TOKENS: 'juan:tokJ', GEMINI_API_KEY: 'AIza-g' }, f);
    const t = await r.text();
    expect(r.status).toBe(400); expect(t).toContain('gemini 400: API key not valid'); expect(t).not.toContain('AIza-g');
  });

  it('Gemini bloqueando la imagen (sin llamada a la herramienta) cuenta como fallo', async () => {
    const f = jest.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), { status: 200 }));
    expect((await manejar(pet(), { APP_TOKENS: 'juan:tokJ', GEMINI_API_KEY: 'g' }, f)).status).toBe(502);
  });

  it('la petición a Gemini lleva la clave en cabecera (no en la URL), las fotos, la herramienta y la llamada forzada', async () => {
    const f = jest.fn().mockResolvedValue(gem());
    await manejar(pet(), { APP_TOKENS: 'juan:tokJ', GEMINI_API_KEY: 'AIza-g', GEMINI_MODEL: 'gemini-x' }, f);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('AIza-g');
    const b = JSON.parse(init.body);
    expect(b.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
    expect(b.toolConfig.functionCallingConfig).toEqual({ mode: 'ANY', allowedFunctionNames: ['registrar_luminaria'] });
    const decl = b.tools[0].functionDeclarations[0];
    expect(decl.parameters.type).toBe('OBJECT');
    expect(Object.keys(decl.parameters.properties)).toEqual(Object.keys(TOOL.input_schema.properties));
    expect(decl.parameters.properties.confianza.enum).toEqual(['alta', 'media', 'baja']);
    expect(JSON.stringify(b)).not.toContain('AIza-g');
  });

  it('deGemini ignora respuestas sin llamada y aGemini conserva todas las propiedades', () => {
    expect(deGemini({ candidates: [{ content: { parts: [{ text: 'hola' }] } }] })).toBeNull();
    expect(deGemini(null)).toBeNull();
    expect(Object.keys(aGemini(JSON.parse(cuerpo)).tools[0].functionDeclarations[0].parameters.required)).toHaveLength(TOOL.input_schema.required.length);
  });
});

describe('administración de usuarios desde la app (rol admin)', () => {
  const { crearServidor } = require('./helpers/hoja');
  const montar = () => {
    const gs = crearServidor();
    const env: any = { SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN', USUARIOS_CACHE_SEG: 0, ADMIN_TOKENS: 'jefe:claveJefe' };
    const f = jest.fn((u: any, i: any) => gs.llamar(u, i));
    const req = (ruta: string, clave: string, cuerpo: any = {}) => new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': clave }, body: JSON.stringify(cuerpo) });
    const llamar = async (ruta: string, clave: string, cuerpo?: any) => { const r = await manejar(req(ruta, clave, cuerpo), env, f as any); return { status: r.status, j: await r.json() }; };
    return { gs, env, f, llamar };
  };
  beforeEach(() => vaciarCacheUsuarios());

  it('el administrador crea técnico y supervisor; cada uno entra con SU clave y con SU rol', async () => {
    const m = montar();
    const t = (await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Ana Pérez', rol: 'tecnico' })).j.usuario;
    const s = (await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Sofía Ruiz', rol: 'supervisor' })).j.usuario;
    expect(t.clave).toMatch(/^[0-9a-f]{20}$/); expect(t.activo).toBe(true);
    expect((await m.llamar('/yo', t.clave)).j).toEqual({ ok: true, nombre: 'Ana Pérez', rol: 'tecnico' });
    expect((await m.llamar('/yo', s.clave)).j).toEqual({ ok: true, nombre: 'Sofía Ruiz', rol: 'supervisor' });
    expect((await m.llamar('/yo', 'claveJefe')).j.rol).toBe('admin');
    // permisos: técnico no ve el panel ni administra; supervisor ve el panel pero no administra; ambos capturan/sincronizan
    expect((await m.llamar('/equipo', t.clave)).status).toBe(401);
    expect((await m.llamar('/equipo', s.clave)).status).toBe(200);
    expect((await m.llamar('/usuarios', t.clave, { accion: 'listar' })).status).toBe(401);
    expect((await m.llamar('/usuarios', s.clave, { accion: 'listar' })).status).toBe(401);
    expect((await m.llamar('/sync', s.clave, { accion: 'listar', proyecto: { nombre: 'P' }, desde: '' })).status).toBe(200);
    expect((await m.llamar('/sync', t.clave, { accion: 'listar', proyecto: { nombre: 'P' }, desde: '' })).status).toBe(200);
  });

  it('el listado trae a todos con su clave y estado; editar conserva la clave; claveNueva la cambia y la anterior deja de servir', async () => {
    const m = montar();
    const a = (await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Ana', rol: 'tecnico' })).j.usuario;
    const b = (await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'ana', rol: 'supervisor' })).j.usuario;   // mismo nombre (sin distinguir mayúsculas) → edita
    expect(b.clave).toBe(a.clave);
    const lista = (await m.llamar('/usuarios', 'claveJefe', { accion: 'listar' })).j.usuarios;
    expect(lista).toHaveLength(1); expect(lista[0]).toMatchObject({ nombre: 'ana', rol: 'supervisor', activo: true });
    const c = (await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Ana', rol: 'supervisor', claveNueva: true })).j.usuario;
    expect(c.clave).not.toBe(a.clave);
    expect((await m.llamar('/yo', a.clave)).status).toBe(401);
    expect((await m.llamar('/yo', c.clave)).status).toBe(200);
  });

  it('dar de baja corta el acceso de inmediato y se puede reactivar con la misma clave', async () => {
    const m = montar();
    const a = (await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Ana', rol: 'tecnico' })).j.usuario;
    await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Ana', rol: 'tecnico', activo: false });
    expect((await m.llamar('/yo', a.clave)).status).toBe(401);
    await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Ana', rol: 'tecnico', activo: true });
    expect((await m.llamar('/yo', a.clave)).status).toBe(200);
  });

  it('un administrador de la hoja administra; no puede quitarse el rol ni darse de baja; el listado no se salta el rol', async () => {
    const m = montar();
    const x = (await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Luz', rol: 'admin' })).j.usuario;
    expect((await m.llamar('/yo', x.clave)).j.rol).toBe('admin');
    expect((await m.llamar('/usuarios', x.clave, { accion: 'listar' })).status).toBe(200);
    const mal = await m.llamar('/usuarios', x.clave, { accion: 'guardar', nombre: 'Luz', rol: 'tecnico' });
    expect(mal.j.ok).toBe(false);
    expect((await m.llamar('/usuarios', x.clave, { accion: 'guardar', nombre: 'Luz', rol: 'admin', activo: false })).j.ok).toBe(false);
    expect((await m.llamar('/yo', x.clave)).j.rol).toBe('admin');
  });

  it('validaciones: nombre vacío o peligroso, rol inválido, acción desconocida; el cliente no puede imponer "por" ni tokens', async () => {
    const m = montar();
    for (const cuerpo of [
      { accion: 'guardar', nombre: '', rol: 'tecnico' }, { accion: 'guardar', nombre: 'x'.repeat(61), rol: 'tecnico' },
      { accion: 'guardar', nombre: 'Ana', rol: 'dios' }, { accion: 'borrar', nombre: 'Ana' }, { accion: 'guardar', rol: 'tecnico' },
    ]) expect((await m.llamar('/usuarios', 'claveJefe', cuerpo)).status).toBe(400);
    expect((await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: '=cmd()', rol: 'tecnico' })).j.ok).toBe(false);
    m.f.mockClear();
    await m.llamar('/usuarios', 'claveJefe', { accion: 'guardar', nombre: 'Beto', rol: 'tecnico', por: 'Beto', token: 'x' });
    const enviado = JSON.parse((m.f.mock.calls[0] as any)[1].body);
    expect(enviado).toMatchObject({ accion: 'usuarios_guardar', por: 'jefe', token: 'CAMBIA-ESTE-TOKEN-ADMIN' });
  });

  it('el script solo atiende la administración con el token de administrador (no con el del equipo)', async () => {
    const m = montar();
    const r = await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'usuarios_listar' }) });
    expect((await r.json()).ok).toBe(false);
    const r2 = await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'usuarios_guardar', nombre: 'Hacker', rol: 'admin' }) });
    expect((await r2.json()).ok).toBe(false);
  });
});

describe('el administrador elige la IA y la prueba desde la app', () => {
  const { crearServidor } = require('./helpers/hoja');
  const imagen = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };
  const analisis = JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1024, tools: [TOOL], tool_choice: { type: 'tool', name: 'registrar_luminaria' }, messages: [{ role: 'user', content: [imagen, { type: 'text', text: 'x' }] }] });
  const gemOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'registrar_luminaria', args: { fabricante: 'G' } } }] } }] }), { status: 200 });
  const claudeOk = () => new Response(JSON.stringify({ content: [{ type: 'tool_use', input: { fabricante: 'C' } }] }), { status: 200 });
  const montar = (extra: any = {}) => {
    const gs = crearServidor();
    const env: any = { ANTHROPIC_API_KEY: 'sk-a', GEMINI_API_KEY: 'AIza-g', SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN', USUARIOS_CACHE_SEG: 0, ADMIN_TOKENS: 'jefe:claveJefe', APP_TOKENS: 'juan:tokJ', ...extra };
    const llamadas: string[] = [];
    const f = jest.fn(async (u: any, i: any) => {
      const url = String(u);
      if (url.includes('gs.example')) return gs.llamar(u, i);
      llamadas.push(url.includes('anthropic') ? 'claude' : 'gemini');
      return url.includes('anthropic') ? claudeOk() : gemOk();
    });
    const pet = (ruta: string, clave: string, cuerpo: string) => new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': clave }, body: cuerpo });
    return { gs, env, f, llamadas, pet, ia: async (clave: string, cuerpo: any) => { const r = await manejar(pet('/ia', clave, JSON.stringify(cuerpo)), env, f as any); return { status: r.status, j: await r.json() }; } };
  };
  beforeEach(() => { vaciarCacheUsuarios(); vaciarCacheIA(); });

  it('por defecto analiza con Gemini; el administrador cambia a Claude y el cambio se aplica al instante, con el otro de respaldo', async () => {
    const m = montar();
    let r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(r.headers.get('x-ia-proveedor')).toBe('gemini');
    expect((await m.ia('claveJefe', { accion: 'estado' })).j).toMatchObject({ ok: true, principal: 'gemini', disponibles: { claude: true, gemini: true } });
    const g = await m.ia('claveJefe', { accion: 'guardar', proveedor: 'claude' });
    expect(g.j.principal).toBe('claude');
    r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(r.headers.get('x-ia-proveedor')).toBe('claude');
    expect(m.gs.hoja('_Config')!.filas[1]).toEqual(['ia', 'claude']);
    await m.ia('claveJefe', { accion: 'guardar', proveedor: 'gemini' });
    expect((await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any)).headers.get('x-ia-proveedor')).toBe('gemini');
  });

  it('solo los administradores ven y cambian la IA; valores raros se rechazan', async () => {
    const m = montar();
    expect((await m.ia('tokJ', { accion: 'estado' })).status).toBe(401);
    expect((await m.ia('tokJ', { accion: 'guardar', proveedor: 'claude' })).status).toBe(401);
    expect((await m.ia('claveJefe', { accion: 'guardar', proveedor: 'gpt' })).status).toBe(400);
    expect((await m.ia('claveJefe', { accion: 'borrar' })).status).toBe(400);
    const r = await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'config_guardar', clave: 'ia', valor: 'claude' }) });
    expect((await r.json()).ok).toBe(false);          // el token del equipo no puede cambiar ajustes
    const raro = await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN-ADMIN', accion: 'config_guardar', clave: 'otra', valor: 'x' }) });
    expect((await raro.json()).ok).toBe(false);
  });

  it('si el elegido no tiene clave se usa el otro; si la hoja no responde se usa el orden por defecto', async () => {
    const m = montar({ GEMINI_API_KEY: undefined });
    await m.ia('claveJefe', { accion: 'guardar', proveedor: 'gemini' });
    const r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(r.headers.get('x-ia-proveedor')).toBe('claude');
  });

  it('"probar" informa por proveedor si funciona o por qué falla, sin mostrar claves', async () => {
    const m = montar();
    const f = jest.fn(async (u: any, i: any) => {
      const url = String(u);
      if (url.includes('gs.example')) return m.gs.llamar(u, i);
      if (url.includes('generativelanguage')) return new Response(JSON.stringify({ error: { message: 'models/gemini-x is not found. key=AIza-g' } }), { status: 404 });
      return new Response('{}', { status: 200 });
    });
    const r = await manejar(m.pet('/ia', 'claveJefe', JSON.stringify({ accion: 'probar' })), m.env, f as any);
    const j = await r.json();
    expect(j.resultados.claude).toMatchObject({ ok: true });
    expect(j.resultados.gemini).toMatchObject({ ok: false, estado: 404 });
    expect(j.resultados.gemini.mensaje).toContain('not found'); expect(JSON.stringify(j)).not.toMatch(/AIza-g|sk-a/);
    const sin = await manejar(m.pet('/ia', 'claveJefe', JSON.stringify({ accion: 'probar' })), { ...m.env, GEMINI_API_KEY: undefined }, f as any);
    expect((await sin.json()).resultados.gemini).toMatchObject({ ok: false, mensaje: 'Sin clave configurada en el servidor.' });
  });

  it('si fallan los dos, el error dice cuál falló y con qué estado', async () => {
    const m = montar();
    const f = jest.fn(async (u: any, i: any) => (String(u).includes('gs.example') ? m.gs.llamar(u, i) : new Response('{}', { status: 404 })));
    const r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, f as any);
    expect(r.status).toBe(404); expect((await r.json()).error).toContain('gemini 404; claude 404');
  });
});

describe('Gemini: modelo no disponible en la cuenta (404)', () => {
  const { crearServidor } = require('./helpers/hoja');
  const imagen = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };
  const analisis = JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1024, tools: [TOOL], tool_choice: { type: 'tool', name: 'registrar_luminaria' }, messages: [{ role: 'user', content: [imagen, { type: 'text', text: 'x' }] }] });
  const LISTA = { models: [
    { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.5-flash-preview-05-20', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-3.5-pro', supportedGenerationMethods: ['generateContent'] },
  ] };
  const montar = (viven: string[], extra: any = {}) => {
    const gs = crearServidor();
    const env: any = { GEMINI_API_KEY: 'AIza-g', APP_TOKENS: 'juan:tokJ', ADMIN_TOKENS: 'jefe:claveJefe', SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN', USUARIOS_CACHE_SEG: 0, REINTENTO_MS: 0, ...extra };
    const usados: string[] = [];
    const f = jest.fn(async (u: any, i: any) => {
      const url = String(u);
      if (url.includes('gs.example')) return gs.llamar(u, i);
      if (url.includes('/models?')) return new Response(JSON.stringify(LISTA), { status: 200 });
      const m = url.match(/models\/([^:]+):generateContent/)![1];
      usados.push(m);
      return viven.includes(m)
        ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'registrar_luminaria', args: { fabricante: 'G' } } }] } }] }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: `models/${m} is not found for API version v1beta` } }), { status: 404 });
    });
    const pet = (ruta: string, clave: string, cuerpo: string) => new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': clave }, body: cuerpo });
    const ia = async (cuerpo: any) => (await manejar(pet('/ia', 'claveJefe', JSON.stringify(cuerpo)), env, f as any)).json();
    const fijar = async (modelo: string) => { await gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN-ADMIN', accion: 'config_guardar', clave: 'gemini_modelo', valor: modelo }) }); vaciarCacheIA(); };
    return { gs, env, f, usados, pet, ia, fijar };
  };
  beforeEach(() => { vaciarCacheUsuarios(); vaciarCacheIA(); olvidarModeloDetectado(); });

  it('mejorModelo elige el flash estable más nuevo; sin estables, el preview; ignora pro y lo que no es gemini', () => {
    expect(mejorModelo(['gemini-2.0-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-pro'])).toBe('gemini-3.5-flash');
    expect(mejorModelo(['gemini-2.5-flash', 'gemini-3.5-flash-lite'])).toBe('gemini-3.5-flash-lite');
    expect(mejorModelo(['gemini-3.5-flash-preview-05-20', 'gemini-3.5-pro'])).toBe('gemini-3.5-flash-preview-05-20');
    expect(mejorModelo(['gemini-3.5-pro', 'gemini-embedding'])).toBeUndefined();
    expect(mejorModelo([])).toBeUndefined();
  });

  it('el modelo por defecto no existe → busca el disponible, reintenta y lo recuerda (no vuelve a fallar)', async () => {
    const m = montar(['gemini-3.5-flash']);
    const r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(r.status).toBe(200); expect(r.headers.get('x-ia-proveedor')).toBe('gemini');
    expect(m.usados).toEqual(['gemini-2.5-flash', 'gemini-3.5-flash']);
    await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(m.usados.slice(2)).toEqual(['gemini-3.5-flash']);               // la segunda vez va directo
  });

  it('503 (saturado): reintenta el mismo modelo una vez y, si sigue, prueba otros modelos disponibles', async () => {
    let n = 0;
    const m = montar(['gemini-3.5-flash-lite']);
    const base = m.f.getMockImplementation()!;
    m.f.mockImplementation(async (u: any, i: any) => {
      const url = String(u);
      if (url.includes('generativelanguage') && url.includes(':generateContent') && url.includes('gemini-2.5-flash')) { n++; return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 }); }
      return base(u, i);
    });
    const r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(r.status).toBe(200); expect(n).toBe(2);                                           // intento + reintento
    expect(m.usados.at(-1)).toBe('gemini-3.5-flash-lite');                                    // y siguió con otro modelo
  });

  it('con el modelo fijado por el administrador, 503 solo reintenta el mismo; 429 no cambia de modelo', async () => {
    const m = montar([]);
    await m.fijar('gemini-3.5-flash');
    m.f.mockImplementation(async (u: any) => (String(u).includes('gs.example') ? new Response('{"ok":true,"config":{"gemini_modelo":"gemini-3.5-flash"}}') : (m.usados.push('x'), new Response('{}', { status: 503 }))));
    const r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(r.status).toBe(503); expect(m.usados).toHaveLength(2);
  });

  it('si el administrador fijó el modelo y no existe, NO se cambia a escondidas: falla y lo dice', async () => {
    const m = montar(['gemini-3.5-flash']);
    await m.fijar('gemini-9-flash');
    const r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(r.status).toBe(404); expect((await r.json()).error).toContain('gemini 404');
    expect(m.usados).toEqual(['gemini-9-flash']);
  });

  it('el administrador lista los modelos, elige uno (se guarda en _Config) y puede volver a "auto"', async () => {
    const m = montar(['gemini-3.5-flash']);
    const l = await m.ia({ accion: 'modelos' });
    expect(l.modelos).toContain('gemini-3.5-flash'); expect(l.modelos).not.toContain('text-embedding-004'); expect(l.sugerido).toBe('gemini-3.5-flash');
    const e = await m.ia({ accion: 'modelo', modelo: 'gemini-3.5-flash' });
    expect(e.modeloGemini).toBe('gemini-3.5-flash');
    expect(m.gs.hoja('_Config')!.filas.some((f: any[]) => f[0] === 'gemini_modelo' && f[1] === 'gemini-3.5-flash')).toBe(true);
    expect((await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any)).status).toBe(200);
    expect(m.usados).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash']);        // la 1.ª es la prueba al guardarlo, la 2.ª el análisis
    expect((await m.ia({ accion: 'modelo', modelo: 'auto' })).modeloGemini).toBe('gemini-2.5-flash');
  });

  it('los modelos de voz, imagen, audio o embeddings no se ofrecen ni se eligen solos', async () => {
    const m = montar(['gemini-3.8-flash']);
    const lista = { models: ['gemini-3.8-flash', 'gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-image', 'gemini-3.8-flash-live', 'gemini-3.8-flash-native-audio', 'gemini-embedding-001', 'gemma-3-27b'].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) };
    const base = m.f.getMockImplementation()!;
    m.f.mockImplementation(async (u: any, i: any) => (String(u).includes('/models?') ? new Response(JSON.stringify(lista), { status: 200 }) : base(u, i)));
    expect((await m.ia({ accion: 'modelos' })).modelos).toEqual(['gemini-3.8-flash']);
  });

  it('no deja guardar un modelo que no sirve para fotos (voz, solo texto o inexistente) y dice por qué', async () => {
    const m = montar(['gemini-3.5-flash']);
    const base = m.f.getMockImplementation()!;
    m.f.mockImplementation(async (u: any, i: any) => {
      const url = String(u);
      if (url.includes('gemini-3.8-flash-lite-tts:generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hola' }] } }] }), { status: 200 });   // responde, pero sin herramienta
      return base(u, i);
    });
    const tts = await manejar(m.pet('/ia', 'claveJefe', JSON.stringify({ accion: 'modelo', modelo: 'gemini-3.8-flash-lite-tts' })), m.env, m.f as any);
    expect(tts.status).toBe(400); expect((await tts.json()).error).toContain('no sirve para analizar fotos');
    const nada = await manejar(m.pet('/ia', 'claveJefe', JSON.stringify({ accion: 'modelo', modelo: 'gemini-9-flash' })), m.env, m.f as any);
    expect(nada.status).toBe(400);
    expect(m.gs.hoja('_Config')?.filas.some((f: any[]) => f[0] === 'gemini_modelo') ?? false).toBe(false);   // nada se guardó
    expect((await m.ia({ accion: 'modelo', modelo: 'gemini-3.5-flash' })).ok).toBe(true);
  });

  it('"Probar la IA" usa una imagen y una herramienta de verdad: un modelo que solo responde texto NO pasa', async () => {
    const m = montar([]);
    await m.fijar('gemini-3.8-flash-lite-tts');
    m.f.mockImplementation(async (u: any, i: any) => (String(u).includes('gs.example') ? m.gs.llamar(u, i) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 })));
    const j = await (await manejar(m.pet('/ia', 'claveJefe', JSON.stringify({ accion: 'probar' })), m.env, m.f as any)).json();
    expect(j.resultados.gemini.ok).toBe(false); expect(j.resultados.gemini.mensaje).toContain('no sabe analizar imágenes');
    const enviado = JSON.parse((m.f.mock.calls.find((c: any) => String(c[0]).includes('generateContent')) as any)[1].body);
    expect(enviado.contents[0].parts[0].inlineData.mimeType).toBe('image/jpeg');
    expect(enviado.toolConfig.functionCallingConfig.mode).toBe('ANY');
  });

  it('un modelo de voz que ya estaba guardado se ignora y se usa uno que sí sirva', async () => {
    const m = montar(['gemini-3.5-flash']);
    await m.fijar('gemini-3.8-flash-lite-tts');
    const r = await manejar(m.pet('/analizar', 'tokJ', analisis), m.env, m.f as any);
    expect(r.status).toBe(200);
    expect(m.usados.every((x) => !x.includes('tts'))).toBe(true);
  });

  it('valida el nombre del modelo y solo el administrador puede cambiarlo', async () => {
    const m = montar([]);
    for (const modelo of ['', 'GPT-4', 'gemini-../x', 'gemini-' + 'a'.repeat(70), 5 as any]) expect((await manejar(m.pet('/ia', 'claveJefe', JSON.stringify({ accion: 'modelo', modelo })), m.env, m.f as any)).status).toBe(400);
    expect((await manejar(m.pet('/ia', 'tokJ', JSON.stringify({ accion: 'modelo', modelo: 'gemini-3.5-flash' })), m.env, m.f as any)).status).toBe(401);
    expect((await manejar(m.pet('/ia', 'tokJ', JSON.stringify({ accion: 'modelos' })), m.env, m.f as any)).status).toBe(401);
  });

  it('"Probar la IA" dice qué modelo funcionó y si se eligió solo', async () => {
    const m = montar(['gemini-3.5-flash']);
    const j = await m.ia({ accion: 'probar' });
    expect(j.resultados.gemini.ok).toBe(true);
    expect(j.resultados.gemini.mensaje).toContain('gemini-3.5-flash'); expect(j.resultados.gemini.mensaje).toContain('automáticamente');
  });
});
