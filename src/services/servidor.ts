import { Ajustes } from './settings';

export class SinConexion extends Error {}

/** POST JSON (como texto plano, sin preflight) al servidor de sincronización; valida la respuesta { ok: true }. */
export async function postServidor(a: Ajustes, cuerpo: object): Promise<any> {
  let res: Response;
  try {
    res = await fetch(a.syncUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: a.syncToken, ...cuerpo }),
    });
  } catch { throw new SinConexion(); }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error ?? `El servidor respondió ${res.status}. Revisa la URL y el token.`);
  return j;
}
