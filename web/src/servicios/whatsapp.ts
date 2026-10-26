/** WhatsApp sin costo ni cuentas de empresa: se abre una conversación (o el selector de chats) con el mensaje ya escrito y la persona solo pulsa Enviar. */
export const CODIGO_PAIS_POR_DEFECTO = '57';

/**
 * Número listo para wa.me (solo dígitos, con código de país) o '' si no parece un teléfono.
 * "300 123 4567" → 573001234567 (código por defecto); "+1 555 123 4567" y "0057 300…" se respetan tal cual.
 */
export function telefonoWa(telefono: string, codigoPais = CODIGO_PAIS_POR_DEFECTO): string {
  const t = String(telefono ?? '').trim();
  const conMas = t.startsWith('+');
  let d = t.replace(/\D/g, '');
  const conCeros = d.startsWith('00');
  if (conCeros) d = d.slice(2);
  if (!conMas && !conCeros && d.length === 10) d = codigoPais.replace(/\D/g, '') + d;
  return d.length >= 8 && d.length <= 15 ? d : '';
}

/** Conversación con una persona, con el mensaje escrito. '' si el teléfono no sirve. */
export function enlaceWa(telefono: string, mensaje: string, codigoPais?: string): string {
  const n = telefonoWa(telefono, codigoPais);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(mensaje)}` : '';
}

/** Abre WhatsApp con el mensaje y deja elegir el chat o grupo (para avisar a todo el equipo). */
export const enlaceWaGeneral = (mensaje: string) => `https://wa.me/?text=${encodeURIComponent(mensaje)}`;

export function enlaceLlamada(telefono: string, codigoPais?: string): string {
  const n = telefonoWa(telefono, codigoPais);
  return n ? `tel:+${n}` : '';
}

let pais: Promise<string> | null = null;
/** Código de país por defecto de la empresa: "codigoPais" en servidor.json (57 = Colombia). */
export function codigoPaisDeLaEmpresa(): Promise<string> {
  pais ??= fetch(`${import.meta.env.BASE_URL}servidor.json`, { cache: 'no-cache' })
    .then((r) => r.json()).then((j) => (typeof j?.codigoPais === 'string' && /^\d{1,4}$/.test(j.codigoPais) ? j.codigoPais : CODIGO_PAIS_POR_DEFECTO))
    .catch(() => CODIGO_PAIS_POR_DEFECTO);
  return pais;
}
