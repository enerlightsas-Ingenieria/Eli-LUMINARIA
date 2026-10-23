import { Ajustes } from './ajustes';
import { Posicion } from './tipos';

/**
 * Jornada de trabajo (monitoreo del equipo, voluntario y visible):
 *  - El técnico la inicia, pausa o termina él mismo.
 *  - Solo mientras está ACTIVA y con la app abierta se envía: ubicación aproximada, hora y n.º de luminarias.
 *  - En pausa o terminada NO se envía ubicación. Una jornada olvidada se cierra sola a las 14 h.
 */
export type FaseJornada = 'ninguna' | 'activa' | 'pausada' | 'terminada';

export interface EstadoJornada {
  id: string;
  fase: FaseJornada;
  inicio: string;
  /** Un cambio de estado (pausa/fin) que aún no llegó al servidor; se reintenta. */
  sinEnviar: boolean;
  /** Hora real en que se terminó (puede enviarse horas después si no había señal). */
  fin?: string;
  /** Versión del estado: cada cambio la sube; un envío atrasado no puede borrar un cambio más nuevo. */
  rev?: number;
}

/** Jornada terminada sin señal cuyo cierre aún no llegó al servidor, y que ya fue reemplazada por otra. */
export interface CierrePendiente { id: string; inicio: string; fin: string }

export const INTERVALO_MS = 5 * 60 * 1000;
export const MAX_HORAS = 14;
const K_ESTADO = 'jornada';
const K_CONSENT = 'jornadaConsentimiento';
const K_DISP = 'dispositivoId';
const K_CIERRES = 'jornadasPorCerrar';
const TIMEOUT_LATIDO_MS = 20000;
const sube = (e: EstadoJornada) => (e.rev ?? 0) + 1;


/** Lo que el núcleo necesita de cada plataforma (móvil: SQLite/Expo; web: IndexedDB/navegador). */
export interface DepsJornada {
  almacen: {
    leerKv(k: string): Promise<string | null>;
    guardarKv(k: string, v: string): Promise<void>;
    contarDesde(tecnico: string, desdeISO: string): Promise<number>;
    contarEntre(tecnico: string, desdeISO: string, hastaISO: string): Promise<number>;
  };
  nuevoUuid(): string;
  cargarAjustes(): Promise<Ajustes>;
  obtenerPosicion(precision: 'alta' | 'balanceada'): Promise<Posicion | null>;
  post(a: Ajustes, cuerpo: object, timeoutMs?: number): Promise<any>;
  plataforma(): string;
  version(): string;
}

