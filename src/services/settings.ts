import * as SecureStore from 'expo-secure-store';

export type PreferenciaTema = 'auto' | 'claro' | 'oscuro';

export interface Ajustes {
  apiKey: string;
  /** URL opcional de un proxy propio (recomendado en producción para no exponer la clave en el teléfono). */
  endpoint: string;
  modelo: string;
  /** URL de la Web App de Google Apps Script (o cualquier servidor compatible). */
  syncUrl: string;
  syncToken: string;
  syncFotos: boolean;
  /** Envía solo, en segundo plano, cuando hay conexión. */
  autoSync: boolean;
  /** Nombre del técnico; se registra en cada luminaria. */
  tecnico: string;
  tema: PreferenciaTema;
}

export const MODELO_POR_DEFECTO = 'claude-sonnet-5-5';
export const ENDPOINT_POR_DEFECTO = 'https://api.anthropic.com/v1/messages';

const K = ['apiKey', 'endpoint', 'modelo', 'syncUrl', 'syncToken', 'syncFotos', 'autoSync', 'tecnico', 'tema'] as const;

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
  };
}

export async function guardarAjustes(a: Ajustes): Promise<void> {
  const vals: Record<(typeof K)[number], string> = {
    apiKey: a.apiKey.trim(), endpoint: a.endpoint.trim(), modelo: a.modelo.trim(), syncUrl: a.syncUrl.trim(),
    syncToken: a.syncToken.trim(), syncFotos: a.syncFotos ? '1' : '0', autoSync: a.autoSync ? '1' : '0',
    tecnico: a.tecnico.trim(), tema: a.tema,
  };
  await Promise.all(K.map((k) => SecureStore.setItemAsync(k, vals[k])));
}
