/** Direcciones como se escriben en Colombia: "Calle 35 No. 86 - 92, Medellín". */
export const TIPOS_VIA = ['Calle', 'Carrera', 'Avenida', 'Diagonal', 'Transversal', 'Circular'];

export interface PartesDireccion { tipo: string; via: string; numero: string; placa: string; resto: string }

const ALIAS: Record<string, string> = {
  calle: 'Calle', cl: 'Calle', cll: 'Calle', carrera: 'Carrera', cra: 'Carrera', cr: 'Carrera', kr: 'Carrera', carr: 'Carrera',
  avenida: 'Avenida', av: 'Avenida', ak: 'Avenida', ac: 'Avenida', diagonal: 'Diagonal', diag: 'Diagonal', dg: 'Diagonal',
  transversal: 'Transversal', tv: 'Transversal', trans: 'Transversal', circular: 'Circular', cq: 'Circular',
};

/** Separa una dirección ya escrita en sus partes (lo mejor posible); si no se entiende, todo queda en `resto`. */
export function leerPartes(texto: string): PartesDireccion {
  const t = texto.trim();
  const m = /^([A-Za-zÁÉÍÓÚáéíóú]+)\.?\s+(\d+[A-Za-z]?(?:\s+(?:bis|sur|norte|este|oeste))?)\s*(?:(?:No\.?|N°|#)\s*)?(\d+[A-Za-z]?)?\s*(?:[-–]\s*(\d+))?\s*(?:,\s*(.*))?$/i.exec(t);
  const tipo = m ? ALIAS[m[1].toLowerCase()] : undefined;
  if (!m || !tipo) return { tipo: '', via: '', numero: '', placa: '', resto: t };
  return { tipo, via: m[2].trim(), numero: m[3] ?? '', placa: m[4] ?? '', resto: (m[5] ?? '').trim() };
}

/** Arma "Calle 35 No. 86 - 92, Medellín" con lo que haya. */
export function armarDireccion(p: PartesDireccion): string {
  let base = [p.tipo, p.via.trim()].filter(Boolean).join(' ');
  if (p.numero.trim()) base += ` No. ${p.numero.trim()}${p.placa.trim() ? ` - ${p.placa.trim()}` : ''}`;
  return [base, p.resto.trim()].filter(Boolean).join(', ');
}

/** ¿La dirección ya trae el número de la puerta (No. 86 - 92 o # 86-92)? */
export const tieneNumeroDePuerta = (texto: string) => /(?:\bNo\.?|#|N°)\s*\d/i.test(texto);
