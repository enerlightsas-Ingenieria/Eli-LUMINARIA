export type Confianza = 'alta' | 'media' | 'baja';

/** Características que la IA intenta extraer de la foto (todas opcionales). */
export interface Caracteristicas {
  fabricante: string;
  tecnologia: string;
  potenciaW: string;
  /** Cómo se controla el encendido: "Fotocelda", "Telegestión", "Sin control" u "Otro: <cuál>". */
  control: string;
  /** "Poste", "Fachada" u "Otro: <cuál>". */
  montaje: string;
  /** Solo si el montaje es poste: Concreto, Madera, Metálico, Fibra de vidrio, Fibra de vidrio traslúcido u "Otro: <cuál>". */
  materialPoste: string;
  /** Número del transformador que alimenta la luminaria (lo escribe la persona; la IA no lo ve). */
  numeroTransformador: string;
  estado: string;
  observaciones: string;
}

export interface Proyecto {
  id: number;
  uuid: string;
  nombre: string;
  cliente: string;
  notas: string;
  creadoEn: string;
  /** Id del proyecto en la hoja de Google (lo pone el servidor): permite renombrar, desactivar o eliminar sin crear proyectos duplicados. */
  idHoja?: string;
  /** Un proyecto desactivado no se muestra (por defecto, activo). */
  activo?: boolean;
}

export interface Luminaria extends Caracteristicas {
  id: number;
  uuid: string;
  proyectoId: number;
  creadoEn: string;
  actualizadoEn: string;
  fotos: string[];
  latitud: number | null;
  longitud: number | null;
  precisionM: number | null;
  /** Dirección del punto donde se tomó la foto (la app la propone a partir de la coordenada; se puede corregir). */
  direccion: string;
  /** Barrio del punto (la app lo propone a partir de la coordenada; se puede corregir). */
  barrio: string;
  /** Foto de referencia en baja resolución (JPEG en base64, ~240 px): viaja con el registro para que todos la vean. */
  miniatura?: string;
  /** Urbano o Rural. */
  sector: string;
  /** Código del poste (opcional; el que use la empresa). */
  codigoPoste: string;
  /** Código de la luminaria (opcional; el que use la empresa). */
  codigo: string;
  /** Técnico que hizo el registro (para flotas). */
  tecnico: string;
  /** Usuario (cuenta) con el que se registró; lo sella el servidor. */
  usuario?: string;
  confianza: Confianza | '';
  /** Cómo se obtuvo la foto: con la cámara de la app o desde la galería. */
  origen: 'camara' | 'galeria' | '';
  /** Android detectó una app de ubicación simulada al capturar. */
  ubicacionSimulada: boolean;
  /** Jornada durante la que se capturó (vacío si no había jornada activa). */
  jornadaId: string;
  sincronizado: boolean;
}

export type LuminariaBorrador = Omit<Luminaria, 'id' | 'sincronizado'> & { id?: number };

/** Tecnologías de lámpara. "Otra" se completa a mano como "Otra: <cuál>". */
export const TECNOLOGIAS = ['LED', 'Sodio', 'Metal Halide', 'Mercurio', 'Fluorescente', 'Incandescente', 'Halógena', 'Inducción', 'Luz mixta', 'Otra (¿cuál?)'];
export const PREFIJO_OTRA = 'Otra: ';
/** Una opción "abierta" (Otra) se marca activa con cualquier texto que empiece por "otra". */
export const esOpcionAbierta = (opcion: string) => /^otr[ao]\b/i.test(opcion);

/** Lleva lo que diga la IA (o un dato antiguo) a una de las tecnologías de la lista; lo que no encaje queda como "Otra: …". */
export function normalizarTecnologia(valor: string): string {
  const v = valor.trim();
  if (!v) return '';
  if (/^otra\b/i.test(v)) return /^otra\s*:\s*\S/i.test(v) ? PREFIJO_OTRA + v.replace(/^otra\s*:\s*/i, '') : 'Otra';
  const quitar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  const k = quitar(v);
  const directo = TECNOLOGIAS.slice(0, -1).find((t) => quitar(t) === k);
  if (directo) return directo;
  if (k.startsWith('sodio')) return 'Sodio';
  if (k.startsWith('led')) return 'LED';
  if (k.startsWith('halogenuro') || k.startsWith('metalhal')) return 'Metal Halide';
  if (k.startsWith('halogen')) return 'Halógena';
  if (k.startsWith('mixta') || k.startsWith('luzmixta')) return 'Luz mixta';
  if (k.startsWith('mercurio')) return 'Mercurio';
  return PREFIJO_OTRA + v;
}

export const SECTORES = ['Urbano', 'Rural'];
export const MONTAJES = ['Poste', 'Fachada', 'Otro (¿cuál?)'];
export const MATERIALES_POSTE = ['Concreto', 'Madera', 'Metálico', 'Fibra de vidrio', 'Fibra de vidrio traslúcido', 'Otro (¿cuál?)'];
export const PREFIJO_OTRO = 'Otro: ';

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');

