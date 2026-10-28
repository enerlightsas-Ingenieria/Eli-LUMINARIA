import { aEnlace, codificar, decodificar, describir } from '../src/lib/config';
import { olvidarIntentos, identificar, manejar, validarCuerpo, vaciarCacheUsuarios, vaciarCacheIA, olvidarModeloDetectado, mejorModelo, aGemini, deGemini, proveedores } from '../server/worker';
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
  const hojas = (respuesta: any = { ok: true }) => jest.fn().mockImplementation(async () => new Response(JSON.stringify(respuesta), { status: 200 }));
  const cuerpoEnviado = (f: jest.Mock) => JSON.parse((f.mock.calls[f.mock.calls.length - 1] as any)[1].body);   // la última: antes puede haber consultas internas (política de fotos)

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
    expect(h.filas[2][2]).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/); expect(h.filas[3][2]).toBe('fija');
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
    expect(t.clave).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/); expect(t.activo).toBe(true);
    expect((await m.llamar('/yo', t.clave)).j).toMatchObject({ ok: true, nombre: 'Ana Pérez', rol: 'tecnico', terceros: false });
    expect((await m.llamar('/yo', s.clave)).j).toMatchObject({ ok: true, nombre: 'Sofía Ruiz', rol: 'supervisor' });
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

describe('ingreso con usuario y clave (sin enlaces)', () => {
  const { crearServidor } = require('./helpers/hoja');
  const montar = (extra: any = {}) => {
    const gs = crearServidor();
    const env: any = { SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN', USUARIOS_CACHE_SEG: 0, ADMIN_TOKENS: 'Jefe:claveJefe99', ...extra };
    const f = jest.fn((u: any, i: any) => gs.llamar(u, i));
    const post = async (ruta: string, cuerpo: any, clave = '', ip = '1.1.1.1') => {
      const r = await manejar(new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': clave, 'cf-connecting-ip': ip }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }), env, f as any);
      return { status: r.status, j: await r.json() };
    };
    const crear = (o: any) => post('/usuarios', { accion: 'guardar', ...o }, 'claveJefe99');
    return { gs, env, f, post, crear };
  };
  beforeEach(() => { vaciarCacheUsuarios(); olvidarIntentos(); });

  it('el administrador crea el usuario con una clave que él escribe y la persona entra con usuario + clave', async () => {
    const m = montar();
    const c = await m.crear({ nombre: 'Carla Gómez', rol: 'tecnico', clave: 'sol-2026-azul' });
    expect(c.j.usuario).toMatchObject({ nombre: 'Carla Gómez', clave: 'sol-2026-azul', terceros: false });
    const ok = await m.post('/ingresar', { usuario: 'carla gomez', clave: 'sol-2026-azul' });      // sin mayúsculas ni acentos
    expect(ok.status).toBe(200);
    expect(ok.j).toMatchObject({ ok: true, nombre: 'Carla Gómez', rol: 'tecnico', terceros: false });
    expect((await m.post('/yo', {}, 'sol-2026-azul')).j.nombre).toBe('Carla Gómez');                // y esa clave sigue siendo la credencial de la app
  });

  it('si no escribe clave, se genera una fácil de teclear (xxxxx-xxxxx) que sirve para entrar', async () => {
    const m = montar();
    const u = (await m.crear({ nombre: 'Beto', rol: 'supervisor' })).j.usuario;
    expect(u.clave).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
    const r = await m.post('/ingresar', { usuario: ' BETO ', clave: u.clave });
    expect(r.j).toMatchObject({ ok: true, nombre: 'Beto', rol: 'supervisor' });
  });

  it('usuario o clave equivocados, baja o clave de otra persona: el mismo mensaje genérico (no revela si el usuario existe)', async () => {
    const m = montar();
    await m.crear({ nombre: 'Ana', rol: 'tecnico', clave: 'clave-de-ana' });
    await m.crear({ nombre: 'Luis', rol: 'tecnico', clave: 'clave-de-luis' });
    const casos = [{ usuario: 'Ana', clave: 'mala-clave' }, { usuario: 'Nadie', clave: 'clave-de-ana' }, { usuario: 'Ana', clave: 'clave-de-luis' }, { usuario: 'Nadie', clave: 'x' }];
    for (const c of casos) { const r = await m.post('/ingresar', c); expect(r.status).toBe(401); expect(r.j.error).toBe('Usuario o clave incorrectos.'); }
    await m.crear({ nombre: 'Ana', rol: 'tecnico', activo: false });
    expect((await m.post('/ingresar', { usuario: 'Ana', clave: 'clave-de-ana' })).status).toBe(401);
  });

  it('valida lo que se escribe: campos vacíos, tipos raros y tamaños', async () => {
    const m = montar();
    for (const c of [{}, { usuario: 'a' }, { usuario: '', clave: 'x' }, { usuario: 5, clave: 'x' }, { usuario: 'a'.repeat(81), clave: 'x' }, { usuario: 'a', clave: 'x'.repeat(101) }]) expect((await m.post('/ingresar', c)).status).toBe(400);
    expect((await m.post('/ingresar', '{no json')).status).toBe(400);
  });

  it('frena la adivinanza de claves: tras 8 fallos seguidos bloquea ese usuario desde esa conexión, y otra conexión no se ve afectada', async () => {
    const m = montar();
    await m.crear({ nombre: 'Ana', rol: 'tecnico', clave: 'clave-de-ana' });
    for (let i = 0; i < 8; i++) expect((await m.post('/ingresar', { usuario: 'Ana', clave: 'mala' + i })).status).toBe(401);
    expect((await m.post('/ingresar', { usuario: 'Ana', clave: 'clave-de-ana' })).status).toBe(429);      // ni la correcta pasa mientras dure el bloqueo
    expect((await m.post('/ingresar', { usuario: 'Ana', clave: 'clave-de-ana' }, '', '9.9.9.9')).status).toBe(200);
  });

  it('un acierto borra los fallos previos; los secretos nombre:clave también sirven para entrar', async () => {
    const m = montar({ APP_TOKENS: 'Juan:tokJ123' });
    for (let i = 0; i < 5; i++) await m.post('/ingresar', { usuario: 'Jefe', clave: 'mala' + i });
    expect((await m.post('/ingresar', { usuario: 'jefe', clave: 'claveJefe99' })).j).toMatchObject({ ok: true, nombre: 'Jefe', rol: 'admin' });
    for (let i = 0; i < 7; i++) await m.post('/ingresar', { usuario: 'Jefe', clave: 'mala' + i });
    expect((await m.post('/ingresar', { usuario: 'Jefe', clave: 'claveJefe99' })).status).toBe(200);        // 7 fallos nuevos < 8: no hay bloqueo
    expect((await m.post('/ingresar', { usuario: 'Juan', clave: 'tokJ123' })).j).toMatchObject({ ok: true, rol: 'tecnico' });
  });

  it('contratista (terceros) lo decide el administrador y viaja al entrar; también los proyectos que ya existen en la hoja', async () => {
    const m = montar();
    await m.crear({ nombre: 'Tercero Uno', rol: 'tecnico', clave: 'clave-tercero', terceros: true });
    await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'listar', proyecto: { nombre: 'Barrio A' }, desde: '' }) });
    await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'listar', proyecto: { nombre: 'Zona Norte' }, desde: '' }) });
    const r = await m.post('/ingresar', { usuario: 'tercero uno', clave: 'clave-tercero' });
    expect(r.j.terceros).toBe(true);
    expect(r.j.proyectos.sort()).toEqual(['Barrio A', 'Zona Norte']);
    expect((await m.post('/yo', {}, 'clave-tercero')).j).toMatchObject({ terceros: true });
  });

  it('claves manuales: mínimo 8, sin espacios, distintas del nombre y no repetidas entre personas', async () => {
    const m = montar();
    for (const clave of ['corta', 'con espacio 123', 'x'.repeat(65)]) expect((await m.crear({ nombre: 'Ana', rol: 'tecnico', clave })).status).toBe(400);
    expect((await m.crear({ nombre: 'Ana Maria', rol: 'tecnico', clave: 'ana maria'.replace(' ', '') })).j.ok).toBe(true);
    expect((await m.crear({ nombre: 'Luis Perez', rol: 'tecnico', clave: 'luis perez'.replace(' ', '') + '1' })).j.ok).toBe(true);
    await m.crear({ nombre: 'Uno', rol: 'tecnico', clave: 'misma-clave-1' });
    expect((await m.crear({ nombre: 'Dos', rol: 'tecnico', clave: 'misma-clave-1' })).j.ok).toBe(false);   // repetida
    expect((await m.crear({ nombre: 'Maria  Lopez', rol: 'tecnico' })).j.ok).toBe(true);
    expect((await m.crear({ nombre: 'maría lopez', rol: 'tecnico' })).j.usuario.nombre).toBe('maría lopez'); // mismo nombre normalizado = misma persona (se edita)
    expect((await m.post('/usuarios', { accion: 'listar' }, 'claveJefe99')).j.usuarios.filter((u: any) => /lopez/i.test(u.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))).toHaveLength(1);
  });
});

