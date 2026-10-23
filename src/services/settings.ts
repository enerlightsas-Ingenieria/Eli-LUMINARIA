import * as SecureStore from 'expo-secure-store';
import { Ajustes, ENDPOINT_POR_DEFECTO, MODELO_POR_DEFECTO, PreferenciaTema } from '../core/ajustes';

export type { Ajustes, PreferenciaTema };
export { ENDPOINT_POR_DEFECTO, MODELO_POR_DEFECTO };


const K = ['apiKey', 'endpoint', 'modelo', 'syncUrl', 'syncToken', 'syncFotos', 'autoSync', 'tecnico', 'tema', 'modoTerceros', 'precisionMaxM'] as const;

export async function cargarAjustes(): Promise<Ajustes> {
  const v = Object.fromEntries(await Promise.all(K.map(async (k) => [k, await SecureStore.getItemAsync(k).catch(() => null)])));
  return {
    apiKey: v.apiKey ?? '',
    endpoint: v.endpoint || ENDPOINT_POR_DEFECTO,
    modelo: v.modelo || MODELO_POR_DEFECTO,
    syncUrl: v.syncUrl ?? '',
    syncToken: v.syncToken ?? '',
    syncFotos: v.syncFotos === '1',
    autoSync: v.autoSync !== '0', // activada por defecto
    tecnico: v.tecnico ?? '',
    tema: (v.tema as PreferenciaTema) || 'auto',
    modoTerceros: v.modoTerceros === '1',
    precisionMaxM: Number(v.precisionMaxM) >= 5 ? Number(v.precisionMaxM) : 20,
  };
}

export async function guardarAjustes(a: Ajustes): Promise<void> {
  const vals: Record<(typeof K)[number], string> = {
    apiKey: a.apiKey.trim(), endpoint: a.endpoint.trim(), modelo: a.modelo.trim(), syncUrl: a.syncUrl.trim(),
    syncToken: a.syncToken.trim(), syncFotos: a.syncFotos ? '1' : '0', autoSync: a.autoSync ? '1' : '0',
    tecnico: a.tecnico.trim(), tema: a.tema, modoTerceros: a.modoTerceros ? '1' : '0', precisionMaxM: String(a.precisionMaxM),
  };
  await Promise.all(K.map((k) => SecureStore.setItemAsync(k, vals[k])));
}
