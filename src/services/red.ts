import * as Network from 'expo-network';

/** false sólo si el sistema asegura que no hay internet; ante la duda deja que el intento real decida. */
export async function hayConexion(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return s.isConnected !== false && s.isInternetReachable !== false;
  } catch {
    return true;
  }
}