describe('usuario aparte del nombre, autor sellado por el servidor y fotos', () => {
  const { crearServidor } = require('./helpers/hoja');
  const montar = (extra: any = {}) => {
    const gs = crearServidor();
    const env: any = { SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN', USUARIOS_CACHE_SEG: 0, ADMIN_TOKENS: 'Jefe:claveJefe99', ...extra };
    const f = jest.fn((u: any, i: any) => gs.llamar(u, i));
    const post = async (ruta: string, cuerpo: any, clave = '') => {
      const r = await manejar(new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': clave, 'cf-connecting-ip': '2.2.2.2' }, body: JSON.stringify(cuerpo) }), env, f as any);
      return { status: r.status, j: await r.json() };
    };
    const crear = (o: any) => post('/usuarios', { accion: 'guardar', ...o }, 'claveJefe99');
    return { gs, env, f, post, crear };
  };
  beforeEach(() => { vaciarCacheUsuarios(); vaciarCacheIA(); olvidarIntentos(); });
  const subida = (l: any = {}) => ({ proyecto: { nombre: 'Barrio A' }, luminarias: [{ uuid: 'u1', fabricante: 'F', tecnico: 'Falso', usuario: 'falso', foto: 'FOTO64', ...l }], por: { usuario: 'falso', nombre: 'Falso' } });
  const fila = (m: any, uuid: string) => { const h = m.gs.hoja('Barrio A'); const cab = h.filas[0]; const f = h.filas.find((x: any[]) => x[0] === uuid); return Object.fromEntries(cab.map((c: string, i: number) => [c, f[i]])); };

  it('el usuario para entrar es distinto del nombre: se entra con el usuario, no con el nombre', async () => {
    const m = montar();
    const u = (await m.crear({ nombre: 'Juan Pérez', usuario: 'jperez', rol: 'tecnico', clave: 'clave-de-juan' })).j.usuario;
    expect(u).toMatchObject({ nombre: 'Juan Pérez', usuario: 'jperez' });
    expect((await m.post('/ingresar', { usuario: 'JPerez', clave: 'clave-de-juan' })).j).toMatchObject({ ok: true, nombre: 'Juan Pérez', usuario: 'jperez' });
    expect((await m.post('/ingresar', { usuario: 'Juan Pérez', clave: 'clave-de-juan' })).status).toBe(401);
    expect((await m.post('/yo', {}, 'clave-de-juan')).j).toMatchObject({ nombre: 'Juan Pérez', usuario: 'jperez' });
  });

  it('cuentas antiguas sin usuario siguen entrando con el nombre; el usuario no se repite y se valida', async () => {
    const m = montar();
    m.gs.gs.prepararUsuarios(); m.gs.hoja('_Usuarios').appendRow(['Ana Vieja', 'tecnico', 'clave-vieja-1', 'si', 'no']);
    expect((await m.post('/ingresar', { usuario: 'ana vieja', clave: 'clave-vieja-1' })).status).toBe(200);
    await m.crear({ nombre: 'Beto Uno', usuario: 'beto', rol: 'tecnico' });
    const otra = await m.crear({ nombre: 'Beto Dos', usuario: 'BETO', rol: 'tecnico' });            // mismo usuario = misma cuenta (se edita), no una nueva
    expect((await m.post('/usuarios', { accion: 'listar' }, 'claveJefe99')).j.usuarios.filter((x: any) => x.usuario.toLowerCase() === 'beto')).toHaveLength(1);
    expect(otra.j.usuario.nombre).toBe('Beto Dos');
    for (const usuario of ['a', '=cmd', '_x', 'x'.repeat(41)]) expect((await m.crear({ nombre: 'Cualquiera', usuario, rol: 'tecnico' })).status).toBe(400);
  });

  it('los administradores de Cloudflare aparecen como superusuarios (solo el nombre, nunca la clave)', async () => {
    const m = montar({ ADMIN_TOKENS: 'Jefe:claveJefe99,Dueña:otraClave77' });
    const l = (await m.post('/usuarios', { accion: 'listar' }, 'claveJefe99')).j;
    expect(l.superusuarios).toEqual(['Jefe', 'Dueña']);
    expect(JSON.stringify(l)).not.toMatch(/claveJefe99|otraClave77/);
  });

  it('el autor lo sella el servidor: el teléfono no puede declarar otro técnico ni otro usuario', async () => {
    const m = montar();
    const clave = (await m.crear({ nombre: 'Carla Gómez', usuario: 'cgomez', rol: 'tecnico' })).j.usuario.clave;
    expect((await m.post('/sync', subida(), clave)).j.ok).toBe(true);
    expect(fila(m, 'u1')).toMatchObject({ Técnico: 'Carla Gómez', Usuario: 'cgomez' });
  });

  it('al editar, el autor original se conserva aunque edite otra persona', async () => {
    const m = montar();
    const a = (await m.crear({ nombre: 'Carla Gómez', usuario: 'cgomez', rol: 'tecnico' })).j.usuario.clave;
    const b = (await m.crear({ nombre: 'Sofía Ruiz', usuario: 'sruiz', rol: 'supervisor' })).j.usuario.clave;
    await m.post('/sync', subida(), a);
    await m.post('/sync', subida({ fabricante: 'Editado por Sofía', tecnico: 'Sofía Ruiz', usuario: 'sruiz' }), b);
    expect(fila(m, 'u1')).toMatchObject({ Fabricante: 'Editado por Sofía', Técnico: 'Carla Gómez', Usuario: 'cgomez' });
  });

  it('quien usa un secreto nombre:clave queda registrado con ese nombre como usuario', async () => {
    const m = montar({ APP_TOKENS: 'Juan:tokJ123' });
    await m.post('/sync', subida({ tecnico: 'Otro' }), 'tokJ123');
    expect(fila(m, 'u1')).toMatchObject({ Técnico: 'Juan', Usuario: 'Juan' });
  });

  it('el administrador elimina usuarios: desaparecen de la lista y pierden el acceso al instante; sus registros se conservan', async () => {
    const m = montar();
    const clave = (await m.crear({ nombre: 'Carla Gómez', usuario: 'cgomez', rol: 'tecnico' })).j.usuario.clave;
    await m.crear({ nombre: 'Beto', usuario: 'beto', rol: 'tecnico' });
    await m.post('/sync', subida({ uuid: 'r1' }), clave);
    expect((await m.post('/usuarios', { accion: 'borrar', usuario: 'CGomez' }, 'claveJefe99')).j).toMatchObject({ ok: true, eliminado: 'cgomez' });
    const lista = (await m.post('/usuarios', { accion: 'listar' }, 'claveJefe99')).j.usuarios;
    expect(lista.map((u: any) => u.usuario)).toEqual(['beto']);
    expect((await m.post('/yo', {}, clave)).status).toBe(401);
    expect((await m.post('/ingresar', { usuario: 'cgomez', clave })).status).toBe(401);
    expect(fila(m, 'r1')).toMatchObject({ Técnico: 'Carla Gómez', Usuario: 'cgomez' });             // lo que registró se conserva
    expect((await m.post('/usuarios', { accion: 'borrar', usuario: 'cgomez' }, 'claveJefe99')).j.ok).toBe(false);   // ya no existe
  });

  it('no se puede eliminar a uno mismo; solo administradores; usuario inválido; el token del equipo no sirve en el script', async () => {
    const m = montar();
    const admin = (await m.crear({ nombre: 'Luz Admin', usuario: 'luz', rol: 'admin' })).j.usuario.clave;
    const tec = (await m.crear({ nombre: 'Ana', usuario: 'ana', rol: 'tecnico' })).j.usuario.clave;
    expect((await m.post('/usuarios', { accion: 'borrar', usuario: 'luz' }, admin)).j.ok).toBe(false);          // a sí misma
    expect((await m.post('/usuarios', { accion: 'borrar', usuario: 'ana' }, tec)).status).toBe(401);            // un técnico no
    for (const usuario of ['', 5, 'x'.repeat(41)]) expect((await m.post('/usuarios', { accion: 'borrar', usuario }, 'claveJefe99')).status).toBe(400);
    const r = await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'usuarios_borrar', usuario: 'ana' }) });
    expect((await r.json()).ok).toBe(false);
    expect((await m.post('/usuarios', { accion: 'listar' }, 'claveJefe99')).j.usuarios.map((u: any) => u.usuario).sort()).toEqual(['ana', 'luz']);
  });

  it('proyectos: solo el administrador los cambia; renombrar cambia la pestaña (no crea otra); desactivar los oculta; eliminar borra pestaña, fila y archivadas', async () => {
    const m = montar();
    const tec = (await m.crear({ nombre: 'Ana', usuario: 'ana', rol: 'tecnico' })).j.usuario.clave;
    const sup = (await m.crear({ nombre: 'Sara', usuario: 'sara', rol: 'supervisor' })).j.usuario.clave;
    const adm = 'claveJefe99';
    await m.post('/sync', subida(), tec);
    const yo = async (c = tec) => (await m.post('/yo', {}, c)).j;
    const [p] = (await yo()).proyectosInfo;
    expect(p).toMatchObject({ nombre: 'Barrio A', cliente: '', notas: '', activo: true });
    expect(p.id).toMatch(/^p[a-z0-9]{10}$/);
    expect((await yo()).proyectos).toEqual(['Barrio A']);                                  // los nombres siguen yendo (apps antiguas)

    // solo administradores
    for (const accion of [{ accion: 'eliminar_proyecto', id: p.id }, { accion: 'guardar_proyecto', id: p.id, nombre: 'X' }, { accion: 'activar_proyecto', id: p.id, activo: false }]) {
      for (const clave of [tec, sup]) expect((await m.post('/sistema', accion, clave)).status).toBe(401);
    }
    expect((await yo()).proyectosInfo[0].activo).toBe(true);

    // renombrar + cliente/notas: la MISMA pestaña cambia de nombre y no aparece ningún proyecto nuevo
    const g = await m.post('/sistema', { accion: 'guardar_proyecto', id: p.id, nombre: 'Barrio Nuevo', cliente: 'Soacha', notas: 'Fase 1' }, adm);
    expect(g.j.ok).toBe(true);
    expect((await yo()).proyectosInfo).toEqual([{ id: p.id, nombre: 'Barrio Nuevo', cliente: 'Soacha', notas: 'Fase 1', activo: true }]);
    expect(m.gs.hoja('Barrio A')).toBeUndefined(); expect(m.gs.hoja('Barrio Nuevo')!.filas).toHaveLength(2);
    // un teléfono con el nombre VIEJO pero el id no recrea el proyecto: sigue escribiendo en la pestaña renombrada
    await m.post('/sync', { proyecto: { nombre: 'Barrio A', id: p.id }, luminarias: [{ uuid: 'u2', fabricante: 'G', latitud: 1, longitud: 1 }] }, tec);
    expect(m.gs.hoja('Barrio A')).toBeUndefined(); expect(m.gs.hoja('Barrio Nuevo')!.filas).toHaveLength(3);
    expect((await yo()).proyectosInfo).toHaveLength(1);
    // nombres inválidos o repetidos
    await m.post('/sync', { proyecto: { nombre: 'Otro' }, luminarias: [{ uuid: 'o1', fabricante: 'F', latitud: 1, longitud: 1 }] }, tec);
    expect((await m.post('/sistema', { accion: 'guardar_proyecto', id: p.id, nombre: 'otro' }, adm)).j.error).toMatch(/Ya existe/);
    expect((await m.post('/sistema', { accion: 'guardar_proyecto', id: p.id, nombre: '  ' }, adm)).j.ok).toBe(false);
    expect((await m.post('/sistema', { accion: 'guardar_proyecto', id: 'p0000000000', nombre: 'Z' }, adm)).j.ok).toBe(false);

    // desactivar: deja de ofrecerse (nombres) pero sigue en la información y conserva sus datos
    expect((await m.post('/sistema', { accion: 'activar_proyecto', id: p.id, activo: false }, adm)).j.ok).toBe(true);
    const tras = await yo();
    expect(tras.proyectos).toEqual(['Otro']);
    expect(tras.proyectosInfo.find((x: any) => x.id === p.id).activo).toBe(false);
    expect(m.gs.hoja('Barrio Nuevo')!.filas).toHaveLength(3);
    await m.post('/sistema', { accion: 'activar_proyecto', id: p.id, activo: true }, adm);
    expect((await yo()).proyectos).toEqual(['Barrio Nuevo', 'Otro']);

    // eliminar: se borran la pestaña, la fila de _Proyectos y las pestañas archivadas del mismo proyecto
    const arch = m.gs.hojas.push(Object.assign(new (m.gs.hoja('Otro')!.constructor as any)('Barrio Nuevo (anterior)'), { filas: [['UUID']] }));
    expect(arch).toBeGreaterThan(0);
    expect((await m.post('/sistema', { accion: 'eliminar_proyecto', id: p.id }, adm)).j).toMatchObject({ ok: true, eliminado: true, hojas: 2 });
    expect(m.gs.hoja('Barrio Nuevo')).toBeUndefined(); expect(m.gs.hoja('Barrio Nuevo (anterior)')).toBeUndefined();
    expect((await yo()).proyectosInfo.map((x: any) => x.nombre)).toEqual(['Otro']);
    expect(m.gs.hoja('_Proyectos')!.filas.map((f: any[]) => f[1])).toEqual(['Nombre', 'Otro']);
    expect((await m.post('/sistema', { accion: 'eliminar_proyecto', id: p.id }, adm)).j).toMatchObject({ ok: true, eliminado: false });   // repetirlo no falla
    // el token del equipo no sirve en el script, ni se puede borrar una pestaña del sistema
    const script = await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', accion: 'proyecto_eliminar', id: 'x' }) });
    expect((await script.json()).ok).toBe(false);
    expect((await m.post('/sistema', { accion: 'eliminar_proyecto', nombre: '_Usuarios' }, adm)).j.ok).toBe(false);
    for (const mala of [{ accion: 'eliminar_proyecto' }, { accion: 'eliminar_proyecto', id: 'a b' }, { accion: 'guardar_proyecto', nombre: 'X' }, { accion: 'activar_proyecto', id: 'p1', activo: 'no' }]) expect((await m.post('/sistema', mala, adm)).status).toBe(400);
  });

  it('un script viejo en el servidor (sin información de proyectos): solo van los nombres', async () => {
    const m = montar();
    const tec = (await m.crear({ nombre: 'Ana', usuario: 'ana', rol: 'tecnico' })).j.usuario.clave;
    await m.post('/sync', subida(), tec);
    const yo = (await m.post('/yo', {}, tec)).j;
    expect(yo.proyectos).toEqual(['Barrio A']); expect(Array.isArray(yo.proyectosInfo)).toBe(true);
  });

  it('teléfono (WhatsApp): se guarda, se conserva al editar sin enviarlo, se puede cambiar o quitar, y se valida', async () => {
    const m = montar();
    const u = (await m.crear({ nombre: 'Ana', usuario: 'ana', rol: 'tecnico', telefono: '+57 300 123 4567' })).j.usuario;
    expect(u.telefono).toBe('+57 300 123 4567');
    expect((await m.crear({ nombre: 'Ana Pérez', usuario: 'ana', rol: 'tecnico' })).j.usuario.telefono).toBe('+57 300 123 4567');   // sin enviar → se conserva
    expect((await m.crear({ nombre: 'Ana Pérez', usuario: 'ana', rol: 'tecnico', telefono: '3009998888' })).j.usuario.telefono).toBe('3009998888');
    expect((await m.crear({ nombre: 'Ana Pérez', usuario: 'ana', rol: 'tecnico', telefono: '' })).j.usuario.telefono).toBe('');         // vacío → se quita
    for (const telefono of ['abc', '300; DROP', '1'.repeat(26), 5 as any]) expect((await m.crear({ nombre: 'X', usuario: 'xx', rol: 'tecnico', telefono })).status).toBe(400);
  });

  it('contactos: el técnico solo ve a quienes lo supervisan; supervisor y administrador ven a todos; nunca claves, bajas ni gente sin teléfono', async () => {
    const m = montar();
    const tec1 = (await m.crear({ nombre: 'Ana', usuario: 'ana', rol: 'tecnico', telefono: '3001111111' })).j.usuario.clave;
    await m.crear({ nombre: 'Beto', usuario: 'beto', rol: 'tecnico', telefono: '3002222222' });
    const sup = (await m.crear({ nombre: 'Sofía', usuario: 'sofia', rol: 'supervisor', telefono: '3003333333' })).j.usuario.clave;
    await m.crear({ nombre: 'Luz', usuario: 'luz', rol: 'admin', telefono: '3004444444' });
    await m.crear({ nombre: 'SinTel', usuario: 'sintel', rol: 'supervisor' });
    await m.crear({ nombre: 'Baja', usuario: 'baja', rol: 'supervisor', telefono: '3005555555', activo: false });

    const deAna = (await m.post('/contactos', {}, tec1)).j;
    expect(deAna.contactos.map((c: any) => c.usuario).sort()).toEqual(['luz', 'sofia']);          // supervisor y admin; no Beto, ni ella, ni sin teléfono, ni de baja
    const deSofia = (await m.post('/contactos', {}, sup)).j;
    expect(deSofia.contactos.map((c: any) => c.usuario).sort()).toEqual(['ana', 'beto', 'luz']);  // todos menos ella misma
    expect(JSON.stringify([deAna, deSofia])).not.toMatch(/clave/i);
    expect(deAna.contactos[0]).toEqual({ nombre: expect.any(String), usuario: expect.any(String), rol: expect.any(String), telefono: expect.any(String) });
    expect((await m.post('/contactos', {}, 'clave-que-no-existe')).status).toBe(401);
  });

  it('fotos: por defecto la primera foto se guarda en Drive; el administrador puede desactivarlo para todos y reactivarlo', async () => {
    const m = montar();
    const clave = (await m.crear({ nombre: 'Carla', usuario: 'carla', rol: 'tecnico' })).j.usuario.clave;
    expect((await m.post('/yo', {}, clave)).j.fotos).toBe(true);
    await m.post('/sync', subida({ uuid: 'f1' }), clave);
    expect(m.gs.fotosGuardadas).toEqual(['f1.jpg']);
    expect(fila(m, 'f1').Foto).toBe('https://drive.test/f1.jpg');

    expect((await m.post('/sistema', { accion: 'guardar', fotos: false }, 'claveJefe99')).j).toEqual({ ok: true, fotos: false });
    expect((await m.post('/yo', {}, clave)).j.fotos).toBe(false);
    await m.post('/sync', subida({ uuid: 'f2' }), clave);
    expect(m.gs.fotosGuardadas).toEqual(['f1.jpg']);                                                  // no se guardó ninguna más
    expect(fila(m, 'f2').Foto).toBe('');

    await m.post('/sistema', { accion: 'guardar', fotos: true }, 'claveJefe99');
    await m.post('/sync', subida({ uuid: 'f3' }), clave);
    expect(m.gs.fotosGuardadas).toEqual(['f1.jpg', 'f3.jpg']);
  });

  it('/sistema solo para administradores y con valores válidos', async () => {
    const m = montar();
    const tec = (await m.crear({ nombre: 'Carla', usuario: 'carla', rol: 'tecnico' })).j.usuario.clave;
    expect((await m.post('/sistema', { accion: 'estado' }, tec)).status).toBe(401);
    expect((await m.post('/sistema', { accion: 'estado' }, 'claveJefe99')).j).toEqual({ ok: true, fotos: true });
    for (const c of [{ accion: 'guardar', fotos: 'no' }, { accion: 'guardar' }, { accion: 'otra' }]) expect((await m.post('/sistema', c, 'claveJefe99')).status).toBe(400);
  });
});

