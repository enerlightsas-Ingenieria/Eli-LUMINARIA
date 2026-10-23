const mockAjustes = { apiKey: 'sk-test', endpoint: 'https://api.anthropic.com/v1/messages', modelo: 'claude-sonnet-5-5', syncUrl: 'https://script.example/exec', syncToken: 'tok', syncFotos: false, tema: 'auto' };
jest.mock('../src/services/settings', () => ({ cargarAjustes: async () => ({ ...mockAjustes }) }));
const mockPend: any[] = [];
const mockMarcadas: string[] = [];
jest.mock('../src/services/db', () => ({
  pendientesDeSync: async () => mockPend,
  marcarSincronizadas: async (u: { uuid: string }[]) => { mockMarcadas.push(...u.map((x) => x.uuid)); },
  borradasPendientes: async () => [], limpiarBorradas: async () => {}, leerKv: async () => null, guardarKv: async () => {},
  fusionarRemotas: async () => ({ nuevas: 0, actualizadas: 0, borradas: 0 }), listarProyectos: async () => [],
}));
jest.mock('../src/services/fotos', () => ({ leerBase64: async () => 'BASE64' }));

import { analizarFotos } from '../src/services/analyzer';
import { validarCuerpo } from '../server/worker';
import { sincronizar } from '../src/services/sync';

const resp = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as any;

