import { Ajustes } from './settings';

export class SinConexion extends Error {}

/** POST JSON (como texto plano, sin preflight) al servidor de sincronización; valida la respuesta { ok: true }. Sin respuesta en timeoutMs → SinConexion. */
export async function postServidor(a: Ajustes, cuerpo: object, timeoutMs = 60000): Promise<any> {
  let res: Response;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs); // una respuesta que nunca llega no debe colgar la app
  try {
    res = await fetch(a.syncUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: a.syncToken, ...cuerpo }),
      signal: ctl.signal,
    });
  } catch { throw new SinConexion(); } finally { clearTimeout(t); }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error ?? `El servidor respondió ${res.status}. Revisa la URL y el token.`);
  return j;
}
