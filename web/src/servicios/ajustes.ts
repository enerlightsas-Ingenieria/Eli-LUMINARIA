import { Ajustes, ENDPOINT_POR_DEFECTO, MODELO_POR_DEFECTO } from '@compartido/core/ajustes';

const CLAVE = 'eli.ajustes.v1';

export const ajustesPorDefecto = (): Ajustes => ({
  apiKey: '', endpoint: ENDPOINT_POR_DEFECTO, modelo: MODELO_POR_DEFECTO, syncUrl: '', syncToken: '', syncFotos: false,
  autoSync: true, tecnico: '', tema: 'auto', modoTerceros: false, precisionMaxM: 20, supervisor: false,
});

export async function cargarAjustes(): Promise<Ajustes> {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? '{}');
    const a = { ...ajustesPorDefecto(), ...guardado } as Ajustes;
    if (!a.endpoint) a.endpoint = ENDPOINT_POR_DEFECTO;
    if (!a.modelo) a.modelo = MODELO_POR_DEFECTO;
    if (!(a.precisionMaxM >= 5)) a.precisionMaxM = 20;
    return a;
  } catch { return ajustesPorDefecto(); }
}

export async function guardarAjustes(a: Ajustes): Promise<void> {
  localStorage.setItem(CLAVE, JSON.stringify({
    ...a, apiKey: a.apiKey.trim(), endpoint: a.endpoint.trim(), syncUrl: a.syncUrl.trim(), syncToken: a.syncToken.trim(), tecnico: a.tecnico.trim(),
  }));
}