describe('analizarFotos', () => {
  afterEach(() => { (global as any).fetch = undefined; mockAjustes.apiKey = 'sk-test'; });

  it('envía las imágenes y mapea la herramienta a características', async () => {
    const f = jest.fn().mockResolvedValue(resp(200, { content: [{ type: 'tool_use', input: { marca: ' Philips ', potenciaW: '150', pinesFotocelda: '7', tecnologia: 'LED', confianza: 'alta' } }] }));
    (global as any).fetch = f;
    const r = await analizarFotos(['AAA', 'BBB']);
    expect(r.confianza).toBe('alta');
    expect(r.caracteristicas).toMatchObject({ marca: 'Philips', potenciaW: '150', pinesFotocelda: '7', modelo: '' });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.messages[0].content.filter((c: any) => c.type === 'image')).toHaveLength(2);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'registrar_luminaria' });
    expect(f.mock.calls[0][1].headers['x-api-key']).toBe('sk-test');
  });

  it('el proxy acepta exactamente la petición real que arma la app', async () => {
    const f = jest.fn().mockResolvedValue(resp(200, { content: [{ type: 'tool_use', input: { confianza: 'alta' } }] }));
    (global as any).fetch = f;
    await analizarFotos(['AAA', 'BBB', 'CCC']);
    const real = f.mock.calls[0][1].body;
    expect(validarCuerpo(real, ['claude-sonnet-5-5'])).toMatchObject({ ok: true });
    expect(JSON.parse(real).messages[0].content.filter((c: any) => c.type === 'text').reduce((n: number, c: any) => n + c.text.length, 0)).toBeLessThan(5000);
  });

  it('confianza desconocida cae a "baja"', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(resp(200, { content: [{ type: 'tool_use', input: { confianza: 'rara' } }] }));
    expect((await analizarFotos(['A'])).confianza).toBe('baja');
  });

  it('sin API key falla con mensaje claro y sin llamar a la red', async () => {
    mockAjustes.apiKey = ''; const f = jest.fn(); (global as any).fetch = f;
    await expect(analizarFotos(['A'])).rejects.toThrow(/API key/);
    expect(f).not.toHaveBeenCalled();
  });

  it('401 → mensaje de clave inválida', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(resp(401, { error: 'x' }));
    await expect(analizarFotos(['A'])).rejects.toThrow(/401/);
  });

  it('sin red no reintenta: falla enseguida con mensaje para trabajar a mano', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    (global as any).fetch = f;
    await expect(analizarFotos(['A'])).rejects.toThrow(/Sin señal suficiente/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('con señal muy débil se rinde a los 25 s (no a los 2 minutos)', async () => {
    jest.useFakeTimers();
    const f = jest.fn((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('abortado')))));
    (global as any).fetch = f;
    const p = analizarFotos(['A']).catch((e) => e);
    await jest.advanceTimersByTimeAsync(25001);
    expect(await p).toMatchObject({ message: expect.stringMatching(/Sin señal suficiente/) });
    expect(f).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('el técnico puede omitir el análisis a mitad de camino', async () => {
    const ctl = new AbortController();
    (global as any).fetch = (_u: string, init: any) => new Promise((_res, rej) => {
      if (init.signal.aborted) return rej(new Error('abortado')); // como el fetch real
      init.signal.addEventListener('abort', () => rej(new Error('abortado')));
    });
    const p = analizarFotos(['A'], ctl.signal).catch((e) => e);
    ctl.abort();
    expect(await p).toMatchObject({ message: expect.stringMatching(/Análisis omitido/) });
  });

  it('reintenta una vez ante 529', async () => {
    jest.useFakeTimers();
    const f = jest.fn().mockResolvedValueOnce(resp(529, {})).mockResolvedValueOnce(resp(200, { content: [{ type: 'tool_use', input: { marca: 'X', confianza: 'media' } }] }));
    (global as any).fetch = f;
    const p = analizarFotos(['A']);
    await jest.advanceTimersByTimeAsync(2000);
    expect((await p).caracteristicas.marca).toBe('X');
    expect(f).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe('sincronizar', () => {
  const proyecto = { id: 1, uuid: 'p1', nombre: 'General', cliente: '', notas: '', creadoEn: '' };
  beforeEach(() => { mockPend.length = 0; mockMarcadas.length = 0; });
  afterEach(() => { (global as any).fetch = undefined; });

  it('envía por lotes, usa uuid y marca como sincronizadas sólo las confirmadas', async () => {
    for (let i = 0; i < 20; i++) mockPend.push({ uuid: `u${i}`, id: i, fotos: ['file:///a.jpg'] });
    const f = jest.fn().mockResolvedValue(resp(200, { ok: true }));
    (global as any).fetch = f;
    const r = await sincronizar(proyecto);
    expect(r.enviadas).toBe(20);
    expect(f).toHaveBeenCalledTimes(3); // lotes de 15 + 5, y la descarga del equipo
    const b = JSON.parse(f.mock.calls[0][1].body);
    expect(b.token).toBe('tok'); expect(b.proyecto.uuid).toBe('p1'); expect(b.luminarias[0].foto).toBeUndefined();
    expect(mockMarcadas).toHaveLength(20);
  });

  it('si el servidor rechaza, no marca nada y reporta el error', async () => {
    mockPend.push({ uuid: 'u1', id: 1, fotos: [] });
    (global as any).fetch = jest.fn().mockResolvedValue(resp(200, { ok: false, error: 'Token inválido' }));
    await expect(sincronizar(proyecto)).rejects.toThrow('Token inválido');
    expect(mockMarcadas).toHaveLength(0);
  });

  it('un corte de red a mitad deja el resto pendiente', async () => {
    for (let i = 0; i < 20; i++) mockPend.push({ uuid: `u${i}`, id: i, fotos: [] });
    (global as any).fetch = jest.fn().mockResolvedValueOnce(resp(200, { ok: true })).mockRejectedValueOnce(new Error('net'));
    await expect(sincronizar(proyecto)).rejects.toThrow(/15 de 20/);
    expect(mockMarcadas).toHaveLength(15);
  });
});

describe('sincronizarTodo (automática)', () => {
  it('respeta autoSync=false y no toca la red', async () => {
    jest.resetModules();
    jest.doMock('../src/services/settings', () => ({ cargarAjustes: async () => ({ syncUrl: 'https://x.example', autoSync: false, syncToken: '', syncFotos: false }) }));
    jest.doMock('../src/services/db', () => ({ listarProyectos: async () => [], pendientesDeSync: async () => [], marcarSincronizadas: async () => {} }));
    const { sincronizarTodo } = require('../src/services/sync');
    const f = jest.fn(); (global as any).fetch = f;
    expect(await sincronizarTodo()).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it('envía los pendientes de cada proyecto y evita ejecuciones simultáneas', async () => {
    jest.resetModules();
    jest.doMock('../src/services/settings', () => ({ cargarAjustes: async () => ({ syncUrl: 'https://x.example', autoSync: true, syncToken: 't', syncFotos: false }) }));
    const marcadas: string[] = [];
    jest.doMock('../src/services/db', () => ({
      listarProyectos: async () => [{ id: 1, uuid: 'p1', nombre: 'A' }, { id: 2, uuid: 'p2', nombre: 'B' }],
      pendientesDeSync: async (id: number) => (id === 1 ? [{ uuid: 'a1', fotos: [] }, { uuid: 'a2', fotos: [] }] : []),
      marcarSincronizadas: async (u: { uuid: string }[]) => { marcadas.push(...u.map((x) => x.uuid)); },
      borradasPendientes: async () => [], limpiarBorradas: async () => {}, leerKv: async () => null, guardarKv: async () => {},
      fusionarRemotas: async () => ({ nuevas: 0, actualizadas: 0, borradas: 0 }),
    }));
    jest.doMock('../src/services/fotos', () => ({ leerBase64: async () => '' }));
    const { sincronizarTodo } = require('../src/services/sync');
    (global as any).fetch = jest.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return resp(200, { ok: true }); });
    const [x, y] = await Promise.all([sincronizarTodo(), sincronizarTodo()]);
    expect([x, y].sort()).toEqual([0, 2]); // la segunda llamada simultánea se ignora
    expect(marcadas).toEqual(['a1', 'a2']);
  });
});
