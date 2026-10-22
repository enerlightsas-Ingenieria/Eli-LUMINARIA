import * as SecureStore from 'expo-secure-store';

export interface Ajustes {
  apiKey: string;
  /** URL opcional de un proxy propio (recomendado en producción para no exponer la clave en el teléfono). */
  endpoint: string;
  modelo: string;
}

export const MODELO_POR_DEFECTO = 'claude-sonnet-5-5';
export const ENDPOINT_POR_DEFECTO = 'https://api.anthropic.com/v1/messages';

export async function cargarAjustes(): Promise<Ajustes> {
  const [apiKey, endpoint, modelo] = await Promise.all([
    SecureStore.getItemAsync('apiKey'),
    SecureStore.getItemAsync('endpoint'),
    SecureStore.getItemAsync('modelo'),
  ]);
  return {
    apiKey: apiKey ?? '',
    endpoint: endpoint || ENDPOINT_POR_DEFECTO,
    modelo: modelo || MODELO_POR_DEFECTO,
  };
}

export async function guardarAjustes(a: Ajustes): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync('apiKey', a.apiKey.trim()),
    SecureStore.setItemAsync('endpoint', a.endpoint.trim()),
    SecureStore.setItemAsync('modelo', a.modelo.trim()),
  ]);
}