describe('dirección de una coordenada y miniatura de la foto', () => {
  const { crearServidor } = require('./helpers/hoja');
  const { leerDireccion, olvidarDirecciones } = require('../server/worker');
  const nominatim = { address: { road: 'Carrera 7', house_number: '12-30', neighbourhood: 'La Candelaria', city: 'Bogotá' } };
  const montar = (extra: any = {}, nom: any = nominatim) => {
    const gs = crearServidor();
    const env: any = { APP_TOKENS: 'juan:tokJ', SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN', USUARIOS_CACHE_SEG: 0, ...extra };
    const visto: string[] = [];
    const f = jest.fn(async (u: any, i: any) => { const url = String(u); if (url.includes('gs.example')) return gs.llamar(u, i); visto.push(url); return new Response(JSON.stringify(nom), { status: 200 }); });
    const post = async (ruta: string, cuerpo: any, clave = 'tokJ') => { const r = await manejar(new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': clave }, body: JSON.stringify(cuerpo) }), env, f as any); return { status: r.status, j: await r.json() }; };
    return { gs, visto, post };
  };
  beforeEach(() => { vaciarCacheUsuarios(); vaciarCacheIA(); olvidarDirecciones(); });

  it('leerDireccion: calle y número, municipio; barrio aparte; con lo que haya', () => {
    expect(leerDireccion(nominatim)).toEqual({ direccion: 'Carrera 7 12-30, Bogotá', barrio: 'La Candelaria', municipio: 'Bogotá' });
    expect(leerDireccion({ address: { pedestrian: 'Peatonal 3', suburb: 'Centro', town: 'Soacha' } })).toEqual({ direccion: 'Peatonal 3, Soacha', barrio: 'Centro', municipio: 'Soacha' });
    expect(leerDireccion({ address: { village: 'La Vereda' } })).toEqual({ direccion: 'La Vereda', barrio: '', municipio: 'La Vereda' });
    expect(leerDireccion(null)).toEqual({ direccion: '', barrio: '', municipio: '' });
  });

  it('/direccion: pide a OpenStreetMap con la coordenada y se identifica; guarda la respuesta (el mismo tramo no vuelve a consultar); exige cuenta y coordenada válida', async () => {
    const m = montar();
    const r = await m.post('/direccion', { latitud: 4.711, longitud: -74.0721 });
    expect(r.j).toEqual({ ok: true, direccion: 'Carrera 7 12-30, Bogotá', barrio: 'La Candelaria', municipio: 'Bogotá' });
    expect(m.visto[0]).toMatch(/nominatim\.openstreetmap\.org\/reverse\?.*lat=4\.711&lon=-74\.0721/);
    await m.post('/direccion', { latitud: 4.71102, longitud: -74.07211 });          // a pocos metros: misma respuesta guardada
    expect(m.visto).toHaveLength(1);
    expect((await m.post('/direccion', { latitud: 4.711, longitud: -74.0721 }, 'mala')).status).toBe(401);
    for (const c of [{}, { latitud: 'x', longitud: 1 }, { latitud: 91, longitud: 0 }, { latitud: 0, longitud: 181 }]) expect((await m.post('/direccion', c)).status).toBe(400);
  });

  it('si el mapa falla, responde 502 (la app deja escribirla a mano)', async () => {
    const gs = crearServidor();
    const env: any = { APP_TOKENS: 'juan:tokJ', SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', USUARIOS_CACHE_SEG: 0 };
    const f = jest.fn(async (u: any, i: any) => (String(u).includes('gs.example') ? gs.llamar(u, i) : new Response('x', { status: 429 })));
    const r = await manejar(new Request('https://p.example/direccion', { method: 'POST', headers: { 'x-api-key': 'tokJ' }, body: JSON.stringify({ latitud: 1, longitud: 1 }) }), env, f as any);
    expect(r.status).toBe(502);
  });

  const subida = (l: any) => ({ proyecto: { nombre: 'Barrio A' }, luminarias: [{ uuid: 'u1', fabricante: 'F', latitud: 4.7, longitud: -74, barrio: 'Centro', ...l }] });
  const celda = (m: any, col: string) => { const h = m.gs.hoja('Barrio A'); return h.filas[1][h.filas[0].indexOf(col)]; };

  it('la miniatura viaja a la hoja y vuelve a todos; si se edita sin enviarla, se conserva; una inválida o demasiado grande se descarta', async () => {
    const m = montar();
    const mini = '/9j/4AAQSkZJRg' + 'A'.repeat(2000);
    expect((await m.post('/sync', subida({ miniatura: mini }))).j.ok).toBe(true);
    expect(celda(m, 'Miniatura (no editar)')).toBe(mini);
    expect(celda(m, 'Barrio')).toBe('Centro');
    const lista = (await m.post('/sync', { accion: 'listar', proyecto: { nombre: 'Barrio A' }, desde: '' })).j.luminarias;
    expect(lista[0]).toMatchObject({ uuid: 'u1', barrio: 'Centro', miniatura: mini });
    await m.post('/sync', subida({ fabricante: 'Otro' }));                                // editar sin miniatura
    expect(celda(m, 'Miniatura (no editar)')).toBe(mini);
    const n = montar();
    await n.post('/sync', subida({ miniatura: '<script>alert(1)</script>' }));
    expect(celda(n, 'Miniatura (no editar)')).toBe('');
    const g = montar();
    await g.post('/sync', subida({ miniatura: 'A'.repeat(40_001) }));
    expect(celda(g, 'Miniatura (no editar)')).toBe('');
  });

  it('si el administrador apaga las fotos, tampoco se guarda la miniatura', async () => {
    const m = montar({ ADMIN_TOKENS: 'jefe:claveJefe99' });
    await m.post('/sistema', { accion: 'guardar', fotos: false }, 'claveJefe99');
    await m.post('/sync', subida({ miniatura: '/9j/AAAA', foto: 'FOTO64' }));
    expect(celda(m, 'Miniatura (no editar)')).toBe('');
    expect(celda(m, 'Foto')).toBe('');
  });

  it('sin coordenada, la auditoría avisa con SIN_COORDENADA', async () => {
    const m = montar();
    await m.post('/sync', subida({ latitud: null, longitud: null }));
    expect(celda(m, 'Alertas')).toContain('SIN_COORDENADA');
  });
});

describe('otras IAs (Groq, OpenRouter, Mistral, Qwen, Kimi, ChatGPT, otra): compatibles con la API de ChatGPT', () => {
  const { crearServidor } = require('./helpers/hoja');
  const {
    aOpenAI, deOpenAI, PROVEEDORES, IDS_IA, ordenarModelosVision, olvidarModelosDetectados, olvidarClavesGuardadas,
  } = require('../server/worker');
  const imagen = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };
  const analisis = JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1024, tools: [TOOL], tool_choice: { type: 'tool', name: 'registrar_luminaria' }, messages: [{ role: 'user', content: [imagen, { type: 'text', text: 'Foto general:' }] }] });
  const llamadaOk = (args: any = { fabricante: 'Schréder', tecnologia: 'LED', confianza: 'alta' }) =>
    new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'registrar_luminaria', arguments: JSON.stringify(args) } }] } }] }), { status: 200 });

  const montar = (extra: any = {}, comportamiento: (url: string, init: any) => Response | undefined = () => undefined) => {
    const gs = crearServidor();
    const env: any = { APP_TOKENS: 'juan:tokJ', ADMIN_TOKENS: 'jefe:claveJefe99', SYNC_URL: 'https://gs.example/exec', SYNC_TOKEN: 'CAMBIA-ESTE-TOKEN', SYNC_TOKEN_ADMIN: 'CAMBIA-ESTE-TOKEN-ADMIN', USUARIOS_CACHE_SEG: 0, REINTENTO_MS: 0, ...extra };
    const visto: { url: string; init: any }[] = [];
    const f = jest.fn(async (u: any, i: any) => {
      const url = String(u);
      if (url.includes('gs.example')) return gs.llamar(u, i);
      visto.push({ url, init: i });
      return comportamiento(url, i) ?? new Response('{"error":{"message":"sin simular"}}', { status: 500 });
    });
    const pet = (ruta: string, clave: string, cuerpo: string) => new Request('https://p.example' + ruta, { method: 'POST', headers: { 'x-api-key': clave }, body: cuerpo });
    const ia = async (cuerpo: any) => { const r = await manejar(pet('/ia', 'claveJefe99', JSON.stringify(cuerpo)), env, f as any); return { status: r.status, j: await r.json() }; };
    const analizar = async () => manejar(pet('/analizar', 'tokJ', analisis), env, f as any);
    return { gs, env, f, visto, ia, analizar };
  };
  beforeEach(() => { vaciarCacheUsuarios(); vaciarCacheIA(); olvidarModeloDetectado(); olvidarModelosDetectados(); olvidarClavesGuardadas(); });

  it('el registro trae los proveedores pedidos y deja claro cuáles son gratis; DeepSeek/Perplexity/Copilot no están porque no sirven para fotos', () => {
    expect(IDS_IA).toEqual(['gemini', 'claude', 'groq', 'openrouter', 'mistral', 'qwen', 'kimi', 'openai', 'otra']);
    expect(PROVEEDORES.filter((p: any) => p.gratis).map((p: any) => p.id)).toEqual(['gemini', 'groq', 'openrouter', 'mistral']);
    for (const p of PROVEEDORES) { expect(p.nombre).toBeTruthy(); expect(p.donde).toBeTruthy(); if (p.tipo === 'openai' && p.id !== 'otra') expect(p.base).toMatch(/^https:\/\//); }
  });

  it('proveedores(): solo los que tienen clave; "otra" además necesita su dirección; el elegido va primero y el resto de respaldo', () => {
    const env = { GROQ_API_KEY: 'g', MISTRAL_API_KEY: 'm', GEMINI_API_KEY: 'x', OTRA_API_KEY: 'o' };
    expect(proveedores(env)).toEqual(['gemini', 'groq', 'mistral']);                                    // "otra" sin dirección no cuenta
    expect(proveedores({ ...env, OTRA_BASE_URL: 'https://api.otra.example/v1' })).toEqual(['gemini', 'groq', 'mistral', 'otra']);
    expect(proveedores(env, 'mistral')).toEqual(['mistral', 'gemini', 'groq']);
    expect(proveedores({ ...env, ORDEN_IA: 'groq,gemini' })).toEqual(['groq', 'gemini']);
    expect(proveedores(env, 'inventada' as any)).toEqual(['gemini', 'groq', 'mistral']);
  });

  it('aOpenAI: mismas fotos como data URL, la herramienta como función y la llamada forzada', () => {
    const b = aOpenAI(JSON.parse(analisis), 'mi-modelo');
    expect(b.model).toBe('mi-modelo');
    expect(b.messages[0].content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
    expect(b.messages[0].content[1]).toEqual({ type: 'text', text: 'Foto general:' });
    expect(b.tools[0].function.name).toBe('registrar_luminaria');
    expect(Object.keys(b.tools[0].function.parameters.properties)).toEqual(Object.keys(TOOL.input_schema.properties));
    expect(b.tool_choice).toEqual({ type: 'function', function: { name: 'registrar_luminaria' } });
  });

  it('deOpenAI: lee la llamada a la función; acepta el JSON escrito en el texto; ignora lo demás', () => {
    expect(deOpenAI(JSON.parse(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'registrar_luminaria', arguments: '{"fabricante":"X"}' } }] } }] }))))
      .toEqual({ content: [{ type: 'tool_use', name: 'registrar_luminaria', input: { fabricante: 'X' } }] });
    expect(deOpenAI({ choices: [{ message: { content: 'Aquí está: {"fabricante":"Y","confianza":"alta"} listo' } }] }).content[0].input).toEqual({ fabricante: 'Y', confianza: 'alta' });
    for (const malo of [null, {}, { choices: [] }, { choices: [{ message: { content: 'sin datos' } }] }, { choices: [{ message: { tool_calls: [{ function: { arguments: '{no json' } }] } }] }]) expect(deOpenAI(malo)).toBeNull();
  });

  it('ordenarModelosVision: primero los que dicen aceptar imágenes, luego los que lo parecen; sin voz ni embeddings; ":free" antes', () => {
    const o = ordenarModelosVision([
      { id: 'whisper-large-v3' }, { id: 'text-embedding-3' }, { id: 'llama-3.1-8b' }, { id: 'meta-llama/llama-4-scout-17b' },
      { id: 'a/solo-texto', vision: false }, { id: 'b/con-vision', vision: true }, { id: 'c/vision:free', vision: true },
    ]).map((m: any) => m.id);
    expect(o.slice(0, 3)).toEqual(['c/vision:free', 'b/con-vision', 'meta-llama/llama-4-scout-17b']);
    expect(o).not.toContain('whisper-large-v3'); expect(o).not.toContain('text-embedding-3');
  });

  it('analiza con Groq: usa su dirección, la clave como Bearer y el modelo por defecto; la respuesta llega con la forma de siempre', async () => {
    const m = montar({ GROQ_API_KEY: 'gsk_clave_larga' }, (url) => (url.includes('api.groq.com') ? llamadaOk() : undefined));
    const r = await m.analizar();
    expect(r.status).toBe(200); expect(r.headers.get('x-ia-proveedor')).toBe('groq');
    expect((await r.json()).content[0]).toEqual({ type: 'tool_use', name: 'registrar_luminaria', input: { fabricante: 'Schréder', tecnologia: 'LED', confianza: 'alta' } });
    const v = m.visto[0];
    expect(v.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(v.init.headers.authorization).toBe('Bearer gsk_clave_larga');
    expect(JSON.parse(v.init.body).model).toBe('qwen/qwen3.6-27b');
  });

  it('cadena de respaldo: si la principal falla se prueba la siguiente con clave, sea de la familia que sea', async () => {
    const m = montar({ GEMINI_API_KEY: 'g-clave-1', GROQ_API_KEY: 'gsk_clave_larga', MISTRAL_API_KEY: 'mis_clave_larga' }, (url) => {
      if (url.includes('generativelanguage')) return new Response('{"error":{"message":"quota"}}', { status: 429 });
      if (url.includes('groq')) return new Response('{"error":{"message":"rate limit"}}', { status: 429 });
      if (url.includes('mistral')) return llamadaOk();
      return undefined;
    });
    const r = await m.analizar();
    expect(r.headers.get('x-ia-proveedor')).toBe('mistral');
    const quien = m.visto.map((v) => (v.url.includes('generativelanguage') ? 'gemini' : v.url.includes('groq') ? 'groq' : v.url.includes('mistral') ? 'mistral' : 'otro'));
    expect(quien.filter((x, i) => quien.indexOf(x) === i)).toEqual(['gemini', 'groq', 'mistral']);
  });

  it('si fallan todas, el error dice cuál falló y por qué, sin mostrar claves', async () => {
    const m = montar({ GROQ_API_KEY: 'gsk_clave_larga' }, () => new Response('{"error":{"message":"invalid api key gsk_clave_larga"}}', { status: 401 }));
    const r = await m.analizar();
    const t = await r.text();
    expect(t).toContain('groq 401: invalid api key'); expect(t).not.toContain('gsk_clave_larga');
  });

  it('el administrador pega la clave de un proveedor DESDE LA APP: se prueba, se guarda en el script (no en la hoja), se usa y nunca vuelve a mostrarse', async () => {
    const m = montar({}, (url) => (url.includes('api.groq.com/openai/v1/chat') ? llamadaOk() : undefined));
    expect((await m.ia({ accion: 'estado' })).j.proveedores.find((p: any) => p.id === 'groq')).toMatchObject({ configurado: false, origenClave: null });
    const r = await m.ia({ accion: 'clave', proveedor: 'groq', clave: 'gsk_pegada_desde_la_app' });
    expect(r.status).toBe(200);
    expect(r.j.proveedores.find((p: any) => p.id === 'groq')).toMatchObject({ configurado: true, origenClave: 'app' });
    expect(r.j.prueba).toMatchObject({ ok: true });
    expect(JSON.stringify(r.j)).not.toContain('gsk_pegada_desde_la_app');
    expect(m.gs.propiedades.get('IA_KEY_groq')).toBe('gsk_pegada_desde_la_app');
    expect(JSON.stringify(m.gs.hojas.map((h: any) => h.filas))).not.toContain('gsk_pegada_desde_la_app');   // en ninguna celda
    const a = await m.analizar();
    expect(a.headers.get('x-ia-proveedor')).toBe('groq');
    expect(m.visto.at(-1)!.init.headers.authorization).toBe('Bearer gsk_pegada_desde_la_app');
    const q = await m.ia({ accion: 'clave', proveedor: 'groq', clave: '' });                         // quitarla
    expect(q.j.proveedores.find((p: any) => p.id === 'groq').configurado).toBe(false);
    expect(m.gs.propiedades.has('IA_KEY_groq')).toBe(false);
  });

  it('una clave que el proveedor rechaza (401/403) no se guarda; formato inválido, proveedor desconocido y secretos de Cloudflare se tratan aparte', async () => {
    const m = montar({ GEMINI_API_KEY: 'gem-del-servidor' }, (url) => (url.includes('groq') ? new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 }) : undefined));
    const mala = await m.ia({ accion: 'clave', proveedor: 'groq', clave: 'gsk_clave_equivocada' });
    expect(mala.status).toBe(400); expect(mala.j.error).toContain('rechazó la clave');
    expect(m.gs.propiedades.has('IA_KEY_groq')).toBe(false);
    for (const clave of ['corta', 'con espacio dentro 123', 5 as any]) expect((await m.ia({ accion: 'clave', proveedor: 'groq', clave })).status).toBe(400);
    expect((await m.ia({ accion: 'clave', proveedor: 'deepseek', clave: 'abcdefghij' })).status).toBe(400);
    const quitar = await m.ia({ accion: 'clave', proveedor: 'gemini', clave: '' });                  // viene de Cloudflare: no se quita desde la app
    expect(quitar.status).toBe(400); expect(quitar.j.error).toContain('Cloudflare');
    expect((await m.ia({ accion: 'estado' })).j.proveedores.find((p: any) => p.id === 'gemini')).toMatchObject({ configurado: true, origenClave: 'servidor' });
  });

  it('solo los administradores: ni el técnico en /ia ni el token del equipo en el script pueden leer o guardar claves', async () => {
    const m = montar();
    const tec = await manejar(new Request('https://p.example/ia', { method: 'POST', headers: { 'x-api-key': 'tokJ' }, body: JSON.stringify({ accion: 'clave', proveedor: 'groq', clave: 'gsk_clave_larga' }) }), m.env, m.f as any);
    expect(tec.status).toBe(401);
    for (const accion of [{ accion: 'ia_claves' }, { accion: 'ia_clave_guardar', proveedor: 'groq', clave: 'gsk_clave_larga' }]) {
      const r = await m.gs.llamar('', { body: JSON.stringify({ token: 'CAMBIA-ESTE-TOKEN', ...accion }) });
      expect((await r.json()).ok).toBe(false);
    }
    expect(m.gs.propiedades.size).toBe(0);
  });

  it('modelos: se listan los de visión primero (OpenRouter informa las modalidades) y se puede elegir uno, que se prueba antes de guardar y conserva mayúsculas', async () => {
    const lista = { data: [
      { id: 'google/gemini-x:free', architecture: { input_modalities: ['text', 'image'] } }, { id: 'meta/solo-texto', architecture: { input_modalities: ['text'] } },
      { id: 'Qwen/Qwen2.5-VL-72B-Instruct', architecture: { input_modalities: ['text', 'image'] } },
    ] };
    const m = montar({ OPENROUTER_API_KEY: 'sk-or-clave-larga' }, (url, init) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify(lista), { status: 200 });
      if (url.endsWith('/chat/completions')) return JSON.parse(init.body).model === 'meta/solo-texto' ? new Response('{"error":{"message":"image input not supported"}}', { status: 400 }) : llamadaOk();
      return undefined;
    });
    const l = (await m.ia({ accion: 'modelos', proveedor: 'openrouter' })).j;
    expect(l.modelos[0]).toBe('google/gemini-x:free');                                                   // visión + gratis primero
    expect(l.modelos.indexOf('Qwen/Qwen2.5-VL-72B-Instruct')).toBeLessThan(l.modelos.indexOf('meta/solo-texto'));
    const malo = await m.ia({ accion: 'modelo', proveedor: 'openrouter', modelo: 'meta/solo-texto' });
    expect(malo.status).toBe(400); expect(malo.j.error).toContain('no sirve para analizar fotos');
    expect(m.gs.hoja('_Config')?.filas.some((f: any[]) => String(f[0]).startsWith('modelo_'))).toBeFalsy();
    const ok = await m.ia({ accion: 'modelo', proveedor: 'openrouter', modelo: 'Qwen/Qwen2.5-VL-72B-Instruct' });
    expect(ok.status).toBe(200);
    expect(m.gs.hoja('_Config')!.filas.some((f: any[]) => f[0] === 'modelo_openrouter' && f[1] === 'Qwen/Qwen2.5-VL-72B-Instruct')).toBe(true);
    await m.ia({ accion: 'guardar', proveedor: 'openrouter' });
    await m.analizar();
    expect(JSON.parse(m.visto.at(-1)!.init.body).model).toBe('Qwen/Qwen2.5-VL-72B-Instruct');             // usa el elegido, con sus mayúsculas
    await m.ia({ accion: 'modelo', proveedor: 'openrouter', modelo: 'auto' });                            // volver a automático
    expect((await m.ia({ accion: 'estado' })).j.proveedores.find((p: any) => p.id === 'openrouter').modelo).not.toBe('Qwen/Qwen2.5-VL-72B-Instruct');
  });

  it('sin modelo por defecto (OpenRouter) o con uno que ya no existe (Groq): busca uno de visión en la lista del proveedor y lo recuerda', async () => {
    const m = montar({ OPENROUTER_API_KEY: 'sk-or-clave-larga', GROQ_API_KEY: 'gsk_clave_larga', ORDEN_IA: 'openrouter' }, (url, init) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'x/texto', architecture: { input_modalities: ['text'] } }, { id: 'x/ve-imagenes', architecture: { input_modalities: ['image', 'text'] } }] }), { status: 200 });
      if (url.endsWith('/chat/completions')) return JSON.parse(init.body).model === 'x/ve-imagenes' ? llamadaOk() : new Response('{"error":{"message":"The model does not exist"}}', { status: 404 });
      return undefined;
    });
    const r = await m.analizar();
    expect(r.status).toBe(200); expect(r.headers.get('x-ia-proveedor')).toBe('openrouter');
    const modelos = m.visto.filter((v) => v.url.endsWith('/chat/completions')).map((v) => JSON.parse(v.init.body).model);
    expect(modelos).toEqual(['x/ve-imagenes']);                                                        // sin modelo por defecto: fue directo al de visión
    await m.analizar();
    expect(m.visto.filter((v) => v.url.endsWith('/chat/completions')).map((v) => JSON.parse(v.init.body).model)).toEqual(['x/ve-imagenes', 'x/ve-imagenes']);   // recordado
  });

  it('caso real de Groq: si el modelo por defecto no está disponible, NUNCA se prueba a ciegas un modelo de voz (orpheus, playai, whisper…); solo candidatos de visión', async () => {
    const lista = { data: [{ id: 'canopylabs/orpheus-arabic-saudi' }, { id: 'playai-tts' }, { id: 'whisper-large-v3' }, { id: 'llama-3.1-8b-instant' }, { id: 'meta-llama/llama-4-maverick-17b-128e-instruct' }] };
    const m = montar({ GROQ_API_KEY: 'gsk_clave_larga' }, (url, init) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify(lista), { status: 200 });
      if (url.endsWith('/chat/completions')) return JSON.parse(init.body).model === 'meta-llama/llama-4-maverick-17b-128e-instruct' ? llamadaOk() : new Response('{"error":{"message":"The model `x` does not exist or requires terms acceptance"}}', { status: 404 });
      return undefined;
    });
    const r = await m.analizar();
    expect(r.status).toBe(200);
    const probados = m.visto.filter((v) => v.url.endsWith('/chat/completions')).map((v) => JSON.parse(v.init.body).model);
    expect(probados).toEqual(['qwen/qwen3.6-27b', 'meta-llama/llama-4-maverick-17b-128e-instruct']);
    for (const malo of ['orpheus', 'playai', 'whisper', 'llama-3.1-8b-instant']) expect(probados.join()).not.toContain(malo);
    const sug = (await m.ia({ accion: 'modelos', proveedor: 'groq' })).j;
    expect(sug.sugerido).toBe('meta-llama/llama-4-maverick-17b-128e-instruct');
    expect(sug.modelos.slice(0, 1)).toEqual(['meta-llama/llama-4-maverick-17b-128e-instruct']);
    expect(sug.modelos.join()).not.toMatch(/orpheus|playai|whisper/);
  });

  it('un modelo que rechaza la herramienta forzada se reintenta con tool_choice "auto"; y el rechazo del probar/elegir muestra el motivo real del proveedor', async () => {
    const m = montar({ GROQ_API_KEY: 'gsk_clave_larga' }, (url, init) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-27b' }] }), { status: 200 });
      if (!url.endsWith('/chat/completions')) return undefined;
      const b = JSON.parse(init.body);
      if (b.model.includes('gpt-oss')) return new Response('{"error":{"message":"content must be a string (images unsupported)"}}', { status: 400 });
      return typeof b.tool_choice === 'object' ? new Response('{"error":{"message":"tool_choice with a named function is not supported with reasoning"}}', { status: 400 }) : llamadaOk();
    });
    const ok = await m.ia({ accion: 'modelo', proveedor: 'groq', modelo: 'qwen/qwen3.8-27b' });
    expect(ok.status).toBe(200);
    const mal = await m.ia({ accion: 'modelo', proveedor: 'groq', modelo: 'openai/gpt-oss-20b' });
    expect(mal.status).toBe(400); expect(mal.j.error).toContain('images unsupported');
  });

  it('un modelo que responde en prosa en vez de usar la herramienta: se reintenta pidiendo solo JSON y entonces sirve', async () => {
    let n = 0;
    const m = montar({ OPENROUTER_API_KEY: 'sk-or-clave-larga' }, (url, init) => {
      if (!url.endsWith('/chat/completions')) return undefined;
      n++;
      const txt = JSON.stringify(JSON.parse(init.body).messages[0].content);
      return txt.includes('SOLO con un objeto JSON') ? new Response(JSON.stringify({ choices: [{ message: { content: '{"fabricante":"Philips","confianza":"media"}' } }] }), { status: 200 })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'Veo una imagen gris.' } }] }), { status: 200 });
    });
    const r = await m.ia({ accion: 'modelo', proveedor: 'openrouter', modelo: 'nvidia/nemotron-3.5-super-vl:free' });
    expect(r.status).toBe(200); expect(n).toBe(2);
  });

  it('si el proveedor no ofrece ningún modelo que parezca de visión: no se adivina, se muestra el error real del modelo por defecto', async () => {
    const m = montar({ GROQ_API_KEY: 'gsk_clave_larga' }, (url) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'canopylabs/orpheus-arabic-saudi' }, { id: 'llama-3.1-8b-instant' }] }), { status: 200 });
      if (url.endsWith('/chat/completions')) return new Response('{"error":{"message":"The model `meta-llama/llama-4-scout-17b-16e-instruct` requires terms acceptance. Please accept at console.groq.com"}}', { status: 400 });
      return undefined;
    });
    const r = await m.analizar();
    const t = await r.text();
    expect(t).toContain('requires terms acceptance');                                                    // el motivo real, no el de un modelo cualquiera
    expect(m.visto.filter((v) => v.url.endsWith('/chat/completions'))).toHaveLength(1);                   // solo se intentó el por defecto
    const p = (await m.ia({ accion: 'probar', proveedor: 'groq' })).j.resultados.groq;
    expect(p.ok).toBe(false); expect(p.mensaje).toContain('requires terms acceptance');
  });

  it('"otra compatible con OpenAI": exige una dirección https, la usa tal cual (con sus mayúsculas) y se prueba como los demás', async () => {
    const m = montar({}, (url, init) => (url.startsWith('https://api.mio.example/v1/chat/completions') ? llamadaOk() : url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: 'Mi-Modelo-VL' }] }), { status: 200 }) : undefined));
    expect((await m.ia({ accion: 'clave', proveedor: 'otra', clave: 'clave-de-otra-123' })).j.error).toContain('dirección');   // sin dirección no se puede
    for (const base of ['http://inseguro.example/v1', 'api.sin.https', 'https://con espacio']) expect((await m.ia({ accion: 'base', base })).status).toBe(400);
    expect((await m.ia({ accion: 'base', base: 'https://api.mio.example/v1/' })).status).toBe(200);
    const c = await m.ia({ accion: 'clave', proveedor: 'otra', clave: 'clave-de-otra-123' });
    expect(c.status).toBe(200); expect(c.j.proveedores.find((p: any) => p.id === 'otra')).toMatchObject({ configurado: true, base: 'https://api.mio.example/v1' });
    await m.ia({ accion: 'guardar', proveedor: 'otra' });
    const r = await m.analizar();
    expect(r.headers.get('x-ia-proveedor')).toBe('otra');
    expect(m.visto.at(-1)!.url).toBe('https://api.mio.example/v1/chat/completions');
    expect(JSON.parse(m.visto.at(-1)!.init.body).model).toBe('Mi-Modelo-VL');                          // sin modelo definido → el único de la lista
  });

  it('elegir como principal cualquiera de la lista; uno desconocido se rechaza; el aviso de "no configurada" ya no habla de variables', async () => {
    const m = montar({ GROQ_API_KEY: 'gsk_clave_larga' }, (url) => (url.includes('groq') ? llamadaOk() : undefined));
    expect((await m.ia({ accion: 'guardar', proveedor: 'groq' })).j.principal).toBe('groq');
    expect((await m.ia({ accion: 'guardar', proveedor: 'deepseek' })).status).toBe(400);
    const sin = montar();
    const r = await sin.analizar();
    expect(r.status).toBe(503); expect((await r.json()).error).toContain('Administración');
  });

  it('"Probar" recorre todos los que tienen clave y dice qué pasó con cada uno; un modelo que no acepta imágenes no pasa', async () => {
    const m = montar({ GROQ_API_KEY: 'gsk_clave_larga', MISTRAL_API_KEY: 'mis_clave_larga' }, (url) => {
      if (url.includes('groq')) return llamadaOk();
      if (url.includes('mistral')) return new Response(JSON.stringify({ choices: [{ message: { content: 'hola' } }] }), { status: 200 });   // responde texto, sin datos
      return undefined;
    });
    const j = (await m.ia({ accion: 'probar' })).j.resultados;
    expect(j.groq).toMatchObject({ ok: true }); expect(j.groq.mensaje).toContain('Funciona con el modelo');
    expect(j.mistral).toMatchObject({ ok: false }); expect(j.mistral.mensaje).toContain('acepta imágenes');
    expect(j.openai).toMatchObject({ ok: false, mensaje: 'Sin clave configurada en el servidor.' });
    expect(Object.keys(j)).toEqual(IDS_IA);
    const uno = (await m.ia({ accion: 'probar', proveedor: 'groq' })).j.resultados;
    expect(Object.keys(uno)).toEqual(['groq']);
  });
});