export function crearJornada(d: DepsJornada) {
  const VACIA: EstadoJornada = { id: '', fase: 'ninguna', inicio: '', sinEnviar: false };

  async function dispositivoId(): Promise<string> {
    let id = await d.almacen.leerKv(K_DISP);
    if (!id) { id = d.nuevoUuid(); await d.almacen.guardarKv(K_DISP, id); }
    return id;
  }

  async function guardar(e: EstadoJornada): Promise<EstadoJornada> {
    await d.almacen.guardarKv(K_ESTADO, JSON.stringify(e));
    return e;
  }

  async function cargarJornada(ahora = new Date()): Promise<EstadoJornada> {
    let e = VACIA;
    try { e = { ...VACIA, ...JSON.parse((await d.almacen.leerKv(K_ESTADO)) ?? '{}') }; } catch { e = VACIA; }
    if ((e.fase === 'activa' || e.fase === 'pausada') && ahora.getTime() - new Date(e.inicio).getTime() > MAX_HORAS * 3600_000) {
      const tope = new Date(new Date(e.inicio).getTime() + MAX_HORAS * 3600_000);
      return guardar({ ...e, fase: 'terminada', sinEnviar: true, rev: sube(e), fin: (ahora < tope ? ahora : tope).toISOString() }); // jornada olvidada: se cierra sola
    }
    return e;
  }

  const haAceptado = async (): Promise<boolean> => !!(await d.almacen.leerKv(K_CONSENT));
  const registrarConsentimiento = () => d.almacen.guardarKv(K_CONSENT, new Date().toISOString());

  async function iniciarJornada(ahora = new Date()): Promise<EstadoJornada> {
    if (!(await haAceptado())) throw new Error('Falta aceptar el aviso de la jornada.');
    const actual = await cargarJornada(ahora);
    if (actual.fase === 'activa' || actual.fase === 'pausada') return actual;
    if (actual.fase === 'terminada' && actual.sinEnviar && actual.fin) await encolarCierre({ id: actual.id, inicio: actual.inicio, fin: actual.fin }); // no se pierde el cierre anterior
    return guardar({ id: d.nuevoUuid(), fase: 'activa', inicio: ahora.toISOString(), sinEnviar: true, rev: sube(actual) });
  }

  async function cambiarFase(fase: 'activa' | 'pausada' | 'terminada'): Promise<EstadoJornada> {
    const e = await cargarJornada();
    if (e.fase === 'ninguna' || e.fase === 'terminada') return e;
    return guardar({ ...e, fase, sinEnviar: true, rev: sube(e), ...(fase === 'terminada' ? { fin: new Date().toISOString() } : {}) });
  }

  const leerCierres = async (): Promise<CierrePendiente[]> => {
    try { return JSON.parse((await d.almacen.leerKv(K_CIERRES)) ?? '[]'); } catch { return []; }
  };
  const encolarCierre = async (c: CierrePendiente) => d.almacen.guardarKv(K_CIERRES, JSON.stringify([...(await leerCierres()).filter((x) => x.id !== c.id), c]));

  /** Envía los cierres de jornadas anteriores que quedaron sin enviar. Nunca lanza; se detiene en el primer fallo. */
  async function enviarCierresPendientes(a: Ajustes): Promise<void> {
    const pendientes = await leerCierres();
    for (const c of pendientes) {
      try {
        await d.post(a, {
          accion: 'latido', dispositivo: await dispositivoId(), tecnico: a.tecnico || 'Sin nombre', estado: 'terminada',
          jornadaId: c.id, inicio: c.inicio, fin: c.fin, proyecto: '', luminarias: await d.almacen.contarEntre(a.tecnico, c.inicio, c.fin),
          plataforma: d.plataforma(), version: d.version(),
        }, TIMEOUT_LATIDO_MS);
      } catch { return; }
      await d.almacen.guardarKv(K_CIERRES, JSON.stringify((await leerCierres()).filter((x) => x.id !== c.id)));
    }
  }

  /** Envía un latido. Nunca lanza: sin señal simplemente devuelve false y se reintenta en el próximo ciclo. */
  async function enviarLatido(proyecto?: string): Promise<boolean> {
    const a = await d.cargarAjustes();
    if (!a.syncUrl) return false;
    await enviarCierresPendientes(a);
    const e = await cargarJornada();
    if (e.fase === 'ninguna' || (e.fase === 'terminada' && !e.sinEnviar)) return false;

    const pos = e.fase === 'activa' ? await d.obtenerPosicion('balanceada').catch(() => null) : null; // pausa/fin: sin ubicación
    try {
      await d.post(a, {
        accion: 'latido',
        dispositivo: await dispositivoId(),
        tecnico: a.tecnico || 'Sin nombre',
        estado: e.fase,
        jornadaId: e.id,
        inicio: e.inicio,
        ...(e.fase === 'terminada' && e.fin ? { fin: e.fin } : {}),
        proyecto: proyecto ?? '',
        luminarias: await d.almacen.contarDesde(a.tecnico, e.inicio),
        plataforma: d.plataforma(),
        version: d.version(),
        ...(pos ? { latitud: pos.latitud, longitud: pos.longitud, precisionM: pos.precisionM } : {}),
      }, TIMEOUT_LATIDO_MS);
    } catch { return false; }
    // Solo se confirma si el estado no cambió mientras viajaba el latido (p. ej. el técnico tocó "Terminar" entretanto).
    if (e.sinEnviar) {
      const actual = await cargarJornada();
      if (actual.sinEnviar && (actual.rev ?? 0) === (e.rev ?? 0)) await guardar({ ...actual, sinEnviar: false });
    }
    return true;
  }

  return { dispositivoId, cargarJornada, haAceptado, registrarConsentimiento, iniciarJornada, cambiarFase, enviarLatido };
}
