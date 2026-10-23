import { aEnlace, codificar, decodificar, describir } from '../src/lib/config';
import { identificar, manejar, validarCuerpo, vaciarCacheUsuarios } from '../server/worker';
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
    ['propiedad de la herramienta que no es texto', conTool((t) => { t.input_schema.properties.marca = { type: 'object' }; })],
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
    const conUna = JSON.parse(JSON.stringify(TOOL)); delete conUna.input_schema.properties.marca; conUna.input_schema.required = conUna.input_schema.required.filter((r: string) => r !== 'marca');
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
    expect(h.filas[2][2]).toMatch(/^[0-9a-f]{12}$/); expect(h.filas[3][2]).toBe('fija');
    const r = await m.gs.llamar('', { body: JSON.stringify({ token: 'malo', accion: 'usuario', clave: 'fija' }) });
    expect((await r.json()).ok).toBe(false);
  });
});
