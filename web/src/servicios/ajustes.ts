import { Ajustes, ENDPOINT_POR_DEFECTO, MODELO_POR_DEFECTO } from '@compartido/core/ajustes';
import { claveDeSesion, fijarClaveDeSesion, guardarVerificador } from './sesion';

const CLAVE = 'eli.ajustes.v1';

export const ajustesPorDefecto = (): Ajustes => ({
  apiKey: '', endpoint: ENDPOINT_POR_DEFECTO, modelo: MODELO_POR_DEFECTO, syncUrl: '', syncToken: '', syncFotos: false,
  autoSync: true, tecnico: '', tema: 'auto', modoTerceros: false, precisionMaxM: 20, supervisor: false, iaActiva: true,
});

/** Versiones anteriores guardaban la clave en el dispositivo: se retira (y se deja un verificador para poder entrar) la primera vez. */
async function retirarClaveGuardada(guardado: any): Promise<void> {
  const vieja = typeof guardado.apiKey === 'string' ? guardado.apiKey.trim() : '';
  delete guardado.apiKey;
  localStorage.setItem(CLAVE, JSON.stringify(guardado));
  if (vieja) await guardarVerificador(guardado.usuario || guardado.tecnico || '', vieja).catch(() => {});
}

export async function cargarAjustes(): Promise<Ajustes> {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? '{}');
    if ('apiKey' in guardado) await retirarClaveGuardada(guardado);
    const a = { ...ajustesPorDefecto(), ...guardado, apiKey: claveDeSesion() } as Ajustes;   // la clave solo vive en memoria
    if (!a.endpoint) a.endpoint = ENDPOINT_POR_DEFECTO;
    if (!a.modelo) a.modelo = MODELO_POR_DEFECTO;
    if (!(a.precisionMaxM >= 5)) a.precisionMaxM = 20;
    return a;
  } catch { return ajustesPorDefecto(); }
}

export async function guardarAjustes(a: Ajustes): Promise<void> {
  fijarClaveDeSesion(a.apiKey);
  const { apiKey: _noSeGuarda, ...resto } = a;
  localStorage.setItem(CLAVE, JSON.stringify({
    ...resto, endpoint: a.endpoint.trim(), syncUrl: a.syncUrl.trim(), syncToken: a.syncToken.trim(), tecnico: a.tecnico.trim(),
  }));
}