export const CONTROLES = ['Fotocelda', 'Telegestión', 'Sin control', 'Otro (¿cuál?)'];

/**
 * Lleva el control a Fotocelda, Telegestión, Sin control u "Otro: <cuál>". Datos antiguos (el campo era "Fotocelda" Sí/No):
 * "Sí", NEMA, integrada, externa → Fotocelda; "No" y "Sin fotocelda" → Sin control.
 */
export function normalizarControl(valor: string): string {
  const v = valor.trim();
  if (!v) return '';
  const k = sinTildes(v);
  if (/^otr[oa]\b/i.test(v)) return /^otr[oa]\s*:\s*\S/i.test(v) ? PREFIJO_OTRO + v.replace(/^otr[oa]\s*:\s*/i, '') : 'Otro';
  if (k === 'no' || k.startsWith('sin') || k.startsWith('ningun') || k === 'nohay' || k === 'ausente') return 'Sin control';
  if (k.includes('telegest') || k.includes('telecontrol') || k.includes('gestion') || k.includes('inteligente')) return 'Telegestión';
  if (k === 'si' || k.includes('fotoc') || k.includes('nema') || k.includes('twistlock') || k.startsWith('integrada') || k.startsWith('externa')) return 'Fotocelda';
  return PREFIJO_OTRO + v;
}

/** Lleva el montaje a Poste, Fachada u "Otro: <cuál>" (un dato antiguo como "Brazo" queda como "Otro: Brazo"). */
export function normalizarMontaje(valor: string): string {
  const v = valor.trim();
  if (!v) return '';
  const k = sinTildes(v);
  if (k === 'poste') return 'Poste';
  if (k === 'fachada') return 'Fachada';
  if (/^otr[oa]\b/i.test(v)) return /^otr[oa]\s*:\s*\S/i.test(v) ? PREFIJO_OTRO + v.replace(/^otr[oa]\s*:\s*/i, '') : 'Otro';
  return PREFIJO_OTRO + v;
}

/** Lleva el material del poste a una opción de la lista; lo que no encaje queda como "Otro: <cuál>". */
export function normalizarMaterialPoste(valor: string): string {
  const v = valor.trim();
  if (!v) return '';
  const k = sinTildes(v);
  if (/^otr[oa]\b/i.test(v)) return /^otr[oa]\s*:\s*\S/i.test(v) ? PREFIJO_OTRO + v.replace(/^otr[oa]\s*:\s*/i, '') : 'Otro';
  const directo = MATERIALES_POSTE.slice(0, -1).find((m) => sinTildes(m) === k);
  if (directo) return directo;
  if (k.startsWith('concreto') || k.startsWith('hormigon') || k.startsWith('cemento')) return 'Concreto';
  if (k.startsWith('madera')) return 'Madera';
  if (k.startsWith('metal') || k.startsWith('acero') || k.startsWith('hierro')) return 'Metálico';
  if (k.includes('traslucid') || k.includes('translucid')) return 'Fibra de vidrio traslúcido';
  if (k.startsWith('fibra')) return 'Fibra de vidrio';
  return PREFIJO_OTRO + v;
}

export const CAMPOS: {
  key: keyof Caracteristicas; label: string; hint?: string; multiline?: boolean; numeric?: boolean; opciones?: string[];
  /** Solo se elige entre las opciones (sin escribir). */
  soloOpciones?: boolean;
  /** El campo solo aparece cuando esto es verdadero (según los demás datos). */
  visibleSi?: (c: Caracteristicas) => boolean;
}[] = [
  { key: 'fabricante', label: 'Fabricante', hint: 'Ej. Philips, Schréder, Lumenpulse' },
  { key: 'tecnologia', opciones: TECNOLOGIAS, label: 'Tecnología', hint: 'Si es otra, escribe cuál' },
  { key: 'potenciaW', opciones: ['30','50','70','100','150','250','400'], label: 'Potencia (W)', numeric: true },
  { key: 'control', opciones: CONTROLES, label: 'Control', hint: 'Si es otro, escribe cuál' },
  { key: 'montaje', opciones: MONTAJES, label: 'Montaje', hint: 'Poste, fachada u otro (escribe cuál)' },
  { key: 'materialPoste', opciones: MATERIALES_POSTE, label: 'Material del poste', hint: 'Si es otro, escribe cuál', visibleSi: (c) => /^poste\b/i.test(c.montaje.trim()) },
  { key: 'numeroTransformador', label: 'N.º del transformador', hint: 'Opcional' },
  { key: 'estado', opciones: ['Bueno','Deteriorado','Apagada','Vandalizada'], label: 'Estado visual', hint: 'Bueno, deteriorado, apagada, vandalizada' },
  { key: 'observaciones', label: 'Observaciones', multiline: true },
];

export const caracteristicasVacias = (): Caracteristicas => ({
  fabricante: '', tecnologia: '', potenciaW: '', control: '', montaje: '', materialPoste: '', numeroTransformador: '', estado: '', observaciones: '',
});
