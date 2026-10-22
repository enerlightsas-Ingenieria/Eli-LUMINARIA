import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { obtenerPosicion } from './captura';
import { contarDesde, guardarKv, leerKv, nuevoUuid } from './db';
import { postServidor } from './servidor';
import { cargarAjustes } from './settings';

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
}

export const INTERVALO_MS = 5 * 60 * 1000;
export const MAX_HORAS = 14;
const K_ESTADO = 'jornada';
const K_CONSENT = 'jornadaConsentimiento';
const K_DISP = 'dispositivoId';

const VACIA: EstadoJornada = { id: '', fase: 'ninguna', inicio: '', sinEnviar: false };

export async function dispositivoId(): Promise<string> {
  let id = await leerKv(K_DISP);
  if (!id) { id = nuevoUuid(); await guardarKv(K_DISP, id); }
  return id;
}

async function guardar(e: EstadoJornada): Promise<EstadoJornada> {
  await guardarKv(K_ESTADO, JSON.stringify(e));
  return e;
}

export async function cargarJornada(ahora = new Date()): Promise<EstadoJornada> {
  let e = VACIA;
  try { e = { ...VACIA, ...JSON.parse((await leerKv(K_ESTADO)) ?? '{}') }; } catch { e = VACIA; }
  if ((e.fase === 'activa' || e.fase === 'pausada') && ahora.getTime() - new Date(e.inicio).getTime() > MAX_HORAS * 3600_000) {
    return guardar({ ...e, fase: 'terminada', sinEnviar: true }); // jornada olvidada: se cierra sola
  }
  return e;
}

export const haAceptado = async (): Promise<boolean> => !!(await leerKv(K_CONSENT));
export const registrarConsentimiento = () => guardarKv(K_CONSENT, new Date().toISOString());

export async function iniciarJornada(ahora = new Date()): Promise<EstadoJornada> {
  if (!(await haAceptado())) throw new Error('Falta aceptar el aviso de la jornada.');
  const actual = await cargarJornada(ahora);
  if (actual.fase === 'activa' || actual.fase === 'pausada') return actual;
  return guardar({ id: nuevoUuid(), fase: 'activa', inicio: ahora.toISOString(), sinEnviar: true });
}

export async function cambiarFase(fase: 'activa' | 'pausada' | 'terminada'): Promise<EstadoJornada> {
  const e = await cargarJornada();
  if (e.fase === 'ninguna' || e.fase === 'terminada') return e;
  return guardar({ ...e, fase, sinEnviar: true });
}

/** Envía un latido. Nunca lanza: sin señal simplemente devuelve false y se reintenta en el próximo ciclo. */
export async function enviarLatido(proyecto?: string): Promise<boolean> {
  const e = await cargarJornada();
  if (e.fase === 'ninguna' || (e.fase === 'terminada' && !e.sinEnviar)) return false;
  const a = await cargarAjustes();
  if (!a.syncUrl) return false;

  const pos = e.fase === 'activa' ? await obtenerPosicion('balanceada').catch(() => null) : null; // pausa/fin: sin ubicación
  try {
    await postServidor(a, {
      accion: 'latido',
      dispositivo: await dispositivoId(),
      tecnico: a.tecnico || 'Sin nombre',
      estado: e.fase,
      jornadaId: e.id,
      inicio: e.inicio,
      proyecto: proyecto ?? '',
      luminarias: await contarDesde(a.tecnico, e.inicio),
      plataforma: Platform.OS,
      version: Constants.expoConfig?.version ?? '',
      ...(pos ? { latitud: pos.latitud, longitud: pos.longitud, precisionM: pos.precisionM } : {}),
    });
  } catch { return false; }
  if (e.sinEnviar) await guardar({ ...e, sinEnviar: false });
  return true;
}
